import type { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import type { publicUserSelect } from "./user.service.js";
import type { listUsersQuerySchema, updateProfileSchema } from "./user.validation.js";

/** A user as the API returns it: never the password hash or the Google ID. */
export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
