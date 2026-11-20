import { randomBytes } from "node:crypto";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import {
  type GatewayValidation,
  initPaymentSession,
  isSslCommerzConfigured,
  validatePaymentWithGateway,
} from "../../config/sslcommerz.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { OrganizationContext } from "../../middlewares/organization.middleware.js";
import { AppError } from "../../utils/app-error.js";
import { AuditAction, AuditEntity, recordAuditLog } from "../../utils/audit-log.js";
import { buildPaginationMeta, getPaginationArgs } from "../../utils/pagination.js";
import type { AuthUser } from "../auth/auth.interface.js";
import type {
  GatewayCallbackInput,
  InitiatePaymentInput,
  PaymentHistoryQuery,
  PaymentProcessingResult,
} from "./payment.interface.js";
import { isUuid } from "./payment.validation.js";

const DAY_MS = 86_400_000;
const VALID_GATEWAY_STATUSES = new Set(["VALID", "VALIDATED"]);

/** Unique, unguessable merchant transaction id (SSLCommerz allows up to 30 chars). */
const generateTransactionId = () => `TF${Date.now().toString(36).toUpperCase()}${randomBytes(6).toString("hex").toUpperCase()}`;

/** Keeps only non-sensitive gateway fields (no card numbers) for storage. */
const sanitizeValidation = (validation: GatewayValidation) => ({
  status: validation.status,
  tran_id: validation.tran_id,
  val_id: validation.val_id,
  amount: validation.amount,
  currency_type: validation.currency_type,
  currency_amount: validation.currency_amount,
  bank_tran_id: validation.bank_tran_id,
  card_type: validation.card_type,
  card_issuer: validation.card_issuer,
  risk_level: validation.risk_level,
  risk_title: validation.risk_title,
  tran_date: validation.tran_date,
});

const paymentWithPlanInclude = {
  subscription: { include: { plan: true } },
} satisfies Prisma.PaymentInclude;
type PaymentWithPlan = Prisma.PaymentGetPayload<{ include: typeof paymentWithPlanInclude }>;

// ── Initiate ─────────────────────────────────────────────────────────

/**
 * 1. checks plan eligibility, 2. creates a PENDING subscription + payment,
 * 3. opens an SSLCommerz session and returns its redirect URL. Nothing is
 * activated here – only a gateway-verified payment activates a plan.
 */
const initiatePayment = async (context: OrganizationContext, actor: AuthUser, { planId }: InitiatePaymentInput) => {
  if (!isSslCommerzConfigured()) {
    throw new AppError(503, "Payment gateway is not configured on this server");
  }

  const plan = await prisma.subscriptionPlan.findFirst({ where: { id: planId, isActive: true } });
  if (!plan) {
    throw AppError.notFound("Plan not found");
  }
  if (plan.price.lte(0)) {
    throw AppError.badRequest("The FREE plan does not require a payment");
  }

  const transactionId = generateTransactionId();
  const amount = plan.price.toFixed(2);

  const payment = await prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.create({
      data: { organizationId: context.id, planId: plan.id, status: "PENDING" },
    });
    const created = await tx.payment.create({
      data: {
        organizationId: context.id,
        subscriptionId: subscription.id,
        transactionId,
        amount: plan.price,
        currency: plan.currency,
        status: "PENDING",
      },
    });
    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.PAYMENT_INITIATED,
      entity: AuditEntity.PAYMENT,
      entityId: created.id,
      metadata: { transactionId, plan: plan.name, amount, currency: plan.currency },
    });
    return created;
  });

  const callbackUrl = `${env.BACKEND_URL}/api/v1/payments/validate`;
  try {
    // The network call happens outside the DB transaction on purpose.
    const session = await initPaymentSession({
      transactionId,
      amount,
      currency: plan.currency,
      productName: `TeamFlow ${plan.name} plan`,
      customer: { name: actor.name, email: actor.email },
      urls: {
        success: callbackUrl,
        fail: callbackUrl,
        cancel: callbackUrl,
        ipn: `${env.BACKEND_URL}/api/v1/payments/ipn`,
      },
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { gatewayResponse: { sessionKey: session.sessionKey } },
    });

    return {
      paymentId: payment.id,
      transactionId,
      amount,
      currency: plan.currency,
      plan: { id: plan.id, name: plan.name },
      gatewayUrl: session.gatewayUrl,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown gateway error";
    await prisma.$transaction([
      prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", gatewayResponse: { error: reason } } }),
      prisma.subscription.update({ where: { id: payment.subscriptionId }, data: { status: "CANCELLED" } }),
    ]);
    throw error;
  }
};

// ── Verification & activation ────────────────────────────────────────

/** Every check a gateway validation must pass before money is trusted. */
const findValidationProblems = (payment: PaymentWithPlan, validation: GatewayValidation): string[] => {
  const problems: string[] = [];
  if (!VALID_GATEWAY_STATUSES.has(validation.status)) {
    problems.push(`Gateway status is ${validation.status}`);
  }
  if (validation.tran_id !== payment.transactionId) {
    problems.push("Transaction ID does not match");
  }
  if (validation.currency_type !== payment.currency) {
    problems.push(`Currency mismatch (expected ${payment.currency}, got ${validation.currency_type ?? "none"})`);
  }
  const paidAmount = Number(validation.currency_amount);
  if (!Number.isFinite(paidAmount) || paidAmount.toFixed(2) !== payment.amount.toFixed(2)) {
    problems.push(`Amount mismatch (expected ${payment.amount.toFixed(2)}, got ${validation.currency_amount ?? "none"})`);
  }
  return problems;
};

/**
 * Marks the payment SUCCESS and activates the subscription – exactly once.
 * The conditional update is the idempotency guard: a second callback (IPN +
 * redirect, retries, parallel requests) finds no row to update and stops.
 * Buying again while a period is running extends it: the new period starts
 * when the current one ends.
 */
const activatePayment = (payment: PaymentWithPlan, validation: GatewayValidation) =>
  prisma.$transaction(async (tx): Promise<PaymentProcessingResult> => {
    const now = new Date();
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { not: "SUCCESS" } },
      data: { status: "SUCCESS", paidAt: now, gatewayResponse: sanitizeValidation(validation) },
    });
    if (count === 0) {
      return { transactionId: payment.transactionId, status: "SUCCESS", alreadyProcessed: true };
    }

    const { plan } = payment.subscription;
    const runningPeriod = await tx.subscription.findFirst({
      where: {
        organizationId: payment.organizationId,
        planId: plan.id,
        status: "ACTIVE",
        endDate: { gt: now },
        id: { not: payment.subscriptionId },
      },
      orderBy: { endDate: "desc" },
      select: { endDate: true },
    });
    const startDate = runningPeriod?.endDate ?? now;
    const endDate = plan.durationDays === null ? null : new Date(startDate.getTime() + plan.durationDays * DAY_MS);

    await tx.subscription.update({
      where: { id: payment.subscriptionId },
      data: { status: "ACTIVE", startDate, endDate },
    });

    await recordAuditLog(tx, {
      userId: null, // confirmed by the gateway, not by a user action
      organizationId: payment.organizationId,
      action: AuditAction.PAYMENT_SUCCEEDED,
      entity: AuditEntity.PAYMENT,
      entityId: payment.id,
      metadata: { transactionId: payment.transactionId, amount: payment.amount.toFixed(2), valId: validation.val_id ?? null },
    });
    await recordAuditLog(tx, {
      userId: null,
      organizationId: payment.organizationId,
      action: AuditAction.SUBSCRIPTION_ACTIVATED,
      entity: AuditEntity.SUBSCRIPTION,
      entityId: payment.subscriptionId,
      metadata: {
        plan: plan.name,
        startDate: startDate.toISOString(),
        endDate: endDate?.toISOString() ?? null,
        extended: Boolean(runningPeriod),
      },
    });

    return { transactionId: payment.transactionId, status: "SUCCESS", alreadyProcessed: false };
  });

/** Moves a still-PENDING payment to FAILED/CANCELLED and cancels its subscription. */
const closePayment = (
  payment: PaymentWithPlan,
  status: "FAILED" | "CANCELLED",
  gatewayResponse: Prisma.InputJsonValue,
  reasons: string[] = [],
) =>
  prisma.$transaction(async (tx): Promise<PaymentProcessingResult> => {
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status, gatewayResponse },
    });
    if (count === 1) {
      await tx.subscription.updateMany({
        where: { id: payment.subscriptionId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      await recordAuditLog(tx, {
        userId: null,
        organizationId: payment.organizationId,
        action: AuditAction.PAYMENT_FAILED,
        entity: AuditEntity.PAYMENT,
        entityId: payment.id,
        metadata: { transactionId: payment.transactionId, status, reasons },
      });
    }
    return { transactionId: payment.transactionId, status, alreadyProcessed: count === 0, reasons };
  });

/**
 * Handles the success/fail/cancel callbacks and the IPN. A payment is only
 * activated after SSLCommerz's validation API confirms the `val_id` and the
 * transaction id, amount and currency all match our record. A callback
 * without `val_id` can never activate anything.
 */
const processGatewayCallback = async (callback: GatewayCallbackInput): Promise<PaymentProcessingResult> => {
  const payment = await prisma.payment.findUnique({
    where: { transactionId: callback.tran_id },
    include: paymentWithPlanInclude,
  });
  if (!payment) {
    throw AppError.notFound("Payment not found for this transaction");
  }
  if (payment.status === "SUCCESS") {
    return { transactionId: payment.transactionId, status: "SUCCESS", alreadyProcessed: true };
  }

  if (callback.val_id) {
    const validation = await validatePaymentWithGateway(callback.val_id);
    const problems = findValidationProblems(payment, validation);
    if (problems.length === 0) {
      return activatePayment(payment, validation);
    }
    return closePayment(payment, "FAILED", { validation: sanitizeValidation(validation), problems }, problems);
  }

  const gatewayStatus = callback.status?.toUpperCase();
  if (gatewayStatus === "CANCELLED") {
    return closePayment(payment, "CANCELLED", { callbackStatus: gatewayStatus });
  }
  if (gatewayStatus === "FAILED") {
    return closePayment(payment, "FAILED", { callbackStatus: gatewayStatus });
  }
  // e.g. a "success" redirect without val_id – nothing can be verified.
  return {
    transactionId: payment.transactionId,
    status: payment.status,
    alreadyProcessed: false,
    reasons: ["No validation ID supplied – payment not verified"],
  };
};

// ── History & status tracking ────────────────────────────────────────

/** What an owner may see of a payment. The raw gateway response is never exposed. */
const paymentViewSelect = {
  id: true,
  transactionId: true,
  amount: true,
  currency: true,
  paymentGateway: true,
  status: true,
  paidAt: true,
  createdAt: true,
  updatedAt: true,
  subscription: { select: { id: true, status: true, startDate: true, endDate: true, plan: { select: { name: true } } } },
} satisfies Prisma.PaymentSelect;

type PaymentViewRow = Prisma.PaymentGetPayload<{ select: typeof paymentViewSelect }>;

const toPaymentView = ({ amount, subscription: { plan, ...subscription }, ...payment }: PaymentViewRow) => ({
  ...payment,
  amount: amount.toFixed(2),
  plan: plan.name,
  subscription,
});

const getPaymentHistory = async (context: OrganizationContext, query: PaymentHistoryQuery) => {
  const where: Prisma.PaymentWhereInput = {
    organizationId: context.id,
    ...(query.status && { status: query.status }),
  };
  const [payments, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: paymentViewSelect,
      ...getPaginationArgs(query),
    }),
    prisma.payment.count({ where }),
  ]);

  return { payments: payments.map(toPaymentView), meta: buildPaginationMeta(query, total) };
};

/**
 * One payment of the caller's organization, looked up by its id (UUID) or by
 * its transaction id (what the gateway result redirect carries). Payments of
 * other organizations are reported as not found.
 */
const getPayment = async (context: OrganizationContext, paymentRef: string) => {
  const payment = await prisma.payment.findFirst({
    where: {
      organizationId: context.id,
      ...(isUuid(paymentRef) ? { id: paymentRef } : { transactionId: paymentRef }),
    },
    select: paymentViewSelect,
  });
  if (!payment) {
    throw AppError.notFound("Payment not found");
  }
  return toPaymentView(payment);
};

export const paymentService = {
  initiatePayment,
  processGatewayCallback,
  getPaymentHistory,
  getPayment,
};
