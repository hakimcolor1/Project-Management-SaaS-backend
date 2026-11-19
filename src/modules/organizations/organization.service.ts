import { randomBytes } from "node:crypto";
import { prisma } from "../../config/database.js";
import type { OrganizationContext } from "../../middlewares/organization.middleware.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthUser } from "../auth/auth.interface.js";
import { AppError } from "../../utils/app-error.js";
import { AuditAction, AuditEntity, recordAuditLog } from "../../utils/audit-log.js";
import { buildPaginationMeta, getPaginationArgs } from "../../utils/pagination.js";
import {
  assertMemberLimit,
  getEffectivePlan,
  getFreePlan,
  lockOrganization,
} from "../subscriptions/subscription.service.js";
import type {
  AddMemberInput,
  CreateOrganizationInput,
  ListMembersQuery,
  UpdateMemberInput,
  UpdateOrganizationInput,
} from "./organization.interface.js";

const organizationSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

const memberSelect = {
  id: true,
  joinedAt: true,
  organization: { select: { ownerId: true } },
  user: { select: { id: true, name: true, email: true, avatar: true, role: true, isActive: true } },
} satisfies Prisma.OrganizationMemberSelect;

type MemberRecord = Prisma.OrganizationMemberGetPayload<{ select: typeof memberSelect }>;

const toMemberView = ({ organization, ...member }: MemberRecord) => ({
  ...member,
  isOwner: organization.ownerId === member.user.id,
});

/** URL-friendly slug with a random suffix, so names never collide. */
const createSlug = (name: string): string => {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "organization";
  return `${base}-${randomBytes(3).toString("hex")}`;
};

/** Finds a membership of THIS organization; other organizations' ids are simply "not found". */
const findMemberOrThrow = async (db: Prisma.TransactionClient, organizationId: string, memberId: string) => {
  const member = await db.organizationMember.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true, userId: true, user: { select: { email: true } } },
  });
  if (!member) {
    throw AppError.notFound("Member not found in your organization");
  }
  return member;
};

/**
 * Creates the organization, the owner's membership and a FREE subscription
 * in one transaction. A user can own – and belong to – only one organization.
 */
const createOrganization = async (actor: AuthUser, input: CreateOrganizationInput) =>
  prisma.$transaction(async (tx) => {
    const [membership, owned] = await Promise.all([
      tx.organizationMember.findUnique({ where: { userId: actor.id }, select: { id: true } }),
      tx.organization.findUnique({ where: { ownerId: actor.id }, select: { id: true } }),
    ]);
    if (owned) {
      throw AppError.conflict("You already own an organization");
    }
    if (membership) {
      throw AppError.conflict("You already belong to an organization");
    }

    const freePlan = await getFreePlan(tx);
    const now = new Date();

    const organization = await tx.organization.create({
      data: {
        name: input.name,
        slug: createSlug(input.name),
        description: input.description ?? null,
        ownerId: actor.id,
        members: { create: { userId: actor.id } },
        subscriptions: { create: { planId: freePlan.id, status: "ACTIVE", startDate: now } },
      },
      select: organizationSelect,
    });

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: organization.id,
      action: AuditAction.ORGANIZATION_CREATED,
      entity: AuditEntity.ORGANIZATION,
      entityId: organization.id,
      metadata: { name: organization.name },
    });

    return organization;
  });

const getCurrentOrganization = async (context: OrganizationContext) => {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: context.id },
    select: {
      ...organizationSelect,
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { members: true, projects: { where: { deletedAt: null } } } },
    },
  });
  const { plan, subscription } = await getEffectivePlan(context.id);
  const { _count, ...details } = organization;

  return {
    ...details,
    isOwner: context.isOwner,
    stats: { members: _count.members, projects: _count.projects },
    plan: {
      name: plan.name,
      maxMembers: plan.maxMembers,
      maxProjects: plan.maxProjects,
      maxTasksPerProject: plan.maxTasksPerProject,
      expiresAt: subscription?.endDate ?? null,
    },
  };
};

const updateCurrentOrganization = async (context: OrganizationContext, actor: AuthUser, input: UpdateOrganizationInput) =>
  prisma.$transaction(async (tx) => {
    const organization = await tx.organization.update({
      where: { id: context.id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
      },
      select: organizationSelect,
    });
    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.ORGANIZATION_UPDATED,
      entity: AuditEntity.ORGANIZATION,
      entityId: context.id,
      metadata: { fields: Object.keys(input) },
    });
    return organization;
  });

/**
 * Adds an existing TeamFlow account (by email) as a TEAM_MEMBER. The
 * organization row is locked first so the plan's member limit cannot be
 * exceeded by concurrent requests.
 */
const addMember = async (context: OrganizationContext, actor: AuthUser, { email }: AddMemberInput) =>
  prisma.$transaction(async (tx) => {
    await lockOrganization(tx, context.id);

    const user = await tx.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        isActive: true,
        ownedOrganization: { select: { id: true } },
        memberships: { select: { organizationId: true } },
      },
    });
    if (!user) {
      throw AppError.notFound("No TeamFlow account uses this email. Ask them to register first.");
    }
    if (user.role === "SUPER_ADMIN") {
      throw AppError.badRequest("Administrator accounts cannot join an organization");
    }
    if (!user.isActive) {
      throw AppError.badRequest("This account is deactivated");
    }
    const existingMembership = user.memberships[0];
    if (existingMembership?.organizationId === context.id) {
      throw AppError.conflict("This user is already a member of your organization");
    }
    if (existingMembership || user.ownedOrganization) {
      throw AppError.conflict("This user already belongs to another organization");
    }

    await assertMemberLimit(tx, context.id);

    const member = await tx.organizationMember.create({
      data: { organizationId: context.id, userId: user.id },
      select: memberSelect,
    });
    await tx.user.update({ where: { id: user.id }, data: { role: "TEAM_MEMBER" } });

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.MEMBER_ADDED,
      entity: AuditEntity.MEMBER,
      entityId: member.id,
      metadata: { memberUserId: user.id, email },
    });

    return toMemberView({ ...member, user: { ...member.user, role: "TEAM_MEMBER" } });
  });

const listMembers = async (context: OrganizationContext, query: ListMembersQuery) => {
  const where: Prisma.OrganizationMemberWhereInput = {
    organizationId: context.id,
    ...(query.search && {
      user: {
        OR: [
          { name: { contains: query.search, mode: "insensitive" } },
          { email: { contains: query.search, mode: "insensitive" } },
        ],
      },
    }),
  };

  const [members, total] = await prisma.$transaction([
    prisma.organizationMember.findMany({
      where,
      select: memberSelect,
      orderBy: { joinedAt: "asc" },
      ...getPaginationArgs(query),
    }),
    prisma.organizationMember.count({ where }),
  ]);

  return { members: members.map(toMemberView), meta: buildPaginationMeta(query, total) };
};

/** Activates or deactivates a member's account. Deactivation also ends their sessions. */
const updateMember = async (
  context: OrganizationContext,
  actor: AuthUser,
  memberId: string,
  { isActive }: UpdateMemberInput,
) =>
  prisma.$transaction(async (tx) => {
    const member = await findMemberOrThrow(tx, context.id, memberId);
    if (member.userId === context.ownerId) {
      throw AppError.badRequest("The organization owner's access cannot be changed");
    }

    await tx.user.update({ where: { id: member.userId }, data: { isActive } });
    if (!isActive) {
      await tx.refreshToken.updateMany({
        where: { userId: member.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.MEMBER_UPDATED,
      entity: AuditEntity.MEMBER,
      entityId: member.id,
      metadata: { memberUserId: member.userId, isActive },
    });

    return toMemberView(await tx.organizationMember.findUniqueOrThrow({ where: { id: member.id }, select: memberSelect }));
  });

/**
 * Removes a member: their tasks in this organization become unassigned and
 * their role returns to TEAM_OWNER, so they can create their own organization.
 * The owner cannot remove themselves.
 */
const removeMember = async (context: OrganizationContext, actor: AuthUser, memberId: string) =>
  prisma.$transaction(async (tx) => {
    const member = await findMemberOrThrow(tx, context.id, memberId);
    if (member.userId === context.ownerId) {
      throw AppError.badRequest("The organization owner cannot be removed");
    }

    const { count: unassignedTasks } = await tx.task.updateMany({
      where: { organizationId: context.id, assignedToId: member.userId },
      data: { assignedToId: null },
    });
    await tx.organizationMember.delete({ where: { id: member.id } });
    await tx.user.update({ where: { id: member.userId }, data: { role: "TEAM_OWNER" } });

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.MEMBER_REMOVED,
      entity: AuditEntity.MEMBER,
      entityId: member.id,
      metadata: { memberUserId: member.userId, email: member.user.email, unassignedTasks },
    });
  });

export const organizationService = {
  createOrganization,
  getCurrentOrganization,
  updateCurrentOrganization,
  addMember,
  listMembers,
  updateMember,
  removeMember,
};
