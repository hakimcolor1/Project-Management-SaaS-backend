import type { Request, RequestHandler } from "express";
import { getAuthUser } from "../../middlewares/auth.middleware.js";
import { REFRESH_TOKEN_COOKIE, clearAuthCookies, readCookie, setAuthCookies } from "../../utils/cookies.js";
import { sendSuccess } from "../../utils/response.js";
import type { GoogleLoginInput, LoginInput, RefreshTokenBody, RegisterInput } from "./auth.interface.js";
import { userService } from "../users/user.service.js";
import { authService } from "./auth.service.js";

// Controllers only translate HTTP ⇄ service calls; bodies were already
// validated (and replaced with parsed data) by the `validate` middleware.
//
// Tokens are set as HTTP-only cookies for browsers AND returned in the body
// for API clients such as Postman or mobile apps.

/** Refresh token from the body (API clients) or the HTTP-only cookie (browsers). */
const getRefreshToken = (req: Request): string | undefined =>
  (req.body as RefreshTokenBody).refreshToken ?? readCookie(req, REFRESH_TOKEN_COOKIE);

export const register: RequestHandler = async (req, res) => {
  const user = await authService.register(req.body as RegisterInput);
  sendSuccess(res, { statusCode: 201, message: "Registration successful", data: { user } });
};

export const login: RequestHandler = async (req, res) => {
  const { user, tokens } = await authService.login(req.body as LoginInput);
  setAuthCookies(res, tokens);
  sendSuccess(res, { message: "Login successful", data: { user, ...tokens } });
};

export const googleLogin: RequestHandler = async (req, res) => {
  const { user, tokens } = await authService.loginWithGoogle(req.body as GoogleLoginInput);
  setAuthCookies(res, tokens);
  sendSuccess(res, { message: "Google login successful", data: { user, ...tokens } });
};

export const refreshToken: RequestHandler = async (req, res) => {
  const tokens = await authService.refreshTokens(getRefreshToken(req));
  setAuthCookies(res, tokens);
  sendSuccess(res, { message: "Token refreshed successfully", data: tokens });
};

export const logout: RequestHandler = async (req, res) => {
  await authService.logout(getRefreshToken(req));
  clearAuthCookies(res);
  sendSuccess(res, { message: "Logged out successfully" });
};

export const getMe: RequestHandler = async (req, res) => {
  const user = await userService.getProfile(getAuthUser(req).id);
  sendSuccess(res, { message: "Current user retrieved successfully", data: user });
};
