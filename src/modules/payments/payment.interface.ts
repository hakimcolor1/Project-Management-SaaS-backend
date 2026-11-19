import type { z } from "zod";
import type { PaymentStatus } from "../../generated/prisma/enums.js";
import type { gatewayCallbackSchema, initiatePaymentSchema, paymentHistoryQuerySchema } from "./payment.validation.js";

export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;
export type GatewayCallbackInput = z.infer<typeof gatewayCallbackSchema>;
export type PaymentHistoryQuery = z.infer<typeof paymentHistoryQuerySchema>;

export interface PaymentProcessingResult {
  transactionId: string;
  /** PENDING when nothing could be verified (e.g. a bare success redirect). */
  status: PaymentStatus;
  /** True when this callback repeated an already-completed payment. */
  alreadyProcessed: boolean;
  reasons?: string[];
}
