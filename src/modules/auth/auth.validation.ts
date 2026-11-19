import { z } from "zod";
import { strongPasswordSchema } from "../../utils/password.js";
import { emailSchema } from "../../utils/validation.js";

// Bodies are strict: unknown keys (e.g. `role`) are rejected with 422, so a
// client can never choose its own role or set protected fields.

export const registerSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be at most 100 characters"),
  email: emailSchema,
  password: strongPasswordSchema,
});

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(200, "Password is too long"),
});

export const googleLoginSchema = z.strictObject({
  idToken: z.string().trim().min(1, "Google ID token is required").max(4096, "Google ID token is too long"),
});

/** Refresh / logout: the token normally comes from the HTTP-only cookie; API clients may send it in the body. */
export const refreshTokenBodySchema = z.strictObject({
  refreshToken: z.string().min(1).max(2048).optional(),
});
