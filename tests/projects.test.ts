import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { calculateProgress } from "../src/modules/projects/project.service.js";
import { prisma, resetDatabase } from "./helpers/db.js";
import {
  addMemberTo,
  bearerFor,
  createOrganizationWithOwner,
  createProject,
  createTask,
  seedPlans,
} from "./helpers/factories.js";

const PROJECTS = "/api/v1/projects";
const nextYear = `${new Date().getUTCFullYear() + 1}`;

beforeEach(async () => {
  await resetDatabase();
  await seedPlans();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("progress calculation", () => {
  it("is completed / total × 100 and 0 without tasks", () => {
    expect(calculateProgress({ total: 0, completed: 0 })).toBe(0);
    expect(calculateProgress({ total: 4, completed: 1 })).toBe(25);
    expect(calculateProgress({ total: 3, completed: 1 })).toBe(33.33);
    expect(calculateProgress({ total: 2, completed: 2 })).toBe(100);
  });
});

describe("POST /projects", () => {
  it("lets the owner create a project", async () => {
    const { owner, organization } = await createOrganizationWithOwner();

    const res = await request(app)
      .post(PROJECTS)
      .set("Authorization", bearerFor(owner))
      .send({ name: "Website Redesign", startDate: `${nextYear}-01-01`, dueDate: `${nextYear}-03-31` });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "Website Redesign",
      organizationId: organization.id,
      status: "ACTIVE",
      progress: 0,
      taskStats: { total: 0, completed: 0 },
    });
    expect(res.body.data.dueDate).toBe(`${nextYear}-03-31T00:00:00.000Z`);
    expect(await prisma.auditLog.count({ where: { action: "PROJECT_CREATED" } })).toBe(1);
  });

  it("forbids members and unauthenticated users", async () => {
    const { organization } = await createOrganizationWithOwner();
    const { user: member } = await addMemberTo(organization.id);

    expect((await request(app).post(PROJECTS).set("Authorization", bearerFor(member)).send({ name: "Nope" })).status).toBe(403);
    expect((await request(app).post(PROJECTS).send({ name: "Nope" })).status).toBe(401);
  });

  it("validates names, dates and unknown fields", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const auth = bearerFor(owner);
    const post = (body: object) => request(app).post(PROJECTS).set("Authorization", auth).send(body);

    expect((await post({ name: "X" })).status).toBe(422);
    expect((await post({ name: "Dates", startDate: `${nextYear}-05-01`, dueDate: `${nextYear}-04-01` })).status).toBe(422);
    expect((await post({ name: "Past", dueDate: "2020-01-01" })).status).toBe(422);
    expect((await post({ name: "Format", dueDate: "01/02/2030" })).status).toBe(422);
    expect((await post({ name: "Tenant", organizationId: organization.id })).status).toBe(422);
    expect((await post({ name: "Status", status: "DONE" })).status).toBe(422);
  });

  it("enforces the FREE limit of 2 active projects", async () => {
    const { owner } = await createOrganizationWithOwner();
    const auth = bearerFor(owner);
    const post = (body: object) => request(app).post(PROJECTS).set("Authorization", auth).send(body);

    expect((await post({ name: "One" })).status).toBe(201);
    expect((await post({ name: "Two" })).status).toBe(201);
    const third = await post({ name: "Three" });
    expect(third.status).toBe(403);
    expect(third.body.message).toMatch(/at most 2 active projects/);

    // Non-active projects do not count…
    const onHold = await post({ name: "Paused", status: "ON_HOLD" });
    expect(onHold.status).toBe(201);
    // …until they are re-activated.
    const reactivate = await request(app)
      .patch(`${PROJECTS}/${onHold.body.data.id as string}`)
      .set("Authorization", auth)
      .send({ status: "ACTIVE" });
    expect(reactivate.status).toBe(403);
  });
});

describe("GET /projects", () => {
  it("lists only this organization's non-deleted projects with progress", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const { user: member } = await addMemberTo(organization.id);
    const alpha = await createProject(organization.id, { name: "Alpha" });
    await createProject(organization.id, { name: "Beta", status: "ON_HOLD" });
    await createProject(organization.id, { name: "Deleted", deletedAt: new Date() });
    const { organization: other } = await createOrganizationWithOwner();
    await createProject(other.id, { name: "Foreign" });

    await createTask(alpha, owner.id, { status: "COMPLETED" });
    await createTask(alpha, owner.id, { status: "TODO" });
    await createTask(alpha, owner.id, { status: "IN_PROGRESS" });
    await createTask(alpha, owner.id, { status: "COMPLETED", deletedAt: new Date() }); // ignored

    const res = await request(app).get(`${PROJECTS}?sortBy=name&sortOrder=asc`).set("Authorization", bearerFor(member));

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 10, total: 2, totalPages: 1 });
    expect((res.body.data as { name: string }[]).map((p) => p.name)).toEqual(["Alpha", "Beta"]);
    expect(res.body.data[0]).toMatchObject({
      progress: 33.33,
      taskStats: { total: 3, completed: 1, byStatus: { TODO: 1, IN_PROGRESS: 1, REVIEW: 0, COMPLETED: 1 } },
    });
    expect(res.body.data[1].progress).toBe(0);
  });

  it("supports search, status filter and pagination", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    await createProject(organization.id, { name: "Mobile App" });
    await createProject(organization.id, { name: "Marketing Site", status: "COMPLETED" });
    await createProject(organization.id, { name: "Data Pipeline", status: "ARCHIVED" });
    const auth = bearerFor(owner);

    const search = await request(app).get(`${PROJECTS}?search=mobile`).set("Authorization", auth);
    expect((search.body.data as { name: string }[]).map((p) => p.name)).toEqual(["Mobile App"]);

    const filtered = await request(app).get(`${PROJECTS}?status=COMPLETED`).set("Authorization", auth);
    expect((filtered.body.data as { name: string }[]).map((p) => p.name)).toEqual(["Marketing Site"]);

    const paged = await request(app).get(`${PROJECTS}?page=2&limit=2`).set("Authorization", auth);
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });

    expect((await request(app).get(`${PROJECTS}?status=UNKNOWN`).set("Authorization", auth)).status).toBe(422);
  });
});

describe("GET /projects/:projectId", () => {
  it("returns the project and rejects invalid, foreign and deleted ids", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const project = await createProject(organization.id);
    const deleted = await createProject(organization.id, { deletedAt: new Date() });
    const { organization: other } = await createOrganizationWithOwner();
    const foreign = await createProject(other.id);
    const auth = bearerFor(owner);

    const ok = await request(app).get(`${PROJECTS}/${project.id}`).set("Authorization", auth);
    expect(ok.status).toBe(200);
    expect(ok.body.data.id).toBe(project.id);

    expect((await request(app).get(`${PROJECTS}/not-a-uuid`).set("Authorization", auth)).status).toBe(422);
    expect((await request(app).get(`${PROJECTS}/${foreign.id}`).set("Authorization", auth)).status).toBe(404);
    expect((await request(app).get(`${PROJECTS}/${deleted.id}`).set("Authorization", auth)).status).toBe(404);
  });
});

describe("PATCH /projects/:projectId", () => {
  it("updates fields and records the change", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const project = await createProject(organization.id);

    const res = await request(app)
      .patch(`${PROJECTS}/${project.id}`)
      .set("Authorization", bearerFor(owner))
      .send({ name: "Renamed", status: "ON_HOLD", dueDate: `${nextYear}-12-31` });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "Renamed", status: "ON_HOLD" });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "PROJECT_UPDATED" } });
    expect(log.metadata).toMatchObject({ statusFrom: "ACTIVE", statusTo: "ON_HOLD" });
  });

  it("checks dates against stored values", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const project = await createProject(organization.id);
    const auth = bearerFor(owner);
    await request(app).patch(`${PROJECTS}/${project.id}`).set("Authorization", auth).send({ startDate: `${nextYear}-06-01` });

    const res = await request(app).patch(`${PROJECTS}/${project.id}`).set("Authorization", auth).send({ dueDate: `${nextYear}-05-01` });
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ field: "dueDate" });
  });

  it("forbids members and cross-organization updates", async () => {
    const { organization } = await createOrganizationWithOwner();
    const { user: member } = await addMemberTo(organization.id);
    const project = await createProject(organization.id);
    const { owner: otherOwner } = await createOrganizationWithOwner();

    expect((await request(app).patch(`${PROJECTS}/${project.id}`).set("Authorization", bearerFor(member)).send({ name: "Hack" })).status).toBe(403);
    expect((await request(app).patch(`${PROJECTS}/${project.id}`).set("Authorization", bearerFor(otherOwner)).send({ name: "Hack" })).status).toBe(404);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).name).toBe(project.name);
  });
});

describe("DELETE /projects/:projectId", () => {
  it("soft-deletes the project and its tasks", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const project = await createProject(organization.id);
    const task = await createTask(project, owner.id);
    const auth = bearerFor(owner);

    const res = await request(app).delete(`${PROJECTS}/${project.id}`).set("Authorization", auth);

    expect(res.status).toBe(200);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).deletedAt).not.toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).deletedAt).not.toBeNull();
    expect((await request(app).get(`${PROJECTS}/${project.id}`).set("Authorization", auth)).status).toBe(404);
    expect((await request(app).delete(`${PROJECTS}/${project.id}`).set("Authorization", auth)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: "PROJECT_DELETED" } })).toBe(1);
  });

  it("forbids members and cross-organization deletes", async () => {
    const { organization } = await createOrganizationWithOwner();
    const { user: member } = await addMemberTo(organization.id);
    const project = await createProject(organization.id);
    const { owner: otherOwner } = await createOrganizationWithOwner();

    expect((await request(app).delete(`${PROJECTS}/${project.id}`).set("Authorization", bearerFor(member))).status).toBe(403);
    expect((await request(app).delete(`${PROJECTS}/${project.id}`).set("Authorization", bearerFor(otherOwner))).status).toBe(404);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).deletedAt).toBeNull();
  });
});
