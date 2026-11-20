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

const API = "/api/v1";
const nextYear = new Date().getUTCFullYear() + 1;

/** Owner + member in one organization with one project. */
const setup = async () => {
  const { owner, organization } = await createOrganizationWithOwner();
  const { user: member } = await addMemberTo(organization.id);
  const project = await createProject(organization.id, { name: "Platform" });
  return { owner, member, organization, project, ownerAuth: bearerFor(owner), memberAuth: bearerFor(member) };
};

beforeEach(async () => {
  await resetDatabase();
  await seedPlans();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /projects/:projectId/tasks", () => {
  it("lets the owner create and assign a task", async () => {
    const { member, project, ownerAuth, owner } = await setup();

    const res = await request(app)
      .post(`${API}/projects/${project.id}/tasks`)
      .set("Authorization", ownerAuth)
      .send({ title: "Design login page", priority: "HIGH", dueDate: `${nextYear}-01-15`, assignedToId: member.id });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      title: "Design login page",
      status: "TODO",
      priority: "HIGH",
      project: { id: project.id },
      assignedTo: { id: member.id },
      createdBy: { id: owner.id },
    });
    expect(await prisma.auditLog.count({ where: { action: "TASK_CREATED" } })).toBe(1);
  });

  it("forbids members from creating tasks", async () => {
    const { project, memberAuth } = await setup();
    const res = await request(app).post(`${API}/projects/${project.id}/tasks`).set("Authorization", memberAuth).send({ title: "Nope" });
    expect(res.status).toBe(403);
  });

  it("rejects assignees outside the organization or deactivated", async () => {
    const { organization, project, ownerAuth } = await setup();
    const { owner: outsider } = await createOrganizationWithOwner();
    const { user: inactive } = await addMemberTo(organization.id, { isActive: false });
    const url = `${API}/projects/${project.id}/tasks`;

    const foreign = await request(app).post(url).set("Authorization", ownerAuth).send({ title: "Task A", assignedToId: outsider.id });
    expect(foreign.status).toBe(400);
    expect(foreign.body.errors[0]).toMatchObject({ field: "assignedToId" });

    const deactivated = await request(app).post(url).set("Authorization", ownerAuth).send({ title: "Task B", assignedToId: inactive.id });
    expect(deactivated.status).toBe(400);
    expect(await prisma.task.count()).toBe(0);
  });

  it("validates due dates against today and the project due date", async () => {
    const { organization, ownerAuth } = await setup();
    const project = await prisma.project.create({
      data: { organizationId: organization.id, name: "Dated", dueDate: new Date(`${nextYear}-06-30T00:00:00.000Z`) },
    });
    const url = `${API}/projects/${project.id}/tasks`;

    expect((await request(app).post(url).set("Authorization", ownerAuth).send({ title: "Past", dueDate: "2020-01-01" })).status).toBe(422);
    expect((await request(app).post(url).set("Authorization", ownerAuth).send({ title: "Late", dueDate: `${nextYear}-07-01` })).status).toBe(422);
    expect((await request(app).post(url).set("Authorization", ownerAuth).send({ title: "OK", dueDate: `${nextYear}-06-30` })).status).toBe(201);
  });

  it("rejects archived, deleted and foreign projects", async () => {
    const { organization, ownerAuth } = await setup();
    const archived = await createProject(organization.id, { status: "ARCHIVED" });
    const deleted = await createProject(organization.id, { deletedAt: new Date() });
    const { organization: other } = await createOrganizationWithOwner();
    const foreign = await createProject(other.id);
    const post = (id: string) => request(app).post(`${API}/projects/${id}/tasks`).set("Authorization", ownerAuth).send({ title: "Task" });

    expect((await post(archived.id)).status).toBe(400);
    expect((await post(deleted.id)).status).toBe(404);
    expect((await post(foreign.id)).status).toBe(404);
    expect((await post("not-a-uuid")).status).toBe(422);
  });

  it("enforces the FREE limit of 50 tasks per project", async () => {
    const { owner, organization, project, ownerAuth } = await setup();
    await prisma.task.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        projectId: project.id,
        organizationId: organization.id,
        createdById: owner.id,
        title: `Task ${i}`,
      })),
    });

    const res = await request(app).post(`${API}/projects/${project.id}/tasks`).set("Authorization", ownerAuth).send({ title: "Task 51" });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/at most 50 tasks per project/);
  });
});

describe("GET /projects/:projectId/tasks", () => {
  it("filters by status, priority and assignee, with pagination", async () => {
    const { owner, member, project, memberAuth } = await setup();
    await createTask(project, owner.id, { title: "Mine todo", assignedToId: member.id });
    await createTask(project, owner.id, { title: "Mine done", assignedToId: member.id, status: "COMPLETED" });
    await createTask(project, owner.id, { title: "Unassigned" });
    await createTask(project, owner.id, { title: "Deleted", deletedAt: new Date() });
    await prisma.task.updateMany({ where: { title: "Unassigned" }, data: { priority: "URGENT" } });
    const url = `${API}/projects/${project.id}/tasks`;
    const titles = (res: request.Response) => (res.body.data as { title: string }[]).map((t) => t.title).sort();

    const all = await request(app).get(url).set("Authorization", memberAuth);
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(3);

    expect(titles(await request(app).get(`${url}?assignedTo=me`).set("Authorization", memberAuth))).toEqual(["Mine done", "Mine todo"]);
    expect(titles(await request(app).get(`${url}?assignedTo=unassigned`).set("Authorization", memberAuth))).toEqual(["Unassigned"]);
    expect(titles(await request(app).get(`${url}?status=COMPLETED`).set("Authorization", memberAuth))).toEqual(["Mine done"]);
    expect(titles(await request(app).get(`${url}?priority=URGENT`).set("Authorization", memberAuth))).toEqual(["Unassigned"]);
    expect(titles(await request(app).get(`${url}?search=done`).set("Authorization", memberAuth))).toEqual(["Mine done"]);

    const sorted = await request(app).get(`${url}?sortBy=priority&sortOrder=desc&limit=1`).set("Authorization", memberAuth);
    expect(sorted.body.data[0].title).toBe("Unassigned");
    expect(sorted.body.meta).toEqual({ page: 1, limit: 1, total: 3, totalPages: 3 });

    expect((await request(app).get(`${url}?priority=CRITICAL`).set("Authorization", memberAuth)).status).toBe(422);
  });

  it("returns 404 for another organization's project", async () => {
    const { memberAuth } = await setup();
    const { organization: other } = await createOrganizationWithOwner();
    const foreign = await createProject(other.id);
    expect((await request(app).get(`${API}/projects/${foreign.id}/tasks`).set("Authorization", memberAuth)).status).toBe(404);
  });
});

describe("GET /tasks/:taskId", () => {
  it("returns a task of the organization and hides others", async () => {
    const { owner, project, memberAuth } = await setup();
    const task = await createTask(project, owner.id);
    const { owner: otherOwner, organization: other } = await createOrganizationWithOwner();
    const foreignTask = await createTask(await createProject(other.id), otherOwner.id);

    const res = await request(app).get(`${API}/tasks/${task.id}`).set("Authorization", memberAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: task.id, project: { id: project.id } });
    expect(res.body.data).not.toHaveProperty("assignedToId");

    expect((await request(app).get(`${API}/tasks/${foreignTask.id}`).set("Authorization", memberAuth)).status).toBe(404);
    expect((await request(app).get(`${API}/tasks/123`).set("Authorization", memberAuth)).status).toBe(422);
  });
});

describe("PATCH /tasks/:taskId", () => {
  it("lets the owner update any editable field", async () => {
    const { owner, project, ownerAuth } = await setup();
    const task = await createTask(project, owner.id);

    const res = await request(app)
      .patch(`${API}/tasks/${task.id}`)
      .set("Authorization", ownerAuth)
      .send({ title: "Renamed task", priority: "URGENT", dueDate: `${nextYear}-02-01` });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: "Renamed task", priority: "URGENT" });
    expect(await prisma.auditLog.count({ where: { action: "TASK_UPDATED" } })).toBe(1);
  });

  it("limits members to the description of their own tasks", async () => {
    const { owner, member, project, memberAuth } = await setup();
    const mine = await createTask(project, owner.id, { assignedToId: member.id });
    const notMine = await createTask(project, owner.id);
    const patch = (id: string, body: object) => request(app).patch(`${API}/tasks/${id}`).set("Authorization", memberAuth).send(body);

    const ok = await patch(mine.id, { description: "Added acceptance criteria" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.description).toBe("Added acceptance criteria");

    expect((await patch(mine.id, { title: "Hijacked" })).status).toBe(403);
    expect((await patch(notMine.id, { description: "Not my task" })).status).toBe(403);
    // Protected fields are not even accepted by the schema.
    expect((await patch(mine.id, { assignedToId: member.id })).status).toBe(422);
    expect((await patch(mine.id, { projectId: project.id })).status).toBe(422);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: mine.id } })).title).toBe(mine.title);
  });
});

describe("PATCH /tasks/:taskId/status", () => {
  it("moves a member's task through the workflow to COMPLETED and updates project progress", async () => {
    const { owner, member, project, memberAuth, ownerAuth } = await setup();
    const task = await createTask(project, owner.id, { assignedToId: member.id });
    await createTask(project, owner.id); // second task keeps progress at 50%
    const setStatus = (status: string) =>
      request(app).patch(`${API}/tasks/${task.id}/status`).set("Authorization", memberAuth).send({ status });

    expect((await setStatus("IN_PROGRESS")).status).toBe(200);
    expect((await setStatus("REVIEW")).status).toBe(200);
    const completed = await setStatus("COMPLETED");
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe("COMPLETED");

    const projectRes = await request(app).get(`${API}/projects/${project.id}`).set("Authorization", ownerAuth);
    expect(projectRes.body.data).toMatchObject({ progress: 50, taskStats: { total: 2, completed: 1 } });

    const logs = await prisma.auditLog.findMany({ where: { action: "TASK_STATUS_CHANGED" }, orderBy: { createdAt: "asc" } });
    expect(logs.map((log) => log.metadata)).toEqual([
      { from: "TODO", to: "IN_PROGRESS" },
      { from: "IN_PROGRESS", to: "REVIEW" },
      { from: "REVIEW", to: "COMPLETED" },
    ]);
  });

  it("rejects invalid member transitions, same status and other people's tasks", async () => {
    const { owner, member, project, memberAuth } = await setup();
    const task = await createTask(project, owner.id, { assignedToId: member.id });
    const other = await createTask(project, owner.id);

    const skip = await request(app).patch(`${API}/tasks/${task.id}/status`).set("Authorization", memberAuth).send({ status: "COMPLETED" });
    expect(skip.status).toBe(400);
    expect(skip.body.message).toMatch(/Cannot move a task from TODO to COMPLETED/);

    expect((await request(app).patch(`${API}/tasks/${task.id}/status`).set("Authorization", memberAuth).send({ status: "TODO" })).status).toBe(400);
    expect((await request(app).patch(`${API}/tasks/${other.id}/status`).set("Authorization", memberAuth).send({ status: "IN_PROGRESS" })).status).toBe(403);
    expect((await request(app).patch(`${API}/tasks/${task.id}/status`).set("Authorization", memberAuth).send({ status: "DONE" })).status).toBe(422);
  });

  it("lets the owner set any status", async () => {
    const { owner, project, ownerAuth } = await setup();
    const task = await createTask(project, owner.id);
    const res = await request(app).patch(`${API}/tasks/${task.id}/status`).set("Authorization", ownerAuth).send({ status: "COMPLETED" });
    expect(res.status).toBe(200);
  });
});

describe("PATCH /tasks/:taskId/assign", () => {
  it("assigns, reassigns and unassigns with audit entries", async () => {
    const { owner, member, organization, project, ownerAuth } = await setup();
    const { user: second } = await addMemberTo(organization.id);
    const task = await createTask(project, owner.id);
    const assign = (assignedToId: string | null) =>
      request(app).patch(`${API}/tasks/${task.id}/assign`).set("Authorization", ownerAuth).send({ assignedToId });

    expect((await assign(member.id)).body.data.assignedTo.id).toBe(member.id);
    expect((await assign(second.id)).body.data.assignedTo.id).toBe(second.id);
    const unassigned = await assign(null);
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.data.assignedTo).toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { action: "TASK_ASSIGNED" }, orderBy: { createdAt: "asc" } });
    expect(logs.map((log) => log.metadata)).toEqual([
      { from: null, to: member.id },
      { from: member.id, to: second.id },
      { from: second.id, to: null },
    ]);
  });

  it("rejects non-member assignees and member callers", async () => {
    const { owner, member, project, ownerAuth, memberAuth } = await setup();
    const task = await createTask(project, owner.id);
    const stranger = await createUser();

    expect((await request(app).patch(`${API}/tasks/${task.id}/assign`).set("Authorization", ownerAuth).send({ assignedToId: stranger.id })).status).toBe(400);
    expect((await request(app).patch(`${API}/tasks/${task.id}/assign`).set("Authorization", memberAuth).send({ assignedToId: member.id })).status).toBe(403);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId).toBeNull();
  });
});

describe("DELETE /tasks/:taskId", () => {
  it("soft-deletes the task and removes it from progress", async () => {
    const { owner, project, ownerAuth } = await setup();
    const task = await createTask(project, owner.id, { status: "COMPLETED" });
    await createTask(project, owner.id);

    const res = await request(app).delete(`${API}/tasks/${task.id}`).set("Authorization", ownerAuth);

    expect(res.status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).deletedAt).not.toBeNull();
    expect((await request(app).get(`${API}/tasks/${task.id}`).set("Authorization", ownerAuth)).status).toBe(404);
    const projectRes = await request(app).get(`${API}/projects/${project.id}`).set("Authorization", ownerAuth);
    expect(projectRes.body.data).toMatchObject({ progress: 0, taskStats: { total: 1, completed: 0 } });
    expect(await prisma.auditLog.count({ where: { action: "TASK_DELETED" } })).toBe(1);
  });

  it("forbids members and cross-organization deletes", async () => {
    const { owner, project, memberAuth } = await setup();
    const task = await createTask(project, owner.id);
    const { owner: otherOwner } = await createOrganizationWithOwner();

    expect((await request(app).delete(`${API}/tasks/${task.id}`).set("Authorization", memberAuth)).status).toBe(403);
    expect((await request(app).delete(`${API}/tasks/${task.id}`).set("Authorization", bearerFor(otherOwner))).status).toBe(404);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).deletedAt).toBeNull();
  });
});

describe("GET /tasks/my-assigned", () => {
  const url = `${API}/tasks/my-assigned`;
  const ids = (res: request.Response) => (res.body.data as { id: string }[]).map((task) => task.id).sort();

  it("lists the caller's live tasks across all projects of their organization", async () => {
    const { owner, member, organization, project, memberAuth } = await setup();
    const second = await createProject(organization.id, { name: "Mobile" });
    const deletedProject = await createProject(organization.id, { deletedAt: new Date() });

    const todo = await createTask(project, owner.id, { title: "Login page", assignedToId: member.id });
    const inProgress = await createTask(second, owner.id, { title: "Push alerts", status: "IN_PROGRESS", assignedToId: member.id });
    await createTask(project, owner.id, { assignedToId: owner.id });
    await createTask(project, owner.id, { assignedToId: null });
    await createTask(project, owner.id, { assignedToId: member.id, deletedAt: new Date() });
    await createTask(deletedProject, owner.id, { assignedToId: member.id });

    const res = await request(app).get(url).set("Authorization", memberAuth);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Assigned tasks retrieved successfully");
    expect(ids(res)).toEqual([todo.id, inProgress.id].sort());
    expect(res.body.meta).toEqual({ page: 1, limit: 10, total: 2, totalPages: 1 });
    expect(res.body.data).toContainEqual(
      expect.objectContaining({
        id: inProgress.id,
        status: "IN_PROGRESS",
        project: { id: second.id, name: "Mobile" },
        assignedTo: expect.objectContaining({ id: member.id }),
      }),
    );

    const get = (query: string) => request(app).get(`${url}?${query}`).set("Authorization", memberAuth);
    expect(ids(await get("status=IN_PROGRESS"))).toEqual([inProgress.id]);
    expect(ids(await get(`projectId=${project.id}`))).toEqual([todo.id]);
    expect(ids(await get("search=push"))).toEqual([inProgress.id]);
    const firstPage = await get("page=1&limit=1&sortBy=title&sortOrder=asc");
    expect(ids(firstPage)).toEqual([todo.id]);
    expect(firstPage.body.meta).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  it("never shows another organization's tasks and checks role, membership and query", async () => {
    const { owner, project, ownerAuth } = await setup();
    const ownTask = await createTask(project, owner.id, { assignedToId: owner.id });
    const other = await setup();
    await createTask(other.project, other.owner.id, { assignedToId: other.member.id });

    const ownerRes = await request(app).get(url).set("Authorization", ownerAuth);
    expect(ownerRes.status).toBe(200);
    expect(ids(ownerRes)).toEqual([ownTask.id]);

    expect((await request(app).get(url)).status).toBe(401);
    const admin = await createUser({ role: "SUPER_ADMIN" });
    expect((await request(app).get(url).set("Authorization", bearerFor(admin))).status).toBe(403);
    const loner = await createUser({ role: "TEAM_MEMBER" });
    expect((await request(app).get(url).set("Authorization", bearerFor(loner))).status).toBe(404);

    const invalid = await request(app).get(`${url}?status=DONE&projectId=nope&limit=500`).set("Authorization", ownerAuth);
    expect(invalid.status).toBe(422);
    expect((invalid.body.errors as { field: string }[]).map((error) => error.field).sort()).toEqual(["limit", "projectId", "status"]);
  });
});
