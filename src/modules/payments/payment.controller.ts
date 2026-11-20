import type { Request, RequestHandler } from "express";
import { env } from "../../config/env.js";
import { verifyIpnSignature } from "../../config/sslcommerz.js";
import { getAuthUser } from "../../middlewares/auth.middleware.js";
import { getOrganizationContext } from "../../middlewares/organization.middleware.js";
import { AppError } from "../../utils/app-error.js";
import { sendSuccess } from "../../utils/response.js";
import type {
  GatewayCallbackInput,
  InitiatePaymentInput,
  PaymentHistoryQuery,
  PaymentProcessingResult,
} from "./payment.interface.js";
import { paymentService } from "./payment.service.js";

type PaymentParams = { paymentId: string };

const RESULT_MESSAGES: Record<PaymentProcessingResult["status"], string> = {
  SUCCESS: "Payment verified and subscription activated",
  FAILED: "Payment failed",
  CANCELLED: "Payment cancelled",
  PENDING: "Payment could not be verified",
};

/** The gateway sends the customer's browser back with a form POST. */
const isGatewayBrowserRedirect = (req: Request) => Boolean(req.is("application/x-www-form-urlencoded"));

const frontendResultUrl = (status: string, transactionId: string) => {
  const url = new URL("/payment/result", env.FRONTEND_URL);
  url.searchParams.set("status", status.toLowerCase());
  url.searchParams.set("transactionId", transactionId);
  return url.toString();
};

export const initiatePayment: RequestHandler = async (req, res) => {
  const result = await paymentService.initiatePayment(
    getOrganizationContext(req),
    getAuthUser(req),
    req.body as InitiatePaymentInput,
  );
  sendSuccess(res, {
    statusCode: 201,
    message: "Payment session created. Redirect the user to gatewayUrl to pay.",
    data: result,
  });
};

/**
 * POST /payments/validate – success/fail/cancel URL for SSLCommerz.
 * Browser redirects (form posts) are sent on to the frontend result page;
 * API clients (JSON) get the standard JSON envelope.
 */
export const validatePayment: RequestHandler = async (req, res) => {
  const callback = req.body as GatewayCallbackInput;

  if (isGatewayBrowserRedirect(req)) {
    let status: string;
    try {
      status = (await paymentService.processGatewayCallback(callback)).status;
    } catch (error) {
      console.warn(`[payments] callback for ${callback.tran_id} failed:`, error instanceof Error ? error.message : error);
      status = "FAILED";
    }
    res.redirect(303, frontendResultUrl(status, callback.tran_id));
    return;
  }

  const result = await paymentService.processGatewayCallback(callback);
  sendSuccess(res, { message: RESULT_MESSAGES[result.status], data: result });
};

/** POST /payments/ipn – server-to-server notification; the signature is verified first. */
export const handleIpn: RequestHandler = async (req, res) => {
  const payload = req.body as GatewayCallbackInput;
  if (!verifyIpnSignature(payload)) {
    throw AppError.badRequest("Invalid IPN signature");
  }
  const result = await paymentService.processGatewayCallback(payload);
  sendSuccess(res, { message: `IPN processed: ${RESULT_MESSAGES[result.status]}`, data: result });
};

export const getPaymentHistory: RequestHandler = async (req, res) => {
  const { payments, meta } = await paymentService.getPaymentHistory(
    getOrganizationContext(req),
    req.query as unknown as PaymentHistoryQuery,
  );
  sendSuccess(res, { message: "Payment history retrieved successfully", data: payments, meta });
};

export const getPayment: RequestHandler = async (req, res) => {
  const payment = await paymentService.getPayment(
    getOrganizationContext(req),
    (req.params as PaymentParams).paymentId,
  );
  sendSuccess(res, { message: "Payment retrieved successfully", data: payment });
};
