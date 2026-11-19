import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  organizationMemberAccess,
  organizationOwnerAccess,
} from "../../middlewares/organization.middleware.js";
import { authorize } from "../../middlewares/role.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  addMember,
  createOrganization,
  getCurrentOrganization,
  listMembers,
  removeMember,
  updateCurrentOrganization,
  updateMember,
} from "./organization.controller.js";
import {
  addMemberSchema,
  createOrganizationSchema,
  listMembersQuerySchema,
  memberIdParamsSchema,
  updateMemberSchema,
  updateOrganizationSchema,
} from "./organization.validation.js";

export const organizationRoutes = Router();

organizationRoutes.use(authenticate);

organizationRoutes.post("/", authorize("TEAM_OWNER"), validate({ body: createOrganizationSchema }), createOrganization);

// Suspended organizations can still see their own status.
organizationRoutes.get("/current", organizationMemberAccess({ allowSuspended: true }), getCurrentOrganization);
organizationRoutes.patch(
  "/current",
  organizationOwnerAccess(),
  validate({ body: updateOrganizationSchema }),
  updateCurrentOrganization,
);

organizationRoutes.post(
  "/current/members",
  organizationOwnerAccess(),
  validate({ body: addMemberSchema }),
  addMember,
);
organizationRoutes.get(
  "/current/members",
  organizationMemberAccess(),
  validate({ query: listMembersQuerySchema }),
  listMembers,
);
organizationRoutes.patch(
  "/current/members/:memberId",
  organizationOwnerAccess(),
  validate({ params: memberIdParamsSchema, body: updateMemberSchema }),
  updateMember,
);
organizationRoutes.delete(
  "/current/members/:memberId",
  organizationOwnerAccess(),
  validate({ params: memberIdParamsSchema }),
  removeMember,
);
