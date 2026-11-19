import { prisma } from "../../config/database.js";
import type { Prisma, SubscriptionPlan } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { FREE_PLAN_NAME } from "./subscription.constant.js";

type Db = Prisma.TransactionClient;

/**
 * Subscriptions that grant benefits *right now*: ACTIVE, already started and
 * not yet ended. An expired PRO subscription therefore never counts, even if
 * its status has not been flipped to EXPIRED yet.
 */
export const currentlyActiveSubscriptionWhere = (
  organizationId: string,
  now: Date = new Date(),
): Prisma.SubscriptionWhereInput => ({
  organizationId,
  status: "ACTIVE",
  AND: [
    { OR: [{ startDate: null }, { startDate: { lte: now } }] },
    { OR: [{ endDate: null }, { endDate: { gt: now } }] },
  ],
});

export const getFreePlan = async (db: Db = prisma): Promise<SubscriptionPlan> => {
  const plan = await db.subscriptionPlan.findUnique({ where: { name: FREE_PLAN_NAME } });
  if (!plan) {
    throw new AppError(503, "Subscription plans are not configured. Run the database seed.");
  }
  return plan;
};

/**
 * The plan whose limits apply to an organization: its best currently-active
 * subscription, falling back to FREE. Always computed from the database –
 * never from client data or a cache.
 */
export const getEffectivePlan = async (organizationId: string, db: Db = prisma) => {
  const subscription = await db.subscription.findFirst({
    where: currentlyActiveSubscriptionWhere(organizationId),
    orderBy: [{ plan: { price: "desc" } }, { endDate: { sort: "desc", nulls: "first" } }],
    include: { plan: true },
  });
  if (subscription) {
    return { plan: subscription.plan, subscription };
  }
  return { plan: await getFreePlan(db), subscription: null };
};

/**
 * Row-locks the organization for the rest of the transaction. Plan-limit
 * checks run after this lock, so two concurrent requests cannot both pass a
 * "count < limit" check and exceed the limit together.
 */
export const lockOrganization = async (db: Db, organizationId: string): Promise<void> => {
  await db.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
};

const planLimitError = (planName: string, resource: string, max: number) =>
  new AppError(403, `Your ${planName} plan allows at most ${max} ${resource}. Upgrade your plan to add more.`);

export const assertMemberLimit = async (db: Db, organizationId: string): Promise<void> => {
  const { plan } = await getEffectivePlan(organizationId, db);
  const members = await db.organizationMember.count({ where: { organizationId } });
  if (members >= plan.maxMembers) {
    throw planLimitError(plan.name, "members", plan.maxMembers);
  }
};

/** Counts ACTIVE, non-deleted projects (optionally ignoring the project being updated). */
export const assertActiveProjectLimit = async (
  db: Db,
  organizationId: string,
  excludeProjectId?: string,
): Promise<void> => {
  const { plan } = await getEffectivePlan(organizationId, db);
  if (plan.maxProjects === null) return;

  const activeProjects = await db.project.count({
    where: {
      organizationId,
      deletedAt: null,
      status: "ACTIVE",
      ...(excludeProjectId && { id: { not: excludeProjectId } }),
    },
  });
  if (activeProjects >= plan.maxProjects) {
    throw planLimitError(plan.name, "active projects", plan.maxProjects);
  }
};

export const assertTaskLimit = async (db: Db, organizationId: string, projectId: string): Promise<void> => {
  const { plan } = await getEffectivePlan(organizationId, db);
  if (plan.maxTasksPerProject === null) return;

  const tasks = await db.task.count({ where: { projectId, deletedAt: null } });
  if (tasks >= plan.maxTasksPerProject) {
    throw planLimitError(plan.name, "tasks per project", plan.maxTasksPerProject);
  }
};
