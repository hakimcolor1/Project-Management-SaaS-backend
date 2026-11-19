import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { UserRole } from "../generated/prisma/enums.js";

const JWT_ALGORITHM = "HS256";
const JWT_ISSUER = "teamflow-api";
const JWT_AUDIENCE = "teamflow-client";

export interface AccessTokenPayload {
  userId: string;
  role: UserRole;
}

export interface RefreshTokenPayload {
  userId: string;
  /** Matches RefreshToken.id in the database (JWT `jti`). */
  tokenId: string;
}

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Converts "15m" / "7d" style durations to milliseconds. */
export const durationToMs = (duration: string): number => {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid duration "${duration}"`);
  }
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
};

export const ACCESS_TOKEN_TTL_MS = durationToMs(env.JWT_ACCESS_EXPIRES_IN);
export const REFRESH_TOKEN_TTL_MS = durationToMs(env.JWT_REFRESH_EXPIRES_IN);

// Claims are re-validated after signature verification so a token signed
// with the right key but the wrong shape/type is still rejected.
const accessClaimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(UserRole),
  type: z.literal("access"),
});

const refreshClaimsSchema = z.object({
  sub: z.string().min(1),
  jti: z.string().min(1),
  type: z.literal("refresh"),
});

const verifyOptions: jwt.VerifyOptions = {
  algorithms: [JWT_ALGORITHM],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
};

const parseClaims = <T>(schema: z.ZodType<T>, decoded: string | jwt.JwtPayload): T => {
  const result = schema.safeParse(decoded);
  if (!result.success) {
    throw new jwt.JsonWebTokenError("Invalid token payload");
  }
  return result.data;
};

export const signAccessToken = ({ userId, role }: AccessTokenPayload): string =>
  jwt.sign({ role, type: "access" }, env.JWT_ACCESS_SECRET, {
    algorithm: JWT_ALGORITHM,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    subject: userId,
    expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
  });

/** Throws jsonwebtoken errors (TokenExpiredError / JsonWebTokenError) when invalid. */
export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const claims = parseClaims(accessClaimsSchema, jwt.verify(token, env.JWT_ACCESS_SECRET, verifyOptions));
  return { userId: claims.sub, role: claims.role };
};

export const signRefreshToken = ({ userId, tokenId }: RefreshTokenPayload): string =>
  jwt.sign({ type: "refresh" }, env.JWT_REFRESH_SECRET, {
    algorithm: JWT_ALGORITHM,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    subject: userId,
    jwtid: tokenId,
    expiresIn: Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
  });

/** Throws jsonwebtoken errors (TokenExpiredError / JsonWebTokenError) when invalid. */
export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  const claims = parseClaims(refreshClaimsSchema, jwt.verify(token, env.JWT_REFRESH_SECRET, verifyOptions));
  return { userId: claims.sub, tokenId: claims.jti };
};

/** SHA-256 hex digest – refresh tokens are stored hashed, never raw. */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
