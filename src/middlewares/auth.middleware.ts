import type { Request, RequestHandler } from "express";
import { prisma } from "../config/database.js";
import type { AuthUser } from "../modules/auth/auth.interface.js";
import { AppError } from "../utils/app-error.js";
import { ACCESS_TOKEN_COOKIE, readCookie } from "../utils/cookies.js";
import { verifyAccessToken } from "../utils/jwt.js";

/** Access token from `Authorization: Bearer <token>` (API clients) or the HTTP-only cookie (browsers). */
const extractAccessToken = (req: Request): string | undefined => {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token) return token;
  }
  return readCookie(req, ACCESS_TOKEN_COOKIE);
};

/**
 * Requires a valid access token. The user is re-loaded from the database on
 * every request, so deactivation and role changes take effect immediately
 * instead of waiting for the token to expire.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = extractAccessToken(req);
  if (!token) {
    throw AppError.unauthorized("Authentication required");
  }

  // Throws TokenExpiredError / JsonWebTokenError → 401 via the error middleware.
  const { userId } = verifyAccessToken(token);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!user) {
    throw AppError.unauthorized("User no longer exists");
  }
  if (!user.isActive) {
    throw AppError.forbidden("Your account has been deactivated");
  }

  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
};

/** Returns the authenticated user; use only behind `authenticate`. */
export const getAuthUser = (req: Request): AuthUser => {
  if (!req.user) {
    throw AppError.unauthorized("Authentication required");
  }
  return req.user;
};
