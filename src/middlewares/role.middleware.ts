import type { RequestHandler } from "express";
import type { UserRole } from "../generated/prisma/enums.js";
import { AppError } from "../utils/app-error.js";

/**
 * Centralised role check. Use after `authenticate`:
 *   router.get("/admin/dashboard", authenticate, authorize("SUPER_ADMIN"), handler)
 * 401 when not authenticated, 403 when the role is not allowed.
 */
export const authorize =
  (...allowedRoles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) {
      next(AppError.unauthorized("Authentication required"));
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      next(AppError.forbidden());
      return;
    }
    next();
  };
