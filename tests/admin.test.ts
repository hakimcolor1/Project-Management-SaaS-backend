import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { prisma, resetDatabase } from "./helpers/db.js";
import {
  addMemberTo,
  bearerFor,
  createOrganizationWithOwner,
  createProject,
  createTask,
  createUser,
  seedPlans,
} from "./helpers/factories.js";

const ADMIN = "/api/v1/admin";
let plans: Awaited<ReturnType<typeof seedPlans>>;

const createPayment = (organizationId: string, status: "PENDING" | "SUCCESS" | "FAILED", amount = "1500.00") =>
  prisma.subscription
    .create({ data: { organizationId, planId: plans.pro.id, status: status === "SUCCESS" ? "ACTIVE" : "PENDING" } })
    .then((subscription) =>
      prisma.payment.create({
        data: {
          organizationId,
          subscriptionId: subscription.id,
          transactionId: `TF-${crypto.randomUUID().slice(0, 12)}`,
          amount,
          status,
          paidAt: status === "SUCCESS" ? new Date() : null,
        },
      }),
    );

beforeEach(async () => {
  await resetDatabase();
  plans = await seedPlans();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("admin access control", () => {
  const endpoints = ["/dashboard", "/organizations", "/users", "/payments", "/audit-logs"];

  it("rejects unauthenticated callers (401), owners and members (403)", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const { user: member } = await addMemberTo(organization.id);

    for (const endpoint of endpoints) {
      expect((await request(app).get(`${ADMIN}${endpoint}`)).status).toBe(401);
      expect((await request(app).get(`${ADMIN}${endpoint}`).set("Authorization", bearerFor(owner))).status).toBe(403);
      expect((await request(app).get(`${ADMIN}${endpoint}`).set("Authorization", bearerFor(member))).status).toBe(403);
    }
    const patch = await request(app)
      .patch(`${ADMIN}/organizations/${organization.id}/status`)
      .set("Authorization", bearerFor(owner))
      .send({ status: "SUSPENDED" });
    expect(patch.status).toBe(403);
  });
});

describe("GET /admin/dashboard", () => {
  it("returns statistics computed from the database", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN" });
    const { owner, organization } = await createOrganizationWithOwner();
    await addMemberTo(organization.id);
    await createOrganizationWithOwner({ status: "SUSPENDED" });
    const project = await createProject(organization.id);
    await createTask(project, owner.id, { status: "COMPLETED" });
    await createTask(project, owner.id);
    await createPayment(organization.id, "SUCCESS", "1500.00");
    await createPayment(organization.id, "SUCCESS", "500.50");
    await createPayment(organization.id, "FAILED");

    const res = await request(app).get(`${ADMIN}/dashboard`).set("Authorization", bearerFor(admin));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      users: { total: 4, active: 4, inactive: 0, byRole: { SUPER_ADMIN: 1, TEAM_OWNER: 2, TEAM_MEMBER: 1 } },
      organizations: { total: 2, ACTIVE: 1, SUSPENDED: 1 },
      projects: { total: 1 },
      tasks: { total: 2, completed: 1 },
      subscriptions: { activePaid: 2 },
      payments: { total: 3, byStatus: { SUCCESS: 2, FAILED: 1, PENDING: 0 }, totalRevenue: "2000.50" },
    });
  });
});

describe("GET /admin/organizations", () => {
  it("lists organizations with owner, stats, current plan, search and status filter", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN" });
    const { organization: acme } = await createOrganizationWithOwner({ name: "Acme Corp" });
    await addMemberTo(acme.id);
    await prisma.subscription.create({
      data: {
        organizationId: acme.id,
        planId: plans.pro.id,
        status: "ACTIVE",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86_400_000),
      },
    });
    await createOrganizationWithOwner({ name: "Beta Labs", status: "SUSPENDED" });
    const auth = bearerFor(admin);

    const all = await request(app).get(`${ADMIN}/organizations`).set("Authorization", auth);
    expect(all.body.meta.total).toBe(2);
    const acmeRow = (all.body.data as { name: string }[]).find((org) => org.name === "Acme Corp");
    expect(acmeRow).toMatchObject({ plan: "PRO", stats: { members: 2, projects: 0 }, owner: expect.objectContaining({ email: expect.any(String) }) as unknown });

    const search = await request(app).get(`${ADMIN}/organizations?search=beta`).set("Authorization", auth);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0]).toMatchObject({ name: "Beta Labs", plan: "FREE", status: "SUSPENDED" });

    const suspended = await request(app).get(`${ADMIN}/organizations?status=SUSPENDED&limit=1`).set("Authorization", auth);
    expect(suspended.body.meta).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 });
  });
});

describe("PATCH /admin/organizations/:id/status", () => {
  it("suspends (blocking tenant access) and reactivates an organization", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN" });
    const { owner, organization } = await createOrganizationWithOwner();
    const auth = bearerFor(admin);
    const url = `${ADMIN}/organizations/${organization.id}/status`;

    const suspend = await request(app).patch(url).set("Authorization", auth).send({ status: "SUSPENDED", reason: "Unpaid invoices" });
    expect(suspend.status).toBe(200);
    expect(suspend.body.message).toBe("Organization suspended successfully");
    expect((await request(app).get("/api/v1/projects").set("Authorization", bearerFor(owner))).status).toBe(403);

    expect((await request(app).patch(url).set("Authorization", auth).send({ status: "SUSPENDED" })).status).toBe(400);

    const reactivate = await request(app).patch(url).set("Authorization", auth).send({ status: "ACTIVE" });
    expect(reactivate.status).toBe(200);
    expect((await request(app).get("/api/v1/projects").set("Authorization", bearerFor(owner))).status).toBe(200);

    const logs = await prisma.auditLog.findMany({ where: { action: "ORGANIZATION_STATUS_CHANGED" }, orderBy: { createdAt: "asc" } });
    expect(logs.map((log) => log.metadata)).toEqual([
      { from: "ACTIVE", to: "SUSPENDED", reason: "Unpaid invoices" },
      { from: "SUSPENDED", to: "ACTIVE", reason: null },
    ]);
    expect(logs[0]?.userId).toBe(admin.id);
  });

  it("validates the id and status", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN" });
    const auth = bearerFor(admin);
    expect((await request(app).patch(`${ADMIN}/organizations/${crypto.randomUUID()}/status`).set("Authorization", auth).send({ status: "ACTIVE" })).status).toBe(404);
    expect((await request(app).patch(`${ADMIN}/organizations/bad-id/status`).set("Authorization", auth).send({ status: "ACTIVE" })).status).toBe(422);
    expect((await request(app).patch(`${ADMIN}/organizations/${crypto.randomUUID()}/status`).set("Authorization", auth).send({ status: "DELETED" })).status).toBe(422);
  });
});

describe("GET /admin/users, /admin/payments, /admin/audit-logs", () => {
  it("lists users with role and search filters and never exposes passwords", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN", name: "Root Admin" });
    const { organization } = await createOrganizationWithOwner();
    await addMemberTo(organization.id, { name: "Member Mia" });
    const auth = bearerFor(admin);

    const members = await request(app).get(`${ADMIN}/users?role=TEAM_MEMBER`).set("Authorization", auth);
    expect(members.body.data).toHaveLength(1);
    expect(members.body.data[0]).toMatchObject({ name: "Member Mia", organization: { id: organization.id } });
    expect(members.body.data[0]).not.toHaveProperty("password");

    const search = await request(app).get(`${ADMIN}/users?search=root`).set("Authorization", auth);
    expect(search.body.data[0].name).toBe("Root Admin");
    expect((await request(app).get(`${ADMIN}/users?isActive=maybe`).set("Authorization", auth)).status).toBe(422);
  });

  it("lists all payments with status and organization filters", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN" });
    const { organization: first } = await createOrganizationWithOwner();
    const { organization: second } = await createOrganizationWithOwner();
    await createPayment(first.id, "SUCCESS");
    await createPayment(second.id, "FAILED");
    const auth = bearerFor(admin);

    const all = await request(app).get(`${ADMIN}/payments`).set("Authorization", auth);
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data[0]).toMatchObject({ amount: "1500.00", plan: "PRO", organization: { id: expect.any(String) as unknown } });

    const success = await request(app).get(`${ADMIN}/payments?status=SUCCESS`).set("Authorization", auth);
    expect(success.body.data).toHaveLength(1);
    const byOrg = await request(app).get(`${ADMIN}/payments?organizationId=${second.id}`).set("Authorization", auth);
    expect(byOrg.body.data[0].status).toBe("FAILED");
  });

  it("lists audit logs with filters", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN" });
    const owner = await createUser();
    await request(app).post("/api/v1/organizations").set("Authorization", bearerFor(owner)).send({ name: "Audited Org" });
    const organization = await prisma.organization.findFirstOrThrow({ where: { name: "Audited Org" } });
    await request(app).post("/api/v1/projects").set("Authorization", bearerFor(owner)).send({ name: "Audited Project" });
    const auth = bearerFor(admin);

    const all = await request(app).get(`${ADMIN}/audit-logs`).set("Authorization", auth);
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data[0]).toMatchObject({ action: "PROJECT_CREATED", user: { id: owner.id }, organization: { id: organization.id } });

    const filtered = await request(app).get(`${ADMIN}/audit-logs?action=organization_created`).set("Authorization", auth);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].action).toBe("ORGANIZATION_CREATED");
  });
});

describe("PATCH /admin/plans/:planId", () => {
  it("updates a paid plan and the public plan list reflects it", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN" });
    const res = await request(app)
      .patch(`${ADMIN}/plans/${plans.pro.id}`)
      .set("Authorization", bearerFor(admin))
      .send({ price: "1999.00", maxMembers: 30 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "PRO", price: "1999.00", maxMembers: 30 });
    const publicPlans = await request(app).get("/api/v1/plans");
    expect((publicPlans.body.data as { name: string; price: string }[]).find((p) => p.name === "PRO")?.price).toBe("1999.00");
    expect(await prisma.auditLog.count({ where: { action: "PLAN_UPDATED" } })).toBe(1);
  });

  it("keeps the FREE plan free and active, and paid plans priced", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN" });
    const auth = bearerFor(admin);
    expect((await request(app).patch(`${ADMIN}/plans/${plans.free.id}`).set("Authorization", auth).send({ price: "10.00" })).status).toBe(400);
    expect((await request(app).patch(`${ADMIN}/plans/${plans.free.id}`).set("Authorization", auth).send({ isActive: false })).status).toBe(400);
    expect((await request(app).patch(`${ADMIN}/plans/${plans.pro.id}`).set("Authorization", auth).send({ price: "0" })).status).toBe(400);
    expect((await request(app).patch(`${ADMIN}/plans/${plans.pro.id}`).set("Authorization", auth).send({ price: "abc" })).status).toBe(422);
    expect((await request(app).patch(`${ADMIN}/plans/${plans.free.id}`).set("Authorization", auth).send({ maxMembers: 6 })).status).toBe(200);
  });
});
