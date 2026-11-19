import type { RequestHandler } from "express";
import { getAuthUser } from "../../middlewares/auth.middleware.js";
import { getOrganizationContext } from "../../middlewares/organization.middleware.js";
import { sendSuccess } from "../../utils/response.js";
import type {
  AddMemberInput,
  CreateOrganizationInput,
  ListMembersQuery,
  UpdateMemberInput,
  UpdateOrganizationInput,
} from "./organization.interface.js";
import { organizationService } from "./organization.service.js";

type MemberParams = { memberId: string };

export const createOrganization: RequestHandler = async (req, res) => {
  const organization = await organizationService.createOrganization(
    getAuthUser(req),
    req.body as CreateOrganizationInput,
  );
  sendSuccess(res, { statusCode: 201, message: "Organization created successfully", data: organization });
};

export const getCurrentOrganization: RequestHandler = async (req, res) => {
  const organization = await organizationService.getCurrentOrganization(getOrganizationContext(req));
  sendSuccess(res, { message: "Organization retrieved successfully", data: organization });
};

export const updateCurrentOrganization: RequestHandler = async (req, res) => {
  const organization = await organizationService.updateCurrentOrganization(
    getOrganizationContext(req),
    getAuthUser(req),
    req.body as UpdateOrganizationInput,
  );
  sendSuccess(res, { message: "Organization updated successfully", data: organization });
};

export const addMember: RequestHandler = async (req, res) => {
  const member = await organizationService.addMember(
    getOrganizationContext(req),
    getAuthUser(req),
    req.body as AddMemberInput,
  );
  sendSuccess(res, { statusCode: 201, message: "Member added successfully", data: member });
};

export const listMembers: RequestHandler = async (req, res) => {
  const { members, meta } = await organizationService.listMembers(
    getOrganizationContext(req),
    req.query as unknown as ListMembersQuery,
  );
  sendSuccess(res, { message: "Members retrieved successfully", data: members, meta });
};

export const updateMember: RequestHandler = async (req, res) => {
  const member = await organizationService.updateMember(
    getOrganizationContext(req),
    getAuthUser(req),
    (req.params as MemberParams).memberId,
    req.body as UpdateMemberInput,
  );
  sendSuccess(res, { message: "Member updated successfully", data: member });
};

export const removeMember: RequestHandler = async (req, res) => {
  await organizationService.removeMember(
    getOrganizationContext(req),
    getAuthUser(req),
    (req.params as MemberParams).memberId,
  );
  sendSuccess(res, { message: "Member removed successfully" });
};
