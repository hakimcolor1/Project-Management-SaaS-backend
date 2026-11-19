import { createHash } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app.js";
import type * as SslCommerzModule from "../src/config/sslcommerz.js";
import { AppError } from "../src/utils/app-error.js";
import { prisma, resetDatabase } from "./helpers/db.js";
import { addMemberTo, bearerFor, createOrganizationWithOwner, createUser, seedPlans } from "./helpers/factories.js";

// Only the two outbound HTTP calls to SSLCommerz are mocked. Signature
// verification, amount checks and all database logic run for real.
const gateway = vi.hoisted(() => ({ initPaymentSession: vi.fn(), validatePaymentWithGateway: vi.fn() }));
vi.mock("../src/config/sslcommerz.js", async (importOriginal) => ({
  ...(await importOriginal<typeof SslCommerzModule>()),
  ...gateway,
}));

const API = "/api/v1";
const STORE_PASSWORD = "teamflow-test-password"; // from vitest.config.ts
const md5 = (value: string) => createHash("md5").update(value).digest("hex");

/** Builds an IPN body signed the way SSLCommerz signs it. */
const signIpn = (fields: Record<string, string>) => {
  const data: Record<string, string> = { ...fields, store_passwd: md5(STORE_PASSWORD) };
  const hashString = Object.keys(data).sort().map((key) => `${key}=${data[key]}`).join("&");
  return { ...fields, verify_key: Object.keys(fields).join(","), verify_sign: md5(hashString) };
};

const validValidation = (tranId: string, overrides: Record<string, string> = {}) => ({
  status: "VALID",
  tran_id: tranId,
  val_id: `VAL-${tranId}`,
  amount: "1500.00",
  currency_type: "BDT",
  currency_amount: "1500.00",
  bank_tran_id: "BANK123",
  card_type: "VISA-Dutch Bangla",
  ...overrides,
});

let plans: Awaited<ReturnType<typeof seedPlans>>;

const setup = async () => {
  const { owner, organization } = await createOrganizationWithOwner();
  return { owner, organization, auth: bearerFor(owner) };
};

const initiate = async (auth: string) => {
  const res = await request(app).post(`${API}/payments/initiate`).set("Authorization", auth).send({ planId: plans.pro.id });
  expect(res.status).toBe(201);
  return res.body.data as { transactionId: string; paymentId: string; gatewayUrl: string };
};

beforeEach(async () => {
  await resetDatabase();
  plans = await seedPlans();
  gateway.initPaymentSession.mockReset().mockResolvedValue({
    gatewayUrl: "https://sandbox.sslcommerz.com/EasyCheckOut/testcde123",
    sessionKey: "SESSION123",
  });
  gateway.validatePaymentWithGateway.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /plans", () => {
  it("is public and lists active plans by price", async () => {
    await prisma.subscriptionPlan.create({ data: { name: "LEGACY", price: "99.00", maxMembers: 3, isActive: false } });

    const res = await request(app).get(`${API}/plans`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ name: "FREE", price: "0.00", maxMembers: 5, maxProjects: 2, durationDays: null }),
      expect.objectContaining({ name: "PRO", price: "1500.00", currency: "BDT", maxMembers: 25, maxProjects: null, durationDays: 30 }),
    ]);
  });
});

describe("GET /subscriptions/current", () => {
  it("shows the FREE plan and usage to the owner only", async () => {
    const { organization, auth } = await setup();
    const { user: member } = await addMemberTo(organization.id);

    const res = await request(app).get(`${API}/subscriptions/current`).set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ plan: { name: "FREE" }, subscription: { status: "ACTIVE", endDate: null }, usage: { members: 2, activeProjects: 0 } });

    expect((await request(app).get(`${API}/subscriptions/current`).set("Authorization", bearerFor(member))).status).toBe(403);
  });

  it("marks ended subscriptions EXPIRED and falls back to FREE", async () => {
    const { organization, auth } = await setup();
    const expired = await prisma.subscription.create({
      data: {
        organizationId: organization.id,
        planId: plans.pro.id,
        status: "ACTIVE",
        startDate: new Date(Date.now() - 40 * 86_400_000),
        endDate: new Date(Date.now() - 10 * 86_400_000),
      },
    });

    const res = await request(app).get(`${API}/subscriptions/current`).set("Authorization", auth);

    expect(res.body.data.plan.name).toBe("FREE");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe("EXPIRED");
  });
});

describe("POST /payments/initiate", () => {
  it("creates a pending payment + subscription and returns the gateway URL", async () => {
    const { owner, organization, auth } = await setup();

    const data = await initiate(auth);

    expect(data.gatewayUrl).toMatch(/^https:\/\/sandbox\.sslcommerz\.com\//);
    expect(data.transactionId).toMatch(/^TF[0-9A-Z]{18,26}$/);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: data.paymentId }, include: { subscription: true } });
    expect(payment).toMatchObject({ status: "PENDING", currency: "BDT", organizationId: organization.id });
    expect(payment.amount.toFixed(2)).toBe("1500.00");
    expect(payment.subscription).toMatchObject({ status: "PENDING", planId: plans.pro.id, startDate: null });

    expect(gateway.initPaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: data.transactionId,
        amount: "1500.00",
        currency: "BDT",
        customer: { name: owner.name, email: owner.email },
        urls: expect.objectContaining({
          success: "http://localhost:5000/api/v1/payments/validate",
          ipn: "http://localhost:5000/api/v1/payments/ipn",
        }) as unknown,
      }),
    );
    expect(await prisma.auditLog.count({ where: { action: "PAYMENT_INITIATED" } })).toBe(1);
  });

  it("rejects the FREE plan, unknown or inactive plans, members and bad input", async () => {
    const { organization, auth } = await setup();
    const { user: member } = await addMemberTo(organization.id);
    const inactive = await prisma.subscriptionPlan.create({ data: { name: "OLD", price: "500.00", maxMembers: 10, isActive: false } });
    const post = (body: object, authHeader = auth) =>
      request(app).post(`${API}/payments/initiate`).set("Authorization", authHeader).send(body);

    expect((await post({ planId: plans.free.id })).status).toBe(400);
    expect((await post({ planId: inactive.id })).status).toBe(404);
    expect((await post({ planId: crypto.randomUUID() })).status).toBe(404);
    expect((await post({ planId: "pro" })).status).toBe(422);
    expect((await post({ planId: plans.pro.id, amount: "1.00" })).status).toBe(422);
    expect((await post({ planId: plans.pro.id }, bearerFor(member))).status).toBe(403);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("marks the payment FAILED when the gateway refuses the session", async () => {
    const { auth } = await setup();
    gateway.initPaymentSession.mockRejectedValue(new AppError(502, "Payment gateway could not start the session: Store Credential Error"));

    const res = await request(app).post(`${API}/payments/initiate`).set("Authorization", auth).send({ planId: plans.pro.id });

    expect(res.status).toBe(502);
    const payment = await prisma.payment.findFirstOrThrow({ include: { subscription: true } });
    expect(payment.status).toBe("FAILED");
    expect(payment.subscription.status).toBe("CANCELLED");
  });
});

describe("POST /payments/validate", () => {
  it("activates PRO only after gateway validation, and PRO limits apply", async () => {
    const { organization, auth } = await setup();
    const { transactionId } = await initiate(auth);
    gateway.validatePaymentWithGateway.mockResolvedValue(validValidation(transactionId));

    const res = await request(app).post(`${API}/payments/validate`).send({ tran_id: transactionId, val_id: `VAL-${transactionId}`, status: "VALID" });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ transactionId, status: "SUCCESS", alreadyProcessed: false });
    expect(gateway.validatePaymentWithGateway).toHaveBeenCalledWith(`VAL-${transactionId}`);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { transactionId }, include: { subscription: true } });
    expect(payment.status).toBe("SUCCESS");
    expect(payment.paidAt).not.toBeNull();
    expect(payment.gatewayResponse).toMatchObject({ bank_tran_id: "BANK123", status: "VALID" });
    const { startDate, endDate } = payment.subscription;
    expect(payment.subscription.status).toBe("ACTIVE");
    expect((endDate!.getTime() - startDate!.getTime()) / 86_400_000).toBe(30);

    const current = await request(app).get(`${API}/subscriptions/current`).set("Authorization", auth);
    expect(current.body.data.plan.name).toBe("PRO");

    // PRO allows more than the 5 FREE members.
    for (let i = 0; i < 4; i += 1) await addMemberTo(organization.id);
    const sixth = await createUser();
    expect((await request(app).post(`${API}/organizations/current/members`).set("Authorization", auth).send({ email: sixth.email })).status).toBe(201);
  });

  it("processes duplicate callbacks only once (sequential and concurrent)", async () => {
    const { auth } = await setup();
    const { transactionId } = await initiate(auth);
    gateway.validatePaymentWithGateway.mockResolvedValue(validValidation(transactionId));
    const callback = () => request(app).post(`${API}/payments/validate`).send({ tran_id: transactionId, val_id: `VAL-${transactionId}` });

    const [first, second] = await Promise.all([callback(), callback()]);
    const third = await callback();

    const flags = [first, second, third].map((r) => r.body.data.alreadyProcessed as boolean);
    expect(flags.filter((flag) => !flag)).toHaveLength(1);
    expect([first, second, third].every((r) => r.body.data.status === "SUCCESS")).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "SUBSCRIPTION_ACTIVATED" } })).toBe(1);
    expect(await prisma.subscription.count({ where: { status: "ACTIVE", planId: plans.pro.id } })).toBe(1);
  });

  it("rejects amount or currency mismatches and invalid gateway statuses", async () => {
    const { auth } = await setup();
    const tampered = await initiate(auth);
    gateway.validatePaymentWithGateway.mockResolvedValue(validValidation(tampered.transactionId, { currency_amount: "15.00", amount: "15.00" }));

    const res = await request(app).post(`${API}/payments/validate`).send({ tran_id: tampered.transactionId, val_id: "VAL-X" });

    expect(res.body.data.status).toBe("FAILED");
    expect(res.body.data.reasons).toEqual([expect.stringMatching(/Amount mismatch/)]);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { transactionId: tampered.transactionId }, include: { subscription: true } });
    expect(payment.status).toBe("FAILED");
    expect(payment.subscription.status).toBe("CANCELLED");

    const invalid = await initiate(auth);
    gateway.validatePaymentWithGateway.mockResolvedValue({ status: "INVALID_TRANSACTION" });
    const invalidRes = await request(app).post(`${API}/payments/validate`).send({ tran_id: invalid.transactionId, val_id: "VAL-Y" });
    expect(invalidRes.body.data.status).toBe("FAILED");

    const current = await request(app).get(`${API}/subscriptions/current`).set("Authorization", auth);
    expect(current.body.data.plan.name).toBe("FREE");
  });

  it("never activates from a success redirect without a validation id", async () => {
    const { auth } = await setup();
    const { transactionId } = await initiate(auth);

    const res = await request(app).post(`${API}/payments/validate`).send({ tran_id: transactionId, status: "VALID" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PENDING");
    expect(gateway.validatePaymentWithGateway).not.toHaveBeenCalled();
    expect((await prisma.payment.findUniqueOrThrow({ where: { transactionId } })).status).toBe("PENDING");
  });

  it("records failed and cancelled payments", async () => {
    const { auth } = await setup();
    const failed = await initiate(auth);
    const cancelled = await initiate(auth);

    await request(app).post(`${API}/payments/validate`).send({ tran_id: failed.transactionId, status: "FAILED" });
    await request(app).post(`${API}/payments/validate`).send({ tran_id: cancelled.transactionId, status: "CANCELLED" });

    expect((await prisma.payment.findUniqueOrThrow({ where: { transactionId: failed.transactionId } })).status).toBe("FAILED");
    expect((await prisma.payment.findUniqueOrThrow({ where: { transactionId: cancelled.transactionId } })).status).toBe("CANCELLED");
    expect(await prisma.auditLog.count({ where: { action: "PAYMENT_FAILED" } })).toBe(2);
  });

  it("returns 404 for an unknown transaction id", async () => {
    const res = await request(app).post(`${API}/payments/validate`).send({ tran_id: "TF-DOES-NOT-EXIST", val_id: "VAL-1" });
    expect(res.status).toBe(404);
    expect(gateway.validatePaymentWithGateway).not.toHaveBeenCalled();
  });

  it("redirects the customer's browser to the frontend result page", async () => {
    const { auth } = await setup();
    const { transactionId } = await initiate(auth);
    gateway.validatePaymentWithGateway.mockResolvedValue(validValidation(transactionId));

    const res = await request(app)
      .post(`${API}/payments/validate`)
      .type("form")
      .send({ tran_id: transactionId, val_id: `VAL-${transactionId}`, status: "VALID" });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`http://localhost:3000/payment/result?status=success&transactionId=${transactionId}`);
  });

  it("extends a running PRO period instead of overlapping it", async () => {
    const { organization, auth } = await setup();
    const runningEnd = new Date(Date.now() + 10 * 86_400_000);
    await prisma.subscription.create({
      data: { organizationId: organization.id, planId: plans.pro.id, status: "ACTIVE", startDate: new Date(), endDate: runningEnd },
    });
    const { transactionId } = await initiate(auth);
    gateway.validatePaymentWithGateway.mockResolvedValue(validValidation(transactionId));

    await request(app).post(`${API}/payments/validate`).send({ tran_id: transactionId, val_id: "VAL-1" });

    const renewed = await prisma.payment.findUniqueOrThrow({ where: { transactionId }, include: { subscription: true } });
    expect(renewed.subscription.startDate?.getTime()).toBe(runningEnd.getTime());
    expect(renewed.subscription.endDate?.getTime()).toBe(runningEnd.getTime() + 30 * 86_400_000);

    const current = await request(app).get(`${API}/subscriptions/current`).set("Authorization", auth);
    expect(current.body.data.upcoming).toHaveLength(1);
  });
});

describe("POST /payments/ipn", () => {
  it("accepts a correctly signed IPN and activates the subscription", async () => {
    const { auth } = await setup();
    const { transactionId } = await initiate(auth);
    gateway.validatePaymentWithGateway.mockResolvedValue(validValidation(transactionId));

    const body = signIpn({ tran_id: transactionId, val_id: `VAL-${transactionId}`, status: "VALID", amount: "1500.00", currency: "BDT" });
    const res = await request(app).post(`${API}/payments/ipn`).type("form").send(body);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("SUCCESS");
    expect((await prisma.payment.findUniqueOrThrow({ where: { transactionId } })).status).toBe("SUCCESS");

    // The browser redirect arriving later is a no-op.
    const redirect = await request(app).post(`${API}/payments/validate`).send({ tran_id: transactionId, val_id: `VAL-${transactionId}` });
    expect(redirect.body.data.alreadyProcessed).toBe(true);
  });

  it("rejects an IPN with a forged or missing signature", async () => {
    const { auth } = await setup();
    const { transactionId } = await initiate(auth);
    const signed = signIpn({ tran_id: transactionId, val_id: "VAL-1", status: "VALID", amount: "1500.00" });

    const tampered = await request(app).post(`${API}/payments/ipn`).type("form").send({ ...signed, amount: "1.00" });
    const unsigned = await request(app).post(`${API}/payments/ipn`).type("form").send({ tran_id: transactionId, val_id: "VAL-1" });

    expect(tampered.status).toBe(400);
    expect(tampered.body.message).toBe("Invalid IPN signature");
    expect(unsigned.status).toBe(400);
    expect(gateway.validatePaymentWithGateway).not.toHaveBeenCalled();
    expect((await prisma.payment.findUniqueOrThrow({ where: { transactionId } })).status).toBe("PENDING");
  });
});

describe("GET /payments/history", () => {
  it("lists only this organization's payments, newest first, for the owner", async () => {
    const { organization, auth } = await setup();
    const { user: member } = await addMemberTo(organization.id);
    const first = await initiate(auth);
    const second = await initiate(auth);
    const other = await setup();
    await initiate(other.auth);

    const res = await request(app).get(`${API}/payments/history?limit=10`).set("Authorization", auth);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    expect((res.body.data as { transactionId: string }[]).map((p) => p.transactionId)).toEqual([second.transactionId, first.transactionId]);
    expect(res.body.data[0]).toMatchObject({ amount: "1500.00", currency: "BDT", status: "PENDING", plan: "PRO" });
    expect(res.body.data[0]).not.toHaveProperty("gatewayResponse");

    expect((await request(app).get(`${API}/payments/history`).set("Authorization", bearerFor(member))).status).toBe(403);
  });
});
