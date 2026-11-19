import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { authRateLimiter } from "../../middlewares/rate-limit.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { getMe, googleLogin, login, logout, refreshToken, register } from "./auth.controller.js";
import { googleLoginSchema, loginSchema, refreshTokenBodySchema, registerSchema } from "./auth.validation.js";

export const authRoutes = Router();

authRoutes.post("/register", authRateLimiter, validate({ body: registerSchema }), register);
authRoutes.post("/login", authRateLimiter, validate({ body: loginSchema }), login);
authRoutes.post("/google", authRateLimiter, validate({ body: googleLoginSchema }), googleLogin);
authRoutes.post("/refresh-token", validate({ body: refreshTokenBodySchema }), refreshToken);
authRoutes.post("/logout", validate({ body: refreshTokenBodySchema }), logout);
authRoutes.get("/me", authenticate, getMe);
