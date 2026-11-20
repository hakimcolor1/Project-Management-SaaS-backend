import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { env, isProduction } from "./config/env.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { notFound } from "./middlewares/not-found.middleware.js";
import { apiRateLimiter } from "./middlewares/rate-limit.middleware.js";
import { docsRoutes } from "./modules/docs/docs.route.js";
import { apiRouter } from "./routes/index.js";
import { sendSuccess } from "./utils/response.js";

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
// JSON only. Form-encoded bodies are deliberately NOT parsed globally: auth
// cookies are SameSite=None in production, and a cross-site HTML form can
// post form data but not JSON (that needs a CORS preflight, which we reject).
// Only the payment-gateway callback routes will accept form data.
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use("/api", apiRateLimiter);

// ── Routes ────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  sendSuccess(res, {
    message: "Welcome to the TeamFlow API",
    data: { name: "TeamFlow API", version: "v1", health: "/api/v1/health", docs: "/api-docs" },
  });
});

app.use("/api-docs", docsRoutes);
app.use("/api/v1", apiRouter);

// ── Fallbacks (must stay last) ───────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;
