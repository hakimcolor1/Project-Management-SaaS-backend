import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { getMyProfile, updateMyProfile } from "./user.controller.js";
import { updateProfileSchema } from "./user.validation.js";

/**
 * Mounted at /users. The SUPER_ADMIN user directory lives under
 * /admin/users (admin.route.ts) and reuses this module's controller.
 */
export const userRoutes = Router();

userRoutes.get("/me", authenticate, getMyProfile);
userRoutes.patch("/me", authenticate, validate({ body: updateProfileSchema }), updateMyProfile);
