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

const uuidOnly = z.uuid();
export const isUuid = (value: string) => uuidOnly.safeParse(value).success;

/** Our transaction ids are letters and digits only (see generateTransactionId). */
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9]{8,64}$/;

/** GET /payments/:paymentId – a payment UUID or its transaction id. */
export const paymentIdParamsSchema = z.object({
  paymentId: z
    .string()
    .trim()
    .refine(
      (value) => isUuid(value) || TRANSACTION_ID_PATTERN.test(value),
      "Must be a payment ID (UUID) or a transaction ID",
    ),
});
