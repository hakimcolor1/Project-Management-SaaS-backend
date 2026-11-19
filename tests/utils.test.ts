import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "../src/config/env.js";
import { AppError } from "../src/utils/app-error.js";
import {
  durationToMs,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../src/utils/jwt.js";
import { buildPaginationMeta, getPaginationArgs, paginationQuerySchema } from "../src/utils/pagination.js";
import { comparePassword, hashPassword, strongPasswordSchema } from "../src/utils/password.js";

const USER_ID = "0190f3a2-7c1e-7b3a-9f10-2d4c5e6f7a8b";

describe("pagination utils", () => {
  it("coerces query strings and applies defaults", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 10 });
    expect(paginationQuerySchema.parse({ page: "3", limit: "25" })).toEqual({ page: 3, limit: 25 });
  });

  it("rejects out-of-range values", () => {
    expect(paginationQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: "abc" }).success).toBe(false);
  });

  it("converts page/limit to skip/take", () => {
    expect(getPaginationArgs({ page: 3, limit: 10 })).toEqual({ skip: 20, take: 10 });
  });

  it("builds pagination meta", () => {
    expect(buildPaginationMeta({ page: 1, limit: 10 }, 25)).toEqual({ page: 1, limit: 10, total: 25, totalPages: 3 });
    expect(buildPaginationMeta({ page: 1, limit: 10 }, 0)).toEqual({ page: 1, limit: 10, total: 0, totalPages: 0 });
  });
});

describe("AppError", () => {
  it("maps helpers to the right status codes", () => {
    expect(AppError.badRequest().statusCode).toBe(400);
    expect(AppError.unauthorized().statusCode).toBe(401);
    expect(AppError.forbidden().statusCode).toBe(403);
    expect(AppError.notFound().statusCode).toBe(404);
    expect(AppError.conflict().statusCode).toBe(409);
    expect(AppError.validation([{ message: "x" }]).statusCode).toBe(422);
  });
});

describe("password utils", () => {
  it("hashes with bcrypt and verifies", async () => {
    const hash = await hashPassword("SecurePassword123");
    expect(hash).not.toContain("SecurePassword123");
    expect(hash.startsWith("$2b$12$")).toBe(true);
    expect(await comparePassword("SecurePassword123", hash)).toBe(true);
    expect(await comparePassword("WrongPassword123", hash)).toBe(false);
  });

  it("enforces the password policy", () => {
    expect(strongPasswordSchema.safeParse("SecurePassword123").success).toBe(true);
    expect(strongPasswordSchema.safeParse("Sh0rt").success).toBe(false);
    expect(strongPasswordSchema.safeParse("alllowercase123").success).toBe(false);
    expect(strongPasswordSchema.safeParse("NoNumbersHere").success).toBe(false);
    // 73 bytes – beyond what bcrypt can use.
    expect(strongPasswordSchema.safeParse(`Aa1${"x".repeat(70)}`).success).toBe(false);
  });
});

describe("jwt utils", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses durations", () => {
    expect(durationToMs("30s")).toBe(30_000);
    expect(durationToMs("15m")).toBe(900_000);
    expect(durationToMs("2h")).toBe(7_200_000);
    expect(durationToMs("7d")).toBe(604_800_000);
    expect(() => durationToMs("7 days")).toThrow();
  });

  it("signs and verifies access tokens", () => {
    const token = signAccessToken({ userId: USER_ID, role: "TEAM_OWNER" });
    expect(verifyAccessToken(token)).toEqual({ userId: USER_ID, role: "TEAM_OWNER" });
  });

  it("rejects tampered access tokens", () => {
    const token = signAccessToken({ userId: USER_ID, role: "TEAM_MEMBER" });
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: USER_ID, role: "SUPER_ADMIN", type: "access" })).toString(
      "base64url",
    );
    expect(() => verifyAccessToken(`${header}.${forgedPayload}.${signature}`)).toThrow(jwt.JsonWebTokenError);
  });

  it("rejects expired access tokens", () => {
    vi.useFakeTimers();
    const token = signAccessToken({ userId: USER_ID, role: "TEAM_OWNER" });
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(() => verifyAccessToken(token)).toThrow(jwt.TokenExpiredError);
  });

  it("signs and verifies refresh tokens with a token id", () => {
    const token = signRefreshToken({ userId: USER_ID, tokenId: "token-1" });
    expect(verifyRefreshToken(token)).toEqual({ userId: USER_ID, tokenId: "token-1" });
  });

  it("never accepts one token type as the other", () => {
    const access = signAccessToken({ userId: USER_ID, role: "TEAM_OWNER" });
    const refresh = signRefreshToken({ userId: USER_ID, tokenId: "token-1" });
    expect(() => verifyRefreshToken(access)).toThrow(jwt.JsonWebTokenError);
    expect(() => verifyAccessToken(refresh)).toThrow(jwt.JsonWebTokenError);
  });

  it("hashes tokens deterministically with SHA-256", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});

describe("environment validation", () => {
  const validEnv = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    JWT_ACCESS_SECRET: "a".repeat(32),
    JWT_REFRESH_SECRET: "b".repeat(32),
  };

  it("applies defaults and treats empty strings as unset", () => {
    const env = parseEnv({ ...validEnv, NODE_ENV: "production", PORT: "", SSL_STORE_ID: "" });
    expect(env.PORT).toBe(5000);
    expect(env.SSL_STORE_ID).toBeUndefined();
    expect(env.SSL_IS_LIVE).toBe(false);
    expect(env.JWT_ACCESS_EXPIRES_IN).toBe("15m");
  });

  it("fails fast on missing or invalid variables without leaking values", () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...validEnv, JWT_ACCESS_SECRET: "short-secret-value" })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv({ ...validEnv, JWT_ACCESS_SECRET: "short-secret-value" })).not.toThrow(
      /short-secret-value/,
    );
  });

  it("requires different access and refresh secrets", () => {
    expect(() => parseEnv({ ...validEnv, JWT_REFRESH_SECRET: validEnv.JWT_ACCESS_SECRET })).toThrow(
      /must be different/,
    );
  });

  it("validates duration formats", () => {
    expect(() => parseEnv({ ...validEnv, JWT_ACCESS_EXPIRES_IN: "15 minutes" })).toThrow(/JWT_ACCESS_EXPIRES_IN/);
  });
});
