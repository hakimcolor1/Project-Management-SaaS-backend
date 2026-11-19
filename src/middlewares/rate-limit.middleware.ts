import { rateLimit } from "express-rate-limit";
import { isTest } from "../config/env.js";
import { sendError } from "../utils/response.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Note: the default store is in-memory, i.e. per server instance. That is
// fine for a single server; on serverless it limits per warm instance.
const createLimiter = (limit: number, message: string) =>
  rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => isTest,
    handler: (_req, res) => {
      sendError(res, 429, message);
    },
  });

/** General limit for every /api request. */
export const apiRateLimiter = createLimiter(300, "Too many requests, please try again later");

/** Stricter limit for credential endpoints (register, login, Google) against brute force. */
export const authRateLimiter = createLimiter(20, "Too many authentication attempts, please try again later");
