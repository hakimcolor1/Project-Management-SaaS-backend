import { z } from "zod";
import { UserRole } from "../../generated/prisma/enums.js";
import { paginationQuerySchema } from "../../utils/pagination.js";
import { NON_EMPTY_BODY_MESSAGE, nonEmptyBody, searchQuerySchema } from "../../utils/validation.js";

/** Query-string booleans: "true" / "false". */
const booleanQuerySchema = z.enum(["true", "false"]).transform((value) => value === "true");

/** GET /admin/users – SUPER_ADMIN user directory. */
export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  role: z.enum(UserRole).optional(),
  isActive: booleanQuerySchema.optional(),
});

/**
 * PATCH /users/me – the only profile fields a user may change themselves.
 * Strict: email, role, isActive, password, … are rejected (mass assignment).
 */
export const updateProfileSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name must be at most 100 characters")
      .optional(),
    /** An https image URL, or null to remove the avatar. */
    avatar: z
      .url({ protocol: /^https$/, error: "Avatar must be an https URL" })
      .max(500, "Avatar URL must be at most 500 characters")
      .nullable()
      .optional(),
  })
  .refine(nonEmptyBody, { message: NON_EMPTY_BODY_MESSAGE });
