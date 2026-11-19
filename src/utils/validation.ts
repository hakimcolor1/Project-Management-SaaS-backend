import { z } from "zod";

/** Trimmed, lower-cased email – the canonical form stored in the database. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Invalid email address").max(255, "Email must be at most 255 characters"));
