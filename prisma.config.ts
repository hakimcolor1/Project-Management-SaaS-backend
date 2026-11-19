import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads `.env`; load it here for local CLI usage.
// Real environment variables (CI, Vercel) always take precedence.
try {
  process.loadEnvFile();
} catch {
  // No .env file – rely on the process environment.
}

export default defineConfig({
  // Multi-file schema: every *.prisma file under prisma/ (schema.prisma,
  // enums.prisma, models/*.prisma) is merged into one schema.
  schema: "prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Used by the Prisma CLI (migrate / studio / seed). `prisma generate`
    // does not connect, so an empty value is tolerated during installs.
    url: process.env.DATABASE_URL ?? "",
  },
});
