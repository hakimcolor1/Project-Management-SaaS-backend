import { randomUUID } from "node:crypto";
import { prisma } from "../../src/config/database.js";
import type { UserRole } from "../../src/generated/prisma/enums.js";
import { DEFAULT_PLANS } from "../../src/modules/subscriptions/subscription.constant.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { hashPassword } from "../../src/utils/password.js";

export const DEFAULT_PASSWORD = "SecurePassword123";

// bcrypt is deliberately slow; hash the shared test password only once.
let defaultPasswordHash: Promise<string> | undefined;
const getDefaultPasswordHash = () => (defaultPasswordHash ??= hashPassword(DEFAULT_PASSWORD));

export interface CreateUserOptions {
  name?: string;
  email?: string;
  /** Plain password; `null` creates a Google-only account. */
  password?: string | null;
  role?: UserRole;
  isActive?: boolean;
  emailVerified?: boolean;
  googleId?: string | null;
}

export const createUser = async (options: CreateUserOptions = {}) => {
  const suffix = randomUUID().slice(0, 8);
  const password = options.password === undefined ? DEFAULT_PASSWORD : options.password;

  return prisma.user.create({
    data: {
      name: options.name ?? `Test User ${suffix}`,
      email: options.email ?? `user-${suffix}@example.com`,
      password:
        password === null
          ? null
          : password === DEFAULT_PASSWORD
            ? await getDefaultPasswordHash()
            : await hashPassword(password),
      role: options.role ?? "TEAM_OWNER",
      isActive: options.isActive ?? true,
      emailVerified: options.emailVerified ?? false,
      googleId: options.googleId ?? null,
    },
  });
};

/** `Authorization` header value for a user, without going through /login. */
export const bearerFor = (user: { id: string; role: UserRole }): string =>
  `Bearer ${signAccessToken({ userId: user.id, role: user.role })}`;

/** Creates the default FREE and PRO plans (the seed does this in real environments). */
export const seedPlans = async () => {
  for (const plan of DEFAULT_PLANS) {
    await prisma.subscriptionPlan.create({ data: plan });
  }
  return {
    free: await prisma.subscriptionPlan.findUniqueOrThrow({ where: { name: "FREE" } }),
    pro: await prisma.subscriptionPlan.findUniqueOrThrow({ where: { name: "PRO" } }),
  };
};

/** An owner with an organization, the owner's membership and a FREE subscription. */
export const createOrganizationWithOwner = async (
  options: { name?: string; status?: "ACTIVE" | "SUSPENDED"; owner?: CreateUserOptions } = {},
) => {
  const owner = await createUser({ role: "TEAM_OWNER", ...options.owner });
  const freePlan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { name: "FREE" } });
  const suffix = randomUUID().slice(0, 8);

  const organization = await prisma.organization.create({
    data: {
      name: options.name ?? `Org ${suffix}`,
      slug: `org-${suffix}`,
      ownerId: owner.id,
      status: options.status ?? "ACTIVE",
      members: { create: { userId: owner.id } },
      subscriptions: { create: { planId: freePlan.id, status: "ACTIVE", startDate: new Date() } },
    },
  });
  return { owner, organization };
};

/** Creates a TEAM_MEMBER user and adds them to the organization. */
export const addMemberTo = async (organizationId: string, options: CreateUserOptions = {}) => {
  const user = await createUser({ role: "TEAM_MEMBER", ...options });
  const membership = await prisma.organizationMember.create({ data: { organizationId, userId: user.id } });
  return { user, membership };
};

export const createProject = (
  organizationId: string,
  data: Partial<{ name: string; status: "ACTIVE" | "COMPLETED" | "ON_HOLD" | "ARCHIVED"; deletedAt: Date | null }> = {},
) =>
  prisma.project.create({
    data: { organizationId, name: data.name ?? `Project ${randomUUID().slice(0, 6)}`, ...data },
  });

export const createTask = (
  project: { id: string; organizationId: string },
  createdById: string,
  data: Partial<{
    title: string;
    status: "TODO" | "IN_PROGRESS" | "REVIEW" | "COMPLETED";
    assignedToId: string | null;
    deletedAt: Date | null;
  }> = {},
) =>
  prisma.task.create({
    data: {
      projectId: project.id,
      organizationId: project.organizationId,
      createdById,
      title: data.title ?? `Task ${randomUUID().slice(0, 6)}`,
      ...data,
    },
  });
