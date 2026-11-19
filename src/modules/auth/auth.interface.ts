import type { z } from "zod";
import type { UserRole } from "../../generated/prisma/enums.js";
import type { googleLoginSchema, loginSchema, refreshTokenBodySchema, registerSchema } from "./auth.validation.js";

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
export type RefreshTokenBody = z.infer<typeof refreshTokenBodySchema>;

/** The authenticated user that `authenticate` attaches to `req.user`. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
