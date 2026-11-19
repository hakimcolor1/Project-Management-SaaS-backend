/**
 * Database seed – safe to run repeatedly.
 *
 *  1. Creates the SUPER_ADMIN account from DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD
 *     (bcrypt-hashed). Never duplicates it and never promotes an existing
 *     non-admin account.
 *  2. Creates the FREE and PRO subscription plans if they do not exist
 *     (existing plans are left untouched so later edits are not overwritten).
 *
 * Run with: bun run db:seed
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { UserRole } from "../src/generated/prisma/enums.js";
import { hashPassword, strongPasswordSchema } from "../src/utils/password.js";

try {
  process.loadEnvFile();
} catch {
  // No .env file – rely on the process environment.
}

const seedEnvSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "Must be a PostgreSQL connection string"),
  DEMO_ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  DEMO_ADMIN_PASSWORD: strongPasswordSchema,
});

const PLANS = [
  {
    name: "FREE",
    price: "0.00",
    currency: "BDT",
    durationDays: null, // never expires
    maxMembers: 5,
    maxProjects: 2,
    maxTasksPerProject: 50,
  },
  {
    name: "PRO",
    price: "1500.00",
    currency: "BDT",
    durationDays: 30,
    maxMembers: 25,
    maxProjects: null, // unlimited
    maxTasksPerProject: 1000,
  },
] as const;

const parsed = seedEnvSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
  console.error(`Seed aborted – invalid configuration:\n${details}`);
  process.exit(1);
}
const config = parsed.data;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.DATABASE_URL }),
});

const seedSuperAdmin = async (): Promise<void> => {
  const existing = await prisma.user.findUnique({
    where: { email: config.DEMO_ADMIN_EMAIL },
    select: { id: true, role: true },
  });

  if (existing) {
    if (existing.role !== UserRole.SUPER_ADMIN) {
      throw new Error(
        `A non-admin account already uses ${config.DEMO_ADMIN_EMAIL}; refusing to promote it. ` +
          "Choose a different DEMO_ADMIN_EMAIL.",
      );
    }
    console.log(`• SUPER_ADMIN ${config.DEMO_ADMIN_EMAIL} already exists – skipped`);
    return;
  }

  await prisma.user.create({
    data: {
      name: "TeamFlow Super Admin",
      email: config.DEMO_ADMIN_EMAIL,
      password: await hashPassword(config.DEMO_ADMIN_PASSWORD),
      role: UserRole.SUPER_ADMIN,
      emailVerified: true,
    },
  });
  console.log(`• SUPER_ADMIN ${config.DEMO_ADMIN_EMAIL} created`);
};

const seedPlans = async (): Promise<void> => {
  for (const plan of PLANS) {
    const existing = await prisma.subscriptionPlan.findUnique({
      where: { name: plan.name },
      select: { id: true },
    });
    if (existing) {
      console.log(`• Plan ${plan.name} already exists – skipped`);
      continue;
    }
    await prisma.subscriptionPlan.create({ data: plan });
    console.log(`• Plan ${plan.name} created`);
  }
};

const main = async (): Promise<void> => {
  console.log("Seeding TeamFlow database…");
  await seedSuperAdmin();
  await seedPlans();
  console.log("Seed completed.");
};

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
