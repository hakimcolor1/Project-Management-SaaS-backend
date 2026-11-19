import type { RequestHandler } from "express";
import type { ZodError, ZodType } from "zod";
import { AppError, type ErrorDetail } from "../utils/app-error.js";

type RequestLocation = NonNullable<ErrorDetail["location"]>;

export type RequestSchemas = Partial<Record<RequestLocation, ZodType>>;

const LOCATIONS: readonly RequestLocation[] = ["params", "query", "body"];

export const formatZodIssues = (error: ZodError, location?: RequestLocation): ErrorDetail[] =>
  error.issues.map((issue) => {
    const detail: ErrorDetail = { message: issue.message };
    if (issue.path.length > 0) detail.field = issue.path.map(String).join(".");
    if (location) detail.location = location;
    return detail;
  });

/**
 * Validates params, query and body against Zod schemas. Every problem across
 * all locations is collected into one 422 response.
 *
 * On success the request values are REPLACED with the parsed output, so
 * handlers receive coerced types and defaults, and unknown keys are stripped
 * (protection against mass assignment).
 */
export const validate =
  (schemas: RequestSchemas): RequestHandler =>
  (req, _res, next) => {
    const errors: ErrorDetail[] = [];

    for (const location of LOCATIONS) {
      const schema = schemas[location];
      if (!schema) continue;

      // Express 5 leaves req.body undefined when no body was sent.
      const result = schema.safeParse(req[location] ?? {});
      if (!result.success) {
        errors.push(...formatZodIssues(result.error, location));
        continue;
      }

      // Express 5 exposes req.query as a getter, so define an own property
      // instead of assigning (assignment would throw in strict mode).
      Object.defineProperty(req, location, {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    if (errors.length > 0) {
      next(AppError.validation(errors));
      return;
    }
    next();
  };
