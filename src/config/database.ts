import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "./env.js";

/**
 * Single Prisma client for the whole process. Prisma 7 talks to PostgreSQL
 * through the `pg` driver adapter (no native query engine), which keeps the
 * serverless bundle small. Connections are opened lazily on the first query,
 * and a warm serverless instance reuses this module-level client.
 */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  // Query errors are re-thrown to the error middleware, which logs real
  // failures, so only development echoes them here as well.
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["warn"],
});

/** Lightweight connectivity probe used by the health endpoint. */
export const checkDatabaseConnection = async (): Promise<boolean> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
