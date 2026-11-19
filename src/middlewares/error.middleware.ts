import type { ErrorRequestHandler } from "express";
import jwt from "jsonwebtoken";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { Prisma } from "../generated/prisma/client.js";
import { AppError, type ErrorDetail } from "../utils/app-error.js";
import { formatZodIssues } from "./validate.middleware.js";

interface NormalizedError {
  statusCode: number;
  message: string;
  errors: ErrorDetail[];
}

const INTERNAL_ERROR: NormalizedError = {
  statusCode: 500,
  message: "Internal server error",
  errors: [],
};

/** Safely reads a nested property from an unknown value. */
const readPath = (value: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>(
    (current, key) =>
      current !== null && typeof current === "object"
        ? (current as Record<string, unknown>)[key]
        : undefined,
    value,
  );

/** Field names involved in a unique violation (names only – never values). */
const uniqueViolationFields = (error: Prisma.PrismaClientKnownRequestError): string[] => {
  const target =
    readPath(error.meta, ["target"]) ??
    // Shape reported through driver adapters (Prisma 7).
    readPath(error.meta, ["driverAdapterError", "cause", "constraint", "fields"]);

  if (typeof target === "string") return [target];
  if (Array.isArray(target)) return target.filter((item): item is string => typeof item === "string");
  return [];
};

const fromPrismaError = (error: Prisma.PrismaClientKnownRequestError): NormalizedError | null => {
  switch (error.code) {
    case "P2002": // Unique constraint failed
      return {
        statusCode: 409,
        message: "A record with the same unique value already exists",
        errors: uniqueViolationFields(error).map((field) => ({
          field,
          message: `${field} is already in use`,
        })),
      };
    case "P2025": // Record required for the operation was not found
      return { statusCode: 404, message: "Resource not found", errors: [] };
    case "P2003": // Foreign key constraint failed
      return { statusCode: 409, message: "Operation conflicts with related records", errors: [] };
    case "P2000": // Value too long for column
    case "P2023": // Inconsistent column data (e.g. malformed UUID)
      return { statusCode: 400, message: "Invalid value in request", errors: [] };
    default:
      return null;
  }
};

/** Errors created by body-parser / http-errors carry a status and an `expose` flag. */
const fromHttpError = (error: unknown): NormalizedError | null => {
  const status = readPath(error, ["status"]);
  const expose = readPath(error, ["expose"]);
  if (typeof status !== "number" || status < 400 || status >= 500 || expose !== true) return null;

  const type = readPath(error, ["type"]);
  if (type === "entity.parse.failed") {
    return { statusCode: 400, message: "Malformed JSON in request body", errors: [] };
  }
  if (type === "entity.too.large") {
    return { statusCode: 413, message: "Request body is too large", errors: [] };
  }
  const message = readPath(error, ["message"]);
  return { statusCode: status, message: typeof message === "string" ? message : "Bad request", errors: [] };
};

export const normalizeError = (error: unknown): NormalizedError => {
  if (error instanceof AppError) {
    return { statusCode: error.statusCode, message: error.message, errors: error.errors };
  }
  if (error instanceof ZodError) {
    return { statusCode: 422, message: "Validation failed", errors: formatZodIssues(error) };
  }
  if (error instanceof jwt.TokenExpiredError) {
    return { statusCode: 401, message: "Token has expired", errors: [] };
  }
  if (error instanceof jwt.JsonWebTokenError) {
    return { statusCode: 401, message: "Invalid token", errors: [] };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return fromPrismaError(error) ?? INTERNAL_ERROR;
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    // Developer error (bad query shape) – details stay in the server logs.
    return INTERNAL_ERROR;
  }
  return fromHttpError(error) ?? INTERNAL_ERROR;
};

/**
 * Centralised error handler – the single place that turns thrown errors into
 * the standard `{ success: false, message, errors }` envelope. Internal
 * details (messages, stack traces) are logged server-side, never sent to
 * clients; stacks are only attached in development.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalized = normalizeError(error);

  if (normalized.statusCode >= 500 && env.NODE_ENV !== "test") {
    if (error instanceof AppError) {
      // Expected server-side condition (e.g. a feature not configured): one line, no stack.
      console.warn(`[warn] ${req.method} ${req.originalUrl} → ${normalized.statusCode} ${error.message}`);
    } else {
      // Unexpected failure: full details for debugging, never sent to the client.
      console.error(`[error] ${req.method} ${req.originalUrl}`, error);
    }
  }

  res.status(normalized.statusCode).json({
    success: false,
    message: normalized.message,
    errors: normalized.errors,
    ...(env.NODE_ENV === "development" && error instanceof Error && { stack: error.stack }),
  });
};
