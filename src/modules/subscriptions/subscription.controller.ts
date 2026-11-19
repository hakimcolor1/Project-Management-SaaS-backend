import type { RequestHandler } from "express";
import { getOrganizationContext } from "../../middlewares/organization.middleware.js";
import { sendSuccess } from "../../utils/response.js";
import { getCurrentSubscription, listActivePlans } from "./subscription.service.js";

export const getPlans: RequestHandler = async (_req, res) => {
  sendSuccess(res, { message: "Plans retrieved successfully", data: await listActivePlans() });
};

export const getMySubscription: RequestHandler = async (req, res) => {
  const subscription = await getCurrentSubscription(getOrganizationContext(req).id);
  sendSuccess(res, { message: "Subscription retrieved successfully", data: subscription });
};
