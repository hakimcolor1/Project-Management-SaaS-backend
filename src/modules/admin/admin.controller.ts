import type { RequestHandler } from "express";
import { getAuthUser } from "../../middlewares/auth.middleware.js";
import { sendSuccess } from "../../utils/response.js";
import type {
  ListAuditLogsQuery,
  ListOrganizationsQuery,
  ListPaymentsQuery,
  ListUsersQuery,
  UpdateOrganizationStatusInput,
  UpdatePlanInput,
} from "./admin.interface.js";
import { adminService } from "./admin.service.js";

export const getDashboard: RequestHandler = async (_req, res) => {
  sendSuccess(res, { message: "Dashboard statistics retrieved successfully", data: await adminService.getDashboard() });
};

export const listOrganizations: RequestHandler = async (req, res) => {
  const { organizations, meta } = await adminService.listOrganizations(req.query as unknown as ListOrganizationsQuery);
  sendSuccess(res, { message: "Organizations retrieved successfully", data: organizations, meta });
};

export const updateOrganizationStatus: RequestHandler = async (req, res) => {
  const organization = await adminService.updateOrganizationStatus(
    getAuthUser(req),
    (req.params as { id: string }).id,
    req.body as UpdateOrganizationStatusInput,
  );
  const verb = organization.status === "SUSPENDED" ? "suspended" : "reactivated";
  sendSuccess(res, { message: `Organization ${verb} successfully`, data: organization });
};

export const listUsers: RequestHandler = async (req, res) => {
  const { users, meta } = await adminService.listUsers(req.query as unknown as ListUsersQuery);
  sendSuccess(res, { message: "Users retrieved successfully", data: users, meta });
};

export const listPayments: RequestHandler = async (req, res) => {
  const { payments, meta } = await adminService.listPayments(req.query as unknown as ListPaymentsQuery);
  sendSuccess(res, { message: "Payments retrieved successfully", data: payments, meta });
};

export const listAuditLogs: RequestHandler = async (req, res) => {
  const { logs, meta } = await adminService.listAuditLogs(req.query as unknown as ListAuditLogsQuery);
  sendSuccess(res, { message: "Audit logs retrieved successfully", data: logs, meta });
};

export const updatePlan: RequestHandler = async (req, res) => {
  const plan = await adminService.updatePlan(
    getAuthUser(req),
    (req.params as { planId: string }).planId,
    req.body as UpdatePlanInput,
  );
  sendSuccess(res, { message: "Plan updated successfully", data: plan });
};
