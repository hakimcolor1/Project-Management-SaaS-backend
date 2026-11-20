import { prisma } from "../../config/database.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { buildPaginationMeta, getPaginationArgs } from "../../utils/pagination.js";
import type { ListUsersQuery, PublicUser, UpdateProfileInput } from "./user.interface.js";

/** The only user fields ever returned by the API (no password / googleId). */
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  role: true,
  isActive: true,
  emailVerified: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

/** GET /users/me and GET /auth/me – the signed-in user plus their organization (if any). */
const getProfile = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...publicUserSelect,
      memberships: {
        take: 1,
        select: {
          joinedAt: true,
          organization: { select: { id: true, name: true, slug: true, status: true, ownerId: true } },
        },
      },
    },
  });
  if (!user) {
    throw AppError.notFound("User not found");
  }

  const { memberships, ...profile } = user;
  const membership = memberships[0];
  return {
    ...profile,
    organization: membership
      ? {
          id: membership.organization.id,
          name: membership.organization.name,
          slug: membership.organization.slug,
          status: membership.organization.status,
          isOwner: membership.organization.ownerId === user.id,
          joinedAt: membership.joinedAt,
        }
      : null,
  };
};

/** All users with their organization, for the SUPER_ADMIN user directory (GET /admin/users). */
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

/**
 * PATCH /users/me – a user updates their own name and/or avatar. The user
 * exists: `authenticate` re-loads it from the database on every request.
 */
const updateProfile = (userId: string, input: UpdateProfileInput): Promise<PublicUser> =>
  prisma.user.update({
    where: { id: userId },
    // Explicit field list: only validated profile fields can ever be written.
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.avatar !== undefined && { avatar: input.avatar }),
    },
    select: publicUserSelect,
  });

export const userService = {
  getProfile,
  listUsers,
  updateProfile,
};
