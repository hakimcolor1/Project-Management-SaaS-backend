import { z } from "zod";
import { PaymentStatus } from "../../generated/prisma/enums.js";
import { paginationQuerySchema } from "../../utils/pagination.js";
import { uuidSchema } from "../../utils/validation.js";

export const initiatePaymentSchema = z.strictObject({
  planId: uuidSchema("plan ID"),
});

/**
 * Fields SSLCommerz posts to the success/fail/cancel URLs and the IPN URL.
 * Loose object: every other gateway field is kept, because the IPN signature
 * covers fields listed in `verify_key`.
 */
export const gatewayCallbackSchema = z.looseObject({
  tran_id: z.string().trim().min(1, "tran_id is required").max(64),
  val_id: z.string().trim().min(1).max(100).optional(),
  status: z.string().trim().max(30).optional(),
});

export const paymentHistoryQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PaymentStatus).optional(),
});
