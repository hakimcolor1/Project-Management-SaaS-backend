import { z } from "zod";

/** Trimmed, lower-cased email – the canonical form stored in the database. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Invalid email address").max(255, "Email must be at most 255 characters"));

/** UUID route/body identifiers (all primary keys are UUIDs). */
export const uuidSchema = (label = "ID") => z.uuid(`Invalid ${label}`);

/** Optional free-text search for list endpoints (`?search=`). */
export const searchQuerySchema = z.string().trim().min(1).max(100).optional();

export const sortOrderSchema = z.enum(["asc", "desc"]).default("desc");

/** "YYYY-MM-DD" → Date at UTC midnight (date-only values, no time-zone shift). */
export const dateOnlySchema = z.iso
  .date("Must be a date in YYYY-MM-DD format")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

/** Today's date at UTC midnight, for comparing against date-only values. */
export const startOfTodayUtc = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

/** Requires at least one field in a PATCH body. */
export const nonEmptyBody = <T extends object>(body: T) => Object.keys(body).length > 0;
export const NON_EMPTY_BODY_MESSAGE = "Provide at least one field to update";
