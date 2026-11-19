import { prisma } from "../../src/config/database.js";
import { TEST_DATABASE_URL, assertIsTestDatabase } from "../setup/test-database.js";

/** Empties every application table (keeps the migrations table). */
export const resetDatabase = async (): Promise<void> => {
  assertIsTestDatabase(process.env.DATABASE_URL ?? TEST_DATABASE_URL);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;

  const tableList = tables.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
};

export { prisma };
