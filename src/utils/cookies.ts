import type { CookieOptions, Request, Response } from "express";
import { isProduction } from "../config/env.js";
import type { AuthTokens } from "../modules/auth/auth.interface.js";
import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS } from "./jwt.js";

export const ACCESS_TOKEN_COOKIE = "accessToken";
export const REFRESH_TOKEN_COOKIE = "refreshToken";

const baseCookieOptions: CookieOptions = {
  httpOnly: true, // not readable from JavaScript
  secure: isProduction, // HTTPS only in production
  // In production the frontend and API are on different sites, which needs
  // SameSite=None (+Secure). Locally both run on localhost, so Lax works.
  sameSite: isProduction ? "none" : "lax",
};

const accessCookieOptions: CookieOptions = { ...baseCookieOptions, path: "/" };

// The refresh token is only ever sent to the auth endpoints that use it.
const refreshCookieOptions: CookieOptions = { ...baseCookieOptions, path: "/api/v1/auth" };

export const setAuthCookies = (res: Response, { accessToken, refreshToken }: AuthTokens): void => {
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, { ...accessCookieOptions, maxAge: ACCESS_TOKEN_TTL_MS });
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_TTL_MS });
};

export const clearAuthCookies = (res: Response): void => {
  res.clearCookie(ACCESS_TOKEN_COOKIE, accessCookieOptions);
  res.clearCookie(REFRESH_TOKEN_COOKIE, refreshCookieOptions);
};

export const readCookie = (req: Request, name: string): string | undefined => {
  const cookies: unknown = req.cookies;
  if (!cookies || typeof cookies !== "object") return undefined;
  const value = (cookies as Record<string, unknown>)[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};
