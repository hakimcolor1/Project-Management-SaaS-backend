import express, { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { organizationOwnerAccess } from "../../middlewares/organization.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { getPayment, getPaymentHistory, handleIpn, initiatePayment, validatePayment } from "./payment.controller.js";
import {
  gatewayCallbackSchema,
  initiatePaymentSchema,
  paymentHistoryQuerySchema,
  paymentIdParamsSchema,
} from "./payment.validation.js";

export const paymentRoutes = Router();

// SSLCommerz posts form-encoded bodies; this is the ONLY place they are parsed.
const parseGatewayForm = express.urlencoded({ extended: false, limit: "50kb" });

paymentRoutes.post(
  "/initiate",
  authenticate,
  organizationOwnerAccess(),
  validate({ body: initiatePaymentSchema }),
  initiatePayment,
);

// Public gateway callbacks: trust comes from gateway validation / IPN signature, not from the caller.
paymentRoutes.post("/validate", parseGatewayForm, validate({ body: gatewayCallbackSchema }), validatePayment);
paymentRoutes.post("/ipn", parseGatewayForm, validate({ body: gatewayCallbackSchema }), handleIpn);

paymentRoutes.get(
  "/history",
  authenticate,
  organizationOwnerAccess(),
  validate({ query: paymentHistoryQuerySchema }),
  getPaymentHistory,
);

// Status tracking for one payment. Registered after /history so that path is never read as an id.
paymentRoutes.get(
  "/:paymentId",
  authenticate,
  organizationOwnerAccess(),
  validate({ params: paymentIdParamsSchema }),
  getPayment,
);
