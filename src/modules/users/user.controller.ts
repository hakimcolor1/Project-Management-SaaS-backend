import type { RequestHandler } from "express";
import { getAuthUser } from "../../middlewares/auth.middleware.js";
import { sendSuccess } from "../../utils/response.js";
import type { ListUsersQuery, UpdateProfileInput } from "./user.interface.js";
import { userService } from "./user.service.js";

/** GET /users/me (GET /auth/me returns the same profile). */
export const getMyProfile: RequestHandler = async (req, res) => {
  const user = await userService.getProfile(getAuthUser(req).id);
  sendSuccess(res, { message: "Profile retrieved successfully", data: user });
};

/** PATCH /users/me */
export const updateMyProfile: RequestHandler = async (req, res) => {
  const user = await userService.updateProfile(getAuthUser(req).id, req.body as UpdateProfileInput);
  sendSuccess(res, { message: "Profile updated successfully", data: user });
};

/** GET /admin/users (mounted by the admin router, SUPER_ADMIN only). */
export const listUsers: RequestHandler = async (req, res) => {
  const { users, meta } = await userService.listUsers(req.query as unknown as ListUsersQuery);
  sendSuccess(res, { message: "Users retrieved successfully", data: users, meta });
};
