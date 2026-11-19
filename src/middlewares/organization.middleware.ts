import type { Request, RequestHandler } from "express";
import { prisma } from "../config/database.js";
import type { OrganizationStatus } from "../generated/prisma/enums.js";
import { AppError } from "../utils/app-error.js";
import { getAuthUser } from "./auth.middleware.js";
import { authorize } from "./role.middleware.js";

/** The caller's organization, attached by `requireOrganization`. */
export interface OrganizationContext {
  id: string;
  ownerId: string;
  status: OrganizationStatus;
  /** True when the caller owns this organization. */
  isOwner: boolean;
}

/**
 * Resolves the caller's organization from their membership – never from a
 * client-supplied id – so every tenant query is scoped to the right
 * organization. Suspended organizations are blocked unless allowed.
 */
export const requireOrganization =
  ({ allowSuspended = false }: { allowSuspended?: boolean } = {}): RequestHandler =>
  async (req, _res, next) => {
    const user = getAuthUser(req);

    const membership = await prisma.organizationMember.findUnique({
      where: { userId: user.id },
      select: { organization: { select: { id: true, ownerId: true, status: true, deletedAt: true } } },
    });
    const organization = membership?.organization;

    if (!organization || organization.deletedAt) {
      throw AppError.notFound("You are not a member of any organization");
    }
    if (organization.status === "SUSPENDED" && !allowSuspended) {
      throw AppError.forbidden("Your organization has been suspended. Please contact support.");
    }

    req.organization = {
      id: organization.id,
      ownerId: organization.ownerId,
      status: organization.status,
      isOwner: organization.ownerId === user.id,
    };
    next();
  };

/** Organization-level ownership check (use after `requireOrganization`). */
export const requireOrganizationOwner: RequestHandler = (req, _res, next) => {
  if (!req.organization?.isOwner) {
    next(AppError.forbidden("Only the organization owner can perform this action"));
    return;
  }
  next();
};

export const getOrganizationContext = (req: Request): OrganizationContext => {
  if (!req.organization) {
    throw AppError.notFound("You are not a member of any organization");
  }
  return req.organization;
};

/** Any member (owner or team member) of an active organization. */
export const organizationMemberAccess = (options?: { allowSuspended?: boolean }): RequestHandler[] => [
  authorize("TEAM_OWNER", "TEAM_MEMBER"),
  requireOrganization(options),
];

/** Only the owner of an active organization. */
export const organizationOwnerAccess = (): RequestHandler[] => [
  authorize("TEAM_OWNER"),
  requireOrganization(),
  requireOrganizationOwner,
];
