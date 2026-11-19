import { prisma } from "../../config/database.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { AuditAction, AuditEntity, recordAuditLog } from "../../utils/audit-log.js";
import { CacheKeys, CacheTtlSeconds, getOrSetCache, invalidateCache } from "../../utils/cache.js";
import { buildPaginationMeta, getPaginationArgs } from "../../utils/pagination.js";
import type { AuthUser } from "../auth/auth.interface.js";
import { publicUserSelect } from "../auth/auth.service.js";
import { FREE_PLAN_NAME } from "../subscriptions/subscription.constant.js";
import { toPlanView } from "../subscriptions/subscription.service.js";
import type {
  ListAuditLogsQuery,
  ListOrganizationsQuery,
  ListPaymentsQuery,
  ListUsersQuery,
  UpdateOrganizationStatusInput,
  UpdatePlanInput,
} from "./admin.interface.js";

const THIRTY_DAYS_MS = 30 * 86_400_000;

const countBy = <K extends string>(keys: readonly K[], groups: { key: K; count: number }[]): Record<K, number> => {
  const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const { key, count } of groups) result[key] = count;
  return result;
};

// ── Dashboard ────────────────────────────────────────────────────────

/** Platform statistics computed with database aggregations (cached for 60 s). */
const getDashboard = () =>
  getOrSetCache(CacheKeys.adminDashboard, CacheTtlSeconds.adminDashboard, async () => {
    const now = new Date();
    const since = new Date(now.getTime() - THIRTY_DAYS_MS);

    const [
      usersByRole,
      activeUsers,
      newUsers,
      organizationsByStatus,
      newOrganizations,
      projects,
      tasks,
      completedTasks,
      activePaidSubscriptions,
      paymentsByStatus,
      revenue,
      recentRevenue,
    ] = await Promise.all([
      prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.organization.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
      prisma.organization.count({ where: { deletedAt: null, createdAt: { gte: since } } }),
      prisma.project.count({ where: { deletedAt: null } }),
      prisma.task.count({ where: { deletedAt: null } }),
      prisma.task.count({ where: { deletedAt: null, status: "COMPLETED" } }),
      prisma.subscription.count({
        where: {
          status: "ACTIVE",
          plan: { price: { gt: 0 } },
          AND: [
            { OR: [{ startDate: null }, { startDate: { lte: now } }] },
            { OR: [{ endDate: null }, { endDate: { gt: now } }] },
          ],
        },
      }),
      prisma.payment.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.payment.aggregate({ where: { status: "SUCCESS" }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: { status: "SUCCESS", paidAt: { gte: since } }, _sum: { amount: true } }),
    ]);

    const roles = countBy(
      ["SUPER_ADMIN", "TEAM_OWNER", "TEAM_MEMBER"] as const,
      usersByRole.map((group) => ({ key: group.role, count: group._count._all })),
    );
    const orgStatuses = countBy(
      ["ACTIVE", "SUSPENDED"] as const,
      organizationsByStatus.map((group) => ({ key: group.status, count: group._count._all })),
    );
    const paymentStatuses = countBy(
      ["PENDING", "SUCCESS", "FAILED", "CANCELLED"] as const,
      paymentsByStatus.map((group) => ({ key: group.status, count: group._count._all })),
    );
    const totalUsers = roles.SUPER_ADMIN + roles.TEAM_OWNER + roles.TEAM_MEMBER;

    return {
      users: { total: totalUsers, active: activeUsers, inactive: totalUsers - activeUsers, newLast30Days: newUsers, byRole: roles },
      organizations: {
        total: orgStatuses.ACTIVE + orgStatuses.SUSPENDED,
        ...orgStatuses,
        newLast30Days: newOrganizations,
      },
      projects: { total: projects },
      tasks: { total: tasks, completed: completedTasks },
      subscriptions: { activePaid: activePaidSubscriptions },
      payments: {
        total: Object.values(paymentStatuses).reduce((sum, count) => sum + count, 0),
        byStatus: paymentStatuses,
        totalRevenue: (revenue._sum.amount?.toFixed(2)) ?? "0.00",
        revenueLast30Days: (recentRevenue._sum.amount?.toFixed(2)) ?? "0.00",
        currency: "BDT",
      },
      generatedAt: now.toISOString(),
    };
  });

// ── Organizations ────────────────────────────────────────────────────

const listOrganizations = async (query: ListOrganizationsQuery) => {
  const where: Prisma.OrganizationWhereInput = {
    deletedAt: null,
    ...(query.status && { status: query.status }),
    ...(query.search && {
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { slug: { contains: query.search, mode: "insensitive" } },
      ],
    }),
  };

  const [organizations, total] = await prisma.$transaction([
    prisma.organization.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { members: true, projects: { where: { deletedAt: null } } } },
      },
      ...getPaginationArgs(query),
    }),
    prisma.organization.count({ where }),
  ]);

  // Current plan for the whole page in ONE query (no per-organization lookups).
  const now = new Date();
  const activeSubscriptions = await prisma.subscription.findMany({
    where: {
      organizationId: { in: organizations.map((organization) => organization.id) },
      status: "ACTIVE",
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gt: now } }] },
      ],
    },
    select: { organizationId: true, endDate: true, plan: { select: { name: true, price: true } } },
  });
  const bestPlan = new Map<string, (typeof activeSubscriptions)[number]>();
  for (const subscription of activeSubscriptions) {
    const current = bestPlan.get(subscription.organizationId);
    if (!current || subscription.plan.price.gt(current.plan.price)) bestPlan.set(subscription.organizationId, subscription);
  }

  return {
    organizations: organizations.map(({ _count, ...organization }) => {
      const subscription = bestPlan.get(organization.id);
      return {
        ...organization,
        stats: { members: _count.members, projects: _count.projects },
        plan: subscription?.plan.name ?? FREE_PLAN_NAME,
        planExpiresAt: subscription?.endDate ?? null,
      };
    }),
    meta: buildPaginationMeta(query, total),
  };
};

/** Suspend or reactivate an organization (suspended organizations lose access to their data). */
const updateOrganizationStatus = (actor: AuthUser, organizationId: string, input: UpdateOrganizationStatusInput) =>
  prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!organization) {
      throw AppError.notFound("Organization not found");
    }
    if (organization.status === input.status) {
      throw AppError.badRequest(`Organization is already ${input.status}`);
    }

    const updated = await tx.organization.update({
      where: { id: organization.id },
      data: { status: input.status },
      select: { id: true, name: true, slug: true, status: true, updatedAt: true },
    });

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: organization.id,
      action: AuditAction.ORGANIZATION_STATUS_CHANGED,
      entity: AuditEntity.ORGANIZATION,
      entityId: organization.id,
      metadata: { from: organization.status, to: input.status, reason: input.reason ?? null },
    });
    await invalidateCache(CacheKeys.adminDashboard);
    return updated;
  });

// ── Users, payments, audit logs ──────────────────────────────────────

const listUsers = async (query: ListUsersQuery) => {
  const where: Prisma.UserWhereInput = {
    ...(query.role && { role: query.role }),
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.search && {
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
      ],
    }),
  };
  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        ...publicUserSelect,
        memberships: { take: 1, select: { organization: { select: { id: true, name: true } } } },
      },
      ...getPaginationArgs(query),
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users: users.map(({ memberships, ...user }) => ({ ...user, organization: memberships[0]?.organization ?? null })),
    meta: buildPaginationMeta(query, total),
  };
};

const listPayments = async (query: ListPaymentsQuery) => {
  const where: Prisma.PaymentWhereInput = {
    ...(query.status && { status: query.status }),
    ...(query.organizationId && { organizationId: query.organizationId }),
  };
  const [payments, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        transactionId: true,
        amount: true,
        currency: true,
        paymentGateway: true,
        status: true,
        paidAt: true,
        createdAt: true,
        gatewayResponse: true,
        organization: { select: { id: true, name: true } },
        subscription: { select: { id: true, status: true, plan: { select: { name: true } } } },
      },
      ...getPaginationArgs(query),
    }),
    prisma.payment.count({ where }),
  ]);

  return {
    payments: payments.map(({ amount, subscription: { plan, ...subscription }, ...payment }) => ({
      ...payment,
      amount: amount.toFixed(2),
      plan: plan.name,
      subscription,
    })),
    meta: buildPaginationMeta(query, total),
  };
};

const listAuditLogs = async (query: ListAuditLogsQuery) => {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.action && { action: query.action }),
    ...(query.entity && { entity: query.entity }),
    ...(query.organizationId && { organizationId: query.organizationId }),
    ...(query.userId && { userId: query.userId }),
  };
  const [logs, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        metadata: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
        organization: { select: { id: true, name: true } },
      },
      ...getPaginationArgs(query),
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { logs, meta: buildPaginationMeta(query, total) };
};

// ── Plans ────────────────────────────────────────────────────────────

/** Edit a plan's price/limits. The FREE plan must stay free and active (it is the fallback plan). */
const updatePlan = (actor: AuthUser, planId: string, input: UpdatePlanInput) =>
  prisma.$transaction(async (tx) => {
    const plan = await tx.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw AppError.notFound("Plan not found");
    }
    if (plan.name === FREE_PLAN_NAME && ((input.price !== undefined && Number(input.price) !== 0) || input.isActive === false)) {
      throw AppError.badRequest("The FREE plan must stay free and active");
    }
    if (plan.name !== FREE_PLAN_NAME && input.price !== undefined && Number(input.price) <= 0) {
      throw AppError.badRequest("Paid plans must have a price greater than 0");
    }

    const updated = await tx.subscriptionPlan.update({ where: { id: plan.id }, data: input });
    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: null,
      action: AuditAction.PLAN_UPDATED,
      entity: AuditEntity.PLAN,
      entityId: plan.id,
      metadata: { plan: plan.name, changes: { ...input } },
    });
    // Cached plan list is now stale.
    await invalidateCache(CacheKeys.activePlans);
    return { ...toPlanView(updated), isActive: updated.isActive };
  });

export const adminService = {
  getDashboard,
  listOrganizations,
  updateOrganizationStatus,
  listUsers,
  listPayments,
  listAuditLogs,
  updatePlan,
};
