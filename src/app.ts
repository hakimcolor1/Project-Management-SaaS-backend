import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { env, isProduction, isTest } from "./config/env.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { notFound } from "./middlewares/not-found.middleware.js";
import { apiRouter } from "./routes/index.js";
import { sendError, sendSuccess } from "./utils/response.js";

const app: Express = express();

// Vercel sits in front of the app: trust exactly one proxy hop so req.ip
// (rate limiting) and req.secure (cookies) reflect the real client.
if (isProduction) {
  app.set("trust proxy", 1);
}

// ── Security & parsing ────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    // Exact origin match; credentials are required for HTTP-only auth cookies.
    origin: new URL(env.FRONTEND_URL).origin,
    credentials: true,
  }),
);
app.use(express.json({ limit: "100kb" }));
// Payment gateway callbacks (SSLCommerz) post form-encoded bodies.
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(cookieParser());

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => isTest,
    handler: (_req, res) => {
      sendError(res, 429, "Too many requests, please try again later");
    },
  }),
);

// ── Routes ────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  sendSuccess(res, {
    message: "Welcome to the TeamFlow API",
    data: { name: "TeamFlow API", version: "v1", health: "/api/v1/health" },
  });
});

app.use("/api/v1", apiRouter);

// ── Fallbacks (must stay last) ───────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;
