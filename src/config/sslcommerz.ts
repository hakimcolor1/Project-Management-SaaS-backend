import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "../utils/app-error.js";
import { env } from "./env.js";

/**
 * SSLCommerz client for the official v4 APIs (the same endpoints the official
 * `sslcommerz-lts` package calls), written with native fetch so that we get
 * timeouts, URL encoding, typed responses and real errors – the official
 * package resolves network failures as if they were responses.
 *
 * Sandbox is used unless SSL_IS_LIVE=true.
 */
const BASE_URL = env.SSL_IS_LIVE ? "https://securepay.sslcommerz.com" : "https://sandbox.sslcommerz.com";
const REQUEST_TIMEOUT_MS = 15_000;

export const isSslCommerzConfigured = (): boolean => Boolean(env.SSL_STORE_ID && env.SSL_STORE_PASSWORD);

const getCredentials = () => {
  if (!env.SSL_STORE_ID || !env.SSL_STORE_PASSWORD) {
    throw new AppError(503, "Payment gateway is not configured on this server");
  }
  return { store_id: env.SSL_STORE_ID, store_passwd: env.SSL_STORE_PASSWORD };
};

const md5 = (value: string) => createHash("md5").update(value).digest("hex");

const requestJson = async (url: string, init: RequestInit): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new AppError(502, "Payment gateway is unreachable. Please try again later.");
  }
  if (!response.ok) {
    throw new AppError(502, `Payment gateway responded with HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new AppError(502, "Payment gateway returned an invalid response");
  }
};

// ── Session initiation ───────────────────────────────────────────────

export interface PaymentSessionRequest {
  transactionId: string;
  /** Decimal string, e.g. "1500.00". */
  amount: string;
  currency: string;
  productName: string;
  customer: { name: string; email: string };
  urls: { success: string; fail: string; cancel: string; ipn: string };
}

export interface PaymentSession {
  gatewayUrl: string;
  sessionKey: string;
}

const sessionResponseSchema = z.looseObject({
  status: z.string(),
  failedreason: z.string().optional(),
  sessionkey: z.string().optional(),
  GatewayPageURL: z.string().optional(),
});

export const initPaymentSession = async (request: PaymentSessionRequest): Promise<PaymentSession> => {
  const body = new URLSearchParams({
    ...getCredentials(),
    total_amount: request.amount,
    currency: request.currency,
    tran_id: request.transactionId,
    success_url: request.urls.success,
    fail_url: request.urls.fail,
    cancel_url: request.urls.cancel,
    ipn_url: request.urls.ipn,
    cus_name: request.customer.name,
    cus_email: request.customer.email,
    cus_add1: "N/A",
    cus_city: "Dhaka",
    cus_postcode: "1000",
    cus_country: "Bangladesh",
    cus_phone: "N/A",
    shipping_method: "NO",
    product_name: request.productName,
    product_category: "Subscription",
    product_profile: "non-physical-goods",
  });

  const parsed = sessionResponseSchema.safeParse(
    await requestJson(`${BASE_URL}/gwprocess/v4/api.php`, { method: "POST", body }),
  );
  if (!parsed.success || parsed.data.status !== "SUCCESS" || !parsed.data.GatewayPageURL || !parsed.data.sessionkey) {
    const reason = parsed.success ? parsed.data.failedreason : undefined;
    throw new AppError(502, `Payment gateway could not start the session${reason ? `: ${reason}` : ""}`);
  }
  return { gatewayUrl: parsed.data.GatewayPageURL, sessionKey: parsed.data.sessionkey };
};

// ── Order validation ─────────────────────────────────────────────────

const validationResponseSchema = z.looseObject({
  status: z.string(),
  tran_id: z.string().optional(),
  val_id: z.string().optional(),
  amount: z.string().optional(),
  currency_type: z.string().optional(),
  currency_amount: z.string().optional(),
  bank_tran_id: z.string().optional(),
  card_type: z.string().optional(),
  card_issuer: z.string().optional(),
  risk_level: z.string().optional(),
  risk_title: z.string().optional(),
  tran_date: z.string().optional(),
});

export type GatewayValidation = z.infer<typeof validationResponseSchema>;

/** Asks SSLCommerz directly whether `val_id` is a real, valid payment (never trust the callback alone). */
export const validatePaymentWithGateway = async (valId: string): Promise<GatewayValidation> => {
  const query = new URLSearchParams({ val_id: valId, ...getCredentials(), v: "1", format: "json" });
  const parsed = validationResponseSchema.safeParse(
    await requestJson(`${BASE_URL}/validator/api/validationserverAPI.php?${query.toString()}`, { method: "GET" }),
  );
  if (!parsed.success) {
    throw new AppError(502, "Payment gateway returned an invalid validation response");
  }
  return parsed.data;
};

// ── IPN authenticity ─────────────────────────────────────────────────

/**
 * IPN signature check as specified by SSLCommerz: take the fields named in
 * `verify_key`, add `store_passwd` = md5(store password), sort by key, join
 * as `key=value&…`, and compare md5 of that string with `verify_sign`.
 */
export const verifyIpnSignature = (payload: Record<string, unknown>): boolean => {
  const { store_passwd } = getCredentials();
  const { verify_sign: verifySign, verify_key: verifyKey } = payload;
  if (typeof verifySign !== "string" || typeof verifyKey !== "string" || !verifyKey) {
    return false;
  }

  const fields: Record<string, string> = {};
  for (const key of verifyKey.split(",").filter(Boolean)) {
    const value = payload[key];
    fields[key] = typeof value === "string" ? value : "";
  }
  fields.store_passwd = md5(store_passwd);

  const hashString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("&");

  const expected = Buffer.from(md5(hashString));
  const received = Buffer.from(verifySign.toLowerCase());
  return expected.length === received.length && timingSafeEqual(expected, received);
};
