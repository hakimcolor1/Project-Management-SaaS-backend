import { Router } from "express";
import { completeGoogleOAuth, startGoogleOAuth } from "../../config/passport.js";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { authRateLimiter } from "../../middlewares/rate-limit.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { getMe, googleLogin, googleOAuthCallback, login, logout, refreshToken, register } from "./auth.controller.js";
import { googleLoginSchema, loginSchema, refreshTokenBodySchema, registerSchema } from "./auth.validation.js";

export const authRoutes = Router();

authRoutes.post("/register", authRateLimiter, validate({ body: registerSchema }), register);
authRoutes.post("/login", authRateLimiter, validate({ body: loginSchema }), login);

// Google sign-in: ID-token flow (POST) and browser redirect flow (GET).
authRoutes.post("/google", authRateLimiter, validate({ body: googleLoginSchema }), googleLogin);
authRoutes.get("/google", authRateLimiter, startGoogleOAuth);
authRoutes.get("/google/callback", authRateLimiter, completeGoogleOAuth, googleOAuthCallback);

authRoutes.post("/refresh-token", validate({ body: refreshTokenBodySchema }), refreshToken);
authRoutes.post("/logout", validate({ body: refreshTokenBodySchema }), logout);
authRoutes.get("/me", authenticate, getMe);
