import { z } from "zod";
import { OrganizationStatus, PaymentStatus, UserRole } from "../../generated/prisma/enums.js";
import { paginationQuerySchema } from "../../utils/pagination.js";
import { NON_EMPTY_BODY_MESSAGE, nonEmptyBody, searchQuerySchema, uuidSchema } from "../../utils/validation.js";

/** Query-string booleans: "true" / "false". */
const booleanQuerySchema = z.enum(["true", "false"]).transform((value) => value === "true");

export const organizationIdParamsSchema = z.object({ id: uuidSchema("organization ID") });
export const planIdParamsSchema = z.object({ planId: uuidSchema("plan ID") });

export const listOrganizationsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  status: z.enum(OrganizationStatus).optional(),
});

export const updateOrganizationStatusSchema = z.strictObject({
  status: z.enum(OrganizationStatus, { error: "Status must be ACTIVE or SUSPENDED" }),
  reason: z.string().trim().min(3).max(500).optional(),
});

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  role: z.enum(UserRole).optional(),
  isActive: booleanQuerySchema.optional(),
});

export const listPaymentsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PaymentStatus).optional(),
  organizationId: uuidSchema("organization ID").optional(),
});

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().min(1).max(100).toUpperCase().optional(),
  entity: z.string().trim().min(1).max(50).optional(),
  organizationId: uuidSchema("organization ID").optional(),
  userId: uuidSchema("user ID").optional(),
});

const limitSchema = z.number().int().min(1).max(100_000);

export const updatePlanSchema = z
  .strictObject({
    price: z
      .string()
      .regex(/^\d{1,8}(\.\d{1,2})?$/, "Price must be a decimal string such as \"1500.00\"")
      .optional(),
    durationDays: z.number().int().min(1).max(3650).nullable().optional(),
    maxMembers: limitSchema.optional(),
    maxProjects: limitSchema.nullable().optional(),
    maxTasksPerProject: limitSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(nonEmptyBody, { message: NON_EMPTY_BODY_MESSAGE });
