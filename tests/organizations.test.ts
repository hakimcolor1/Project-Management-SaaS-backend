import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { prisma, resetDatabase } from "./helpers/db.js";
import {
  DEFAULT_PASSWORD,
  addMemberTo,
  bearerFor,
  createOrganizationWithOwner,
  createProject,
  createTask,
  createUser,
  seedPlans,
} from "./helpers/factories.js";

const ORGS = "/api/v1/organizations";
const MEMBERS = `${ORGS}/current/members`;

beforeEach(async () => {
  await resetDatabase();
  await seedPlans();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /organizations", () => {
  it("creates the organization, owner membership, FREE subscription and audit log", async () => {
    const owner = await createUser({ role: "TEAM_OWNER" });

    const res = await request(app)
      .post(ORGS)
      .set("Authorization", bearerFor(owner))
      .send({ name: "Acme Software", description: "We build things" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: "Acme Software", ownerId: owner.id, status: "ACTIVE" });
    expect(res.body.data.slug).toMatch(/^acme-software-[a-f0-9]{6}$/);

    const orgId = res.body.data.id as string;
    expect(await prisma.organizationMember.count({ where: { organizationId: orgId, userId: owner.id } })).toBe(1);
    const subscription = await prisma.subscription.findFirstOrThrow({ where: { organizationId: orgId }, include: { plan: true } });
    expect(subscription).toMatchObject({ status: "ACTIVE", endDate: null, plan: { name: "FREE" } });
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "ORGANIZATION_CREATED" } })).toBe(1);
  });

  it("allows only one organization per owner", async () => {
    const { owner } = await createOrganizationWithOwner();
    const res = await request(app).post(ORGS).set("Authorization", bearerFor(owner)).send({ name: "Second Org" });
    expect(res.status).toBe(409);
  });

  it("rejects TEAM_MEMBER, SUPER_ADMIN and unauthenticated callers", async () => {
    const member = await createUser({ role: "TEAM_MEMBER" });
    const admin = await createUser({ role: "SUPER_ADMIN" });

    expect((await request(app).post(ORGS).set("Authorization", bearerFor(member)).send({ name: "X Org" })).status).toBe(403);
    expect((await request(app).post(ORGS).set("Authorization", bearerFor(admin)).send({ name: "X Org" })).status).toBe(403);
    expect((await request(app).post(ORGS).send({ name: "X Org" })).status).toBe(401);
  });

  it("validates the body", async () => {
    const owner = await createUser();
    const res = await request(app)
      .post(ORGS)
      .set("Authorization", bearerFor(owner))
      .send({ name: "A", ownerId: owner.id });
    expect(res.status).toBe(422);
  });
});

describe("GET /organizations/current", () => {
  it("returns the organization with plan and stats for owner and members", async () => {
    const { owner, organization } = await createOrganizationWithOwner({ name: "Acme" });
    const { user: member } = await addMemberTo(organization.id);

    const ownerRes = await request(app).get(`${ORGS}/current`).set("Authorization", bearerFor(owner));
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.data).toMatchObject({
      id: organization.id,
      isOwner: true,
      stats: { members: 2, projects: 0 },
      plan: { name: "FREE", maxMembers: 5, maxProjects: 2, maxTasksPerProject: 50 },
    });

    const memberRes = await request(app).get(`${ORGS}/current`).set("Authorization", bearerFor(member));
    expect(memberRes.status).toBe(200);
    expect(memberRes.body.data.isOwner).toBe(false);
  });

  it("returns 404 for a user without an organization", async () => {
    const user = await createUser();
    const res = await request(app).get(`${ORGS}/current`).set("Authorization", bearerFor(user));
    expect(res.status).toBe(404);
  });

  it("lets a suspended organization see its status but blocks changes", async () => {
    const { owner } = await createOrganizationWithOwner({ status: "SUSPENDED" });

    const view = await request(app).get(`${ORGS}/current`).set("Authorization", bearerFor(owner));
    expect(view.status).toBe(200);
    expect(view.body.data.status).toBe("SUSPENDED");

    const update = await request(app).patch(`${ORGS}/current`).set("Authorization", bearerFor(owner)).send({ name: "New" });
    expect(update.status).toBe(403);
  });
});

describe("PATCH /organizations/current", () => {
  it("lets the owner update the profile", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const res = await request(app)
      .patch(`${ORGS}/current`)
      .set("Authorization", bearerFor(owner))
      .send({ name: "Renamed Org", description: null });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "Renamed Org", description: null, slug: organization.slug });
    expect(await prisma.auditLog.count({ where: { action: "ORGANIZATION_UPDATED" } })).toBe(1);
  });

  it("forbids members and rejects empty or mass-assignment bodies", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const { user: member } = await addMemberTo(organization.id);

    expect((await request(app).patch(`${ORGS}/current`).set("Authorization", bearerFor(member)).send({ name: "Hack" })).status).toBe(403);
    expect((await request(app).patch(`${ORGS}/current`).set("Authorization", bearerFor(owner)).send({})).status).toBe(422);
    expect((await request(app).patch(`${ORGS}/current`).set("Authorization", bearerFor(owner)).send({ status: "ACTIVE" })).status).toBe(422);
  });
});

describe("POST /organizations/current/members", () => {
  it("adds an existing account as TEAM_MEMBER", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const invitee = await createUser({ email: "dev@example.com" });

    const res = await request(app).post(MEMBERS).set("Authorization", bearerFor(owner)).send({ email: "DEV@example.com" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ isOwner: false, user: { id: invitee.id, role: "TEAM_MEMBER" } });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } });
    expect(stored.role).toBe("TEAM_MEMBER");
    expect(await prisma.organizationMember.count({ where: { organizationId: organization.id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "MEMBER_ADDED" } })).toBe(1);
  });

  it("rejects unknown emails (404) and duplicate or foreign memberships (409)", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const { user: existing } = await addMemberTo(organization.id);
    const { owner: otherOwner, organization: otherOrg } = await createOrganizationWithOwner();
    const { user: otherMember } = await addMemberTo(otherOrg.id);
    const auth = bearerFor(owner);

    expect((await request(app).post(MEMBERS).set("Authorization", auth).send({ email: "ghost@example.com" })).status).toBe(404);
    expect((await request(app).post(MEMBERS).set("Authorization", auth).send({ email: existing.email })).status).toBe(409);
    expect((await request(app).post(MEMBERS).set("Authorization", auth).send({ email: otherMember.email })).status).toBe(409);
    expect((await request(app).post(MEMBERS).set("Authorization", auth).send({ email: otherOwner.email })).status).toBe(409);
  });

  it("refuses administrator accounts", async () => {
    const { owner } = await createOrganizationWithOwner();
    const admin = await createUser({ role: "SUPER_ADMIN" });
    const res = await request(app).post(MEMBERS).set("Authorization", bearerFor(owner)).send({ email: admin.email });
    expect(res.status).toBe(400);
  });

  it("enforces the FREE plan member limit (5 including the owner)", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    for (let i = 0; i < 4; i += 1) await addMemberTo(organization.id);
    const sixth = await createUser();

    const res = await request(app).post(MEMBERS).set("Authorization", bearerFor(owner)).send({ email: sixth.email });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/FREE plan allows at most 5 members/);
    expect(await prisma.organizationMember.count({ where: { organizationId: organization.id } })).toBe(5);
  });

  it("cannot exceed the limit with concurrent requests (row lock)", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    for (let i = 0; i < 3; i += 1) await addMemberTo(organization.id); // 4 of 5 used
    const candidates = await Promise.all([createUser(), createUser(), createUser()]);
    const auth = bearerFor(owner);

    const results = await Promise.all(
      candidates.map((user) => request(app).post(MEMBERS).set("Authorization", auth).send({ email: user.email })),
    );

    expect(results.map((r) => r.status).sort()).toEqual([201, 403, 403]);
    expect(await prisma.organizationMember.count({ where: { organizationId: organization.id } })).toBe(5);
  });

  it("uses PRO limits while a PRO subscription is active, and FREE limits after it expires", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    for (let i = 0; i < 4; i += 1) await addMemberTo(organization.id);
    const pro = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { name: "PRO" } });
    const proSub = await prisma.subscription.create({
      data: {
        organizationId: organization.id,
        planId: pro.id,
        status: "ACTIVE",
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 86_400_000),
      },
    });
    const auth = bearerFor(owner);

    expect((await request(app).post(MEMBERS).set("Authorization", auth).send({ email: (await createUser()).email })).status).toBe(201);

    // Expired PRO (status still ACTIVE, end date in the past) gives no PRO benefits.
    await prisma.subscription.update({ where: { id: proSub.id }, data: { endDate: new Date(Date.now() - 1000) } });
    expect((await request(app).post(MEMBERS).set("Authorization", auth).send({ email: (await createUser()).email })).status).toBe(403);
  });

  it("forbids members from adding members", async () => {
    const { organization } = await createOrganizationWithOwner();
    const { user: member } = await addMemberTo(organization.id);
    const outsider = await createUser();
    const res = await request(app).post(MEMBERS).set("Authorization", bearerFor(member)).send({ email: outsider.email });
    expect(res.status).toBe(403);
  });
});

describe("GET /organizations/current/members", () => {
  it("lists members with pagination and search", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const { user: member } = await addMemberTo(organization.id, { name: "Rahim Uddin" });
    await addMemberTo(organization.id, { name: "Karim Ali" });

    const page = await request(app).get(`${MEMBERS}?page=1&limit=2`).set("Authorization", bearerFor(member));
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(page.body.data[0]).toMatchObject({ isOwner: true, user: { id: owner.id } });
    expect(page.body.data[0].user).not.toHaveProperty("password");

    const search = await request(app).get(`${MEMBERS}?search=rahim`).set("Authorization", bearerFor(owner));
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].user.name).toBe("Rahim Uddin");
  });

  it("validates pagination query parameters", async () => {
    const { owner } = await createOrganizationWithOwner();
    const res = await request(app).get(`${MEMBERS}?limit=1000`).set("Authorization", bearerFor(owner));
    expect(res.status).toBe(422);
  });
});

describe("PATCH /organizations/current/members/:memberId", () => {
  it("deactivates a member, ends their sessions and blocks login", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const { user, membership } = await addMemberTo(organization.id);
    const login = await request(app).post("/api/v1/auth/login").send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(login.status).toBe(200);

    const res = await request(app)
      .patch(`${MEMBERS}/${membership.id}`)
      .set("Authorization", bearerFor(owner))
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.user.isActive).toBe(false);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect((await request(app).post("/api/v1/auth/login").send({ email: user.email, password: DEFAULT_PASSWORD })).status).toBe(403);
  });

  it("cannot change the owner and cannot reach other organizations' members", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const ownerMembership = await prisma.organizationMember.findFirstOrThrow({ where: { userId: owner.id } });
    const { organization: otherOrg } = await createOrganizationWithOwner();
    const { membership: foreign } = await addMemberTo(otherOrg.id);
    const auth = bearerFor(owner);

    expect((await request(app).patch(`${MEMBERS}/${ownerMembership.id}`).set("Authorization", auth).send({ isActive: false })).status).toBe(400);
    expect((await request(app).patch(`${MEMBERS}/${foreign.id}`).set("Authorization", auth).send({ isActive: false })).status).toBe(404);
    expect((await request(app).patch(`${MEMBERS}/not-a-uuid`).set("Authorization", auth).send({ isActive: false })).status).toBe(422);
    expect(organization.id).not.toBe(otherOrg.id);
  });
});

describe("DELETE /organizations/current/members/:memberId", () => {
  it("removes the member, unassigns their tasks and resets their role", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const { user, membership } = await addMemberTo(organization.id);
    const project = await createProject(organization.id);
    const task = await createTask(project, owner.id, { assignedToId: user.id });

    const res = await request(app).delete(`${MEMBERS}/${membership.id}`).set("Authorization", bearerFor(owner));

    expect(res.status).toBe(200);
    expect(await prisma.organizationMember.count({ where: { id: membership.id } })).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("TEAM_OWNER");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "MEMBER_REMOVED" } });
    expect(log.metadata).toMatchObject({ memberUserId: user.id, unassignedTasks: 1 });

    // The removed user no longer has access to the organization.
    const after = await request(app).get(`${ORGS}/current`).set("Authorization", bearerFor(user));
    expect(after.status).toBe(404);
  });

  it("does not let the owner remove themselves", async () => {
    const { owner } = await createOrganizationWithOwner();
    const ownerMembership = await prisma.organizationMember.findFirstOrThrow({ where: { userId: owner.id } });
    const res = await request(app).delete(`${MEMBERS}/${ownerMembership.id}`).set("Authorization", bearerFor(owner));
    expect(res.status).toBe(400);
  });

  it("rejects members and cross-organization removals", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const { user: member, membership } = await addMemberTo(organization.id);
    const { owner: otherOwner } = await createOrganizationWithOwner();

    expect((await request(app).delete(`${MEMBERS}/${membership.id}`).set("Authorization", bearerFor(member))).status).toBe(403);
    expect((await request(app).delete(`${MEMBERS}/${membership.id}`).set("Authorization", bearerFor(otherOwner))).status).toBe(404);
    expect(await prisma.organizationMember.count({ where: { id: membership.id } })).toBe(1);
    expect(owner.id).toBeDefined();
  });
});
