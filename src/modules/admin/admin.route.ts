import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { authorize } from "../../middlewares/role.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  getDashboard,
  listAuditLogs,
  listOrganizations,
  listPayments,
  listUsers,
  updateOrganizationStatus,
  updatePlan,
} from "./admin.controller.js";
import {
  listAuditLogsQuerySchema,
  listOrganizationsQuerySchema,
  listPaymentsQuerySchema,
  listUsersQuerySchema,
  organizationIdParamsSchema,
  planIdParamsSchema,
  updateOrganizationStatusSchema,
  updatePlanSchema,
} from "./admin.validation.js";

export const adminRoutes = Router();

// Every admin route: authenticated SUPER_ADMIN only.
adminRoutes.use(authenticate, authorize("SUPER_ADMIN"));

adminRoutes.get("/dashboard", getDashboard);
adminRoutes.get("/organizations", validate({ query: listOrganizationsQuerySchema }), listOrganizations);
adminRoutes.patch(
  "/organizations/:id/status",
  validate({ params: organizationIdParamsSchema, body: updateOrganizationStatusSchema }),
  updateOrganizationStatus,
);
adminRoutes.get("/users", validate({ query: listUsersQuerySchema }), listUsers);
adminRoutes.get("/payments", validate({ query: listPaymentsQuerySchema }), listPayments);
adminRoutes.get("/audit-logs", validate({ query: listAuditLogsQuerySchema }), listAuditLogs);
adminRoutes.patch("/plans/:planId", validate({ params: planIdParamsSchema, body: updatePlanSchema }), updatePlan);
