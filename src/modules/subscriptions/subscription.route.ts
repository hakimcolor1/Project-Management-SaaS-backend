import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { organizationOwnerAccess } from "../../middlewares/organization.middleware.js";
import { getMySubscription, getPlans } from "./subscription.controller.js";

/** Mounted at /plans – public. */
export const planRoutes = Router();
planRoutes.get("/", getPlans);

/** Mounted at /subscriptions – organization owner only. */
export const subscriptionRoutes = Router();
subscriptionRoutes.get("/current", authenticate, organizationOwnerAccess(), getMySubscription);
