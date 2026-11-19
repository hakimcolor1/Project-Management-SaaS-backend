import { randomUUID } from "node:crypto";
import { prisma } from "../../src/config/database.js";
import type { UserRole } from "../../src/generated/prisma/enums.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { hashPassword } from "../../src/utils/password.js";

export const DEFAULT_PASSWORD = "SecurePassword123";

// bcrypt is deliberately slow; hash the shared test password only once.
let defaultPasswordHash: Promise<string> | undefined;
const getDefaultPasswordHash = () => (defaultPasswordHash ??= hashPassword(DEFAULT_PASSWORD));

interface CreateUserOptions {
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
