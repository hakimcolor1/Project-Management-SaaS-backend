import { z } from "zod";
import { OrganizationStatus, PaymentStatus } from "../../generated/prisma/enums.js";
import { paginationQuerySchema } from "../../utils/pagination.js";
import { searchQuerySchema, uuidSchema } from "../../utils/validation.js";

// User-directory and plan schemas live in their own modules
// (users/user.validation.ts, subscriptions/subscription.validation.ts).

export const organizationIdParamsSchema = z.object({ id: uuidSchema("organization ID") });

export const listOrganizationsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  status: z.enum(OrganizationStatus).optional(),
});

export const updateOrganizationStatusSchema = z.strictObject({
  status: z.enum(OrganizationStatus, { error: "Status must be ACTIVE or SUSPENDED" }),
  reason: z.string().trim().min(3).max(500).optional(),
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
