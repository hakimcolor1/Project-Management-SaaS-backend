import { randomUUID } from "node:crypto";
import { prisma } from "../../config/database.js";
import { verifyGoogleIdToken } from "../../config/google.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { UserRole } from "../../generated/prisma/enums.js";
import { AppError } from "../../utils/app-error.js";
import {
  REFRESH_TOKEN_TTL_MS,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwt.js";
import { comparePassword, hashPassword } from "../../utils/password.js";
import type { AuthTokens, GoogleLoginInput, LoginInput, RegisterInput } from "./auth.interface.js";

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

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export interface AuthResult {
  user: PublicUser;
  tokens: AuthTokens;
}

const INVALID_CREDENTIALS = "Invalid email or password";
const INVALID_REFRESH_TOKEN = "Invalid or expired refresh token";
const REVOKED_REFRESH_TOKEN = "Refresh token has been revoked. Please log in again";
const ACCOUNT_DEACTIVATED = "Your account has been deactivated";

// ── Token helpers ────────────────────────────────────────────────────

/**
 * Issues an access token and a refresh token. The refresh token's `jti` is the
 * RefreshToken row id and only its SHA-256 hash is stored.
 */
const issueTokens = async (
  user: Pick<PublicUser, "id" | "role">,
  db: Prisma.TransactionClient = prisma,
): Promise<AuthTokens> => {
  const tokenId = randomUUID();
  const refreshToken = signRefreshToken({ userId: user.id, tokenId });

  await db.refreshToken.create({
    data: {
      id: tokenId,
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return { accessToken: signAccessToken({ userId: user.id, role: user.role }), refreshToken };
};

const revokeAllRefreshTokens = (userId: string, db: Prisma.TransactionClient = prisma) =>
  db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });

// A real bcrypt hash compared against when the email is unknown, so response
// time does not reveal whether an account exists. Created lazily, once.
let dummyPasswordHash: Promise<string> | undefined;
const getDummyPasswordHash = () => (dummyPasswordHash ??= hashPassword(randomUUID()));

// ── Use cases ────────────────────────────────────────────────────────

/** Public registration always creates a TEAM_OWNER – the role is never taken from input. */
const register = async ({ name, email, password }: RegisterInput): Promise<PublicUser> => {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw AppError.conflict("An account with this email already exists", [
      { field: "email", location: "body", message: "Email is already registered" },
    ]);
  }

  // The unique index still protects against a concurrent duplicate (P2002 → 409).
  return prisma.user.create({
    data: { name, email, password: await hashPassword(password), role: UserRole.TEAM_OWNER },
    select: publicUserSelect,
  });
};

const login = async ({ email, password }: LoginInput): Promise<AuthResult> => {
  const account = await prisma.user.findUnique({
    where: { email },
    select: { ...publicUserSelect, password: true },
  });

  const passwordMatches = await comparePassword(password, account?.password ?? (await getDummyPasswordHash()));

  // Same message for unknown email, wrong password and Google-only accounts.
  if (!account?.password || !passwordMatches) {
    throw AppError.unauthorized(INVALID_CREDENTIALS);
  }
  if (!account.isActive) {
    throw AppError.forbidden(ACCOUNT_DEACTIVATED);
  }

  const { password: _password, ...user } = account;
  return { user, tokens: await issueTokens(user) };
};

/**
 * Google sign-in with safe account linking:
 *  - known Google account (by `sub`)   → sign in
 *  - new email                         → create a TEAM_OWNER (no password)
 *  - existing email, no Google link    → link it. Google proved ownership of
 *    the address; if our copy of the email was never verified, whoever set
 *    that password may not own the address, so the password is removed and
 *    all existing sessions are revoked (prevents account pre-hijacking).
 *  - SUPER_ADMIN accounts must use their password and cannot use Google.
 */
const loginWithGoogle = async ({ idToken }: GoogleLoginInput): Promise<AuthResult> => {
  const profile = await verifyGoogleIdToken(idToken);

  const assertCanSignIn = (account: { role: UserRole; isActive: boolean }) => {
    if (account.role === UserRole.SUPER_ADMIN) {
      throw AppError.forbidden("Google login is not available for administrator accounts");
    }
    if (!account.isActive) {
      throw AppError.forbidden(ACCOUNT_DEACTIVATED);
    }
  };

  const user = await prisma.$transaction(async (tx) => {
    const linked = await tx.user.findUnique({ where: { googleId: profile.googleId }, select: publicUserSelect });
    if (linked) {
      assertCanSignIn(linked);
      return linked;
    }

    const existing = await tx.user.findUnique({
      where: { email: profile.email },
      select: { id: true, role: true, isActive: true, googleId: true, emailVerified: true, avatar: true },
    });

    if (!existing) {
      return tx.user.create({
        data: {
          name: profile.name,
          email: profile.email,
          googleId: profile.googleId,
          avatar: profile.avatar,
          emailVerified: true,
          role: UserRole.TEAM_OWNER,
        },
        select: publicUserSelect,
      });
    }

    assertCanSignIn(existing);
    if (existing.googleId) {
      throw AppError.conflict("This email is already linked to a different Google account");
    }

    const emailWasUnverified = !existing.emailVerified;
    if (emailWasUnverified) {
      await revokeAllRefreshTokens(existing.id, tx);
    }

    return tx.user.update({
      where: { id: existing.id },
      data: {
        googleId: profile.googleId,
        emailVerified: true,
        avatar: existing.avatar ?? profile.avatar,
        ...(emailWasUnverified && { password: null }),
      },
      select: publicUserSelect,
    });
  });

  return { user, tokens: await issueTokens(user) };
};

/**
 * Refresh-token rotation: the presented token is revoked and a new pair is
 * issued. Presenting an already-revoked token signals possible theft, so every
 * session of that user is revoked.
 */
const refreshTokens = async (rawToken: string | undefined): Promise<AuthTokens> => {
  if (!rawToken) {
    throw AppError.unauthorized("Refresh token is required");
  }

  let payload: ReturnType<typeof verifyRefreshToken>;
  try {
    payload = verifyRefreshToken(rawToken);
  } catch {
    throw AppError.unauthorized(INVALID_REFRESH_TOKEN);
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { id: true, role: true, isActive: true } },
    },
  });

  if (!stored || stored.id !== payload.tokenId || stored.userId !== payload.userId) {
    throw AppError.unauthorized(INVALID_REFRESH_TOKEN);
  }
  if (stored.revokedAt) {
    await revokeAllRefreshTokens(stored.userId);
    throw AppError.unauthorized(REVOKED_REFRESH_TOKEN);
  }
  if (stored.expiresAt.getTime() <= Date.now()) {
    throw AppError.unauthorized(INVALID_REFRESH_TOKEN);
  }
  if (!stored.user.isActive) {
    throw AppError.forbidden(ACCOUNT_DEACTIVATED);
  }

  return prisma.$transaction(async (tx) => {
    // Conditional update = atomic rotation: two parallel requests with the
    // same token cannot both succeed.
    const { count } = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count !== 1) {
      throw AppError.unauthorized(REVOKED_REFRESH_TOKEN);
    }
    return issueTokens(stored.user, tx);
  });
};

/** Revokes the given refresh token. Idempotent – unknown or missing tokens are ignored. */
const logout = async (rawToken: string | undefined): Promise<void> => {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

/** Profile of the signed-in user plus their organization (if any). */
const getCurrentUser = async (userId: string) => {
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

export const authService = {
  register,
  login,
  loginWithGoogle,
  refreshTokens,
  logout,
  getCurrentUser,
};
