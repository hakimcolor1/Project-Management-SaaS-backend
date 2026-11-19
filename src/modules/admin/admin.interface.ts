import type { z } from "zod";
import type {
  listAuditLogsQuerySchema,
  listOrganizationsQuerySchema,
  listPaymentsQuerySchema,
  listUsersQuerySchema,
  updateOrganizationStatusSchema,
  updatePlanSchema,
} from "./admin.validation.js";

export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;
export type UpdateOrganizationStatusInput = z.infer<typeof updateOrganizationStatusSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
