import { z } from "zod";

// Load `.env` for local development. Real environment variables (Vercel, CI)
// always win because loadEnvFile never overrides existing values.
// Tests get their configuration from vitest.config.ts instead.
if (process.env.NODE_ENV !== "test") {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file – rely on the process environment.
  }
}

/** Durations such as "15m", "7d", "3600s" (understood by JWT and our helpers). */
const durationSchema = z
  .string()
  .regex(/^\d+[smhd]$/, 'Must be a duration like "15m", "12h" or "7d"');

const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const optionalString = z.string().min(1).optional();
const optionalUrl = z.url().optional();

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),

    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, "Must be a PostgreSQL connection string"),

    JWT_ACCESS_SECRET: z.string().min(32, "Must be at least 32 characters"),
    JWT_REFRESH_SECRET: z.string().min(32, "Must be at least 32 characters"),
    JWT_ACCESS_EXPIRES_IN: durationSchema.default("15m"),
    JWT_REFRESH_EXPIRES_IN: durationSchema.default("7d"),

    // Google OAuth (Phase 2) – optional until configured.
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GOOGLE_CALLBACK_URL: optionalUrl,

    FRONTEND_URL: z.url().default("http://localhost:3000"),
    BACKEND_URL: z.url().default("http://localhost:5000"),

    // SSLCommerz (Phase 4) – optional until configured; never faked.
    SSL_STORE_ID: optionalString,
    SSL_STORE_PASSWORD: optionalString,
    SSL_IS_LIVE: booleanString.default(false),

    // Upstash Redis REST credentials (Phase 4) – caching is skipped when unset.
    REDIS_URL: optionalUrl,
    REDIS_TOKEN: optionalString,

    // Only read by `prisma/seed.ts`.
    DEMO_ADMIN_EMAIL: z.email().optional(),
    DEMO_ADMIN_PASSWORD: optionalString,
  })
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    message: "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different",
    path: ["JWT_REFRESH_SECRET"],
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates a raw environment object. Empty strings (e.g. `KEY=` copied from
 * .env.example) are treated as "not set".
 */
export const parseEnv = (raw: NodeJS.ProcessEnv): Env => {
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = envSchema.safeParse(cleaned);

  if (!result.success) {
    // Report variable names and reasons only – never the values.
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
};

export const env = parseEnv(process.env);

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
