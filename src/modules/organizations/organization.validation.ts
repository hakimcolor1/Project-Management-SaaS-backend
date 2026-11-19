import { z } from "zod";
import { paginationQuerySchema } from "../../utils/pagination.js";
import {
  NON_EMPTY_BODY_MESSAGE,
  emailSchema,
  nonEmptyBody,
  searchQuerySchema,
  uuidSchema,
} from "../../utils/validation.js";

const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(120, "Name must be at most 120 characters");
const descriptionSchema = z.string().trim().max(1000, "Description must be at most 1000 characters");

export const createOrganizationSchema = z.strictObject({
  name: nameSchema,
  description: descriptionSchema.optional(),
});

export const updateOrganizationSchema = z
  .strictObject({
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
  })
  .refine(nonEmptyBody, { message: NON_EMPTY_BODY_MESSAGE });

/** Simple invitation flow: add an existing TeamFlow account by email. */
export const addMemberSchema = z.strictObject({
  email: emailSchema,
});

export const memberIdParamsSchema = z.object({
  memberId: uuidSchema("member ID"),
});

/** The owner can switch a member's access off (and back on). */
export const updateMemberSchema = z.strictObject({
  isActive: z.boolean({ error: "isActive must be true or false" }),
});

export const listMembersQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
});
