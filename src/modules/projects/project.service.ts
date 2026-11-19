import { prisma } from "../../config/database.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { OrganizationContext } from "../../middlewares/organization.middleware.js";
import { AppError } from "../../utils/app-error.js";
import { AuditAction, AuditEntity, recordAuditLog } from "../../utils/audit-log.js";
import { buildPaginationMeta, getPaginationArgs } from "../../utils/pagination.js";
import type { AuthUser } from "../auth/auth.interface.js";
import { assertActiveProjectLimit, lockOrganization } from "../subscriptions/subscription.service.js";
import type { CreateProjectInput, ListProjectsQuery, TaskStats, UpdateProjectInput } from "./project.interface.js";

type Db = Prisma.TransactionClient;

const projectSelect = {
  id: true,
  organizationId: true,
  name: true,
  description: true,
  status: true,
  startDate: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

type ProjectRecord = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

const emptyStats = (): TaskStats => ({
  total: 0,
  completed: 0,
  byStatus: { TODO: 0, IN_PROGRESS: 0, REVIEW: 0, COMPLETED: 0 },
});

/** Progress = completed tasks / total tasks × 100 (0 when there are no tasks), 2 decimals. */
export const calculateProgress = ({ total, completed }: Pick<TaskStats, "total" | "completed">): number =>
  total === 0 ? 0 : Math.round((completed / total) * 10_000) / 100;

/** Task counts per project in ONE grouped query (no N+1), ignoring soft-deleted tasks. */
const getTaskStats = async (projectIds: string[], db: Db = prisma): Promise<Map<string, TaskStats>> => {
  const stats = new Map(projectIds.map((id) => [id, emptyStats()]));
  if (projectIds.length === 0) return stats;

  const groups = await db.task.groupBy({
    by: ["projectId", "status"],
    where: { projectId: { in: projectIds }, deletedAt: null },
    _count: { _all: true },
  });
  for (const group of groups) {
    const entry = stats.get(group.projectId);
    if (!entry) continue;
    entry.byStatus[group.status] = group._count._all;
    entry.total += group._count._all;
    if (group.status === "COMPLETED") entry.completed += group._count._all;
  }
  return stats;
};

const withProgress = (project: ProjectRecord, stats: TaskStats = emptyStats()) => ({
  ...project,
  taskStats: stats,
  progress: calculateProgress(stats),
});

/** A non-deleted project of the caller's organization – anything else is 404. */
export const findProjectOrThrow = async (organizationId: string, projectId: string, db: Db = prisma) => {
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId, deletedAt: null },
    select: projectSelect,
  });
  if (!project) {
    throw AppError.notFound("Project not found");
  }
  return project;
};

const createProject = (context: OrganizationContext, actor: AuthUser, input: CreateProjectInput) =>
  prisma.$transaction(async (tx) => {
    const status = input.status ?? "ACTIVE";
    if (status === "ACTIVE") {
      await lockOrganization(tx, context.id);
      await assertActiveProjectLimit(tx, context.id);
    }

    const project = await tx.project.create({
      data: {
        organizationId: context.id,
        name: input.name,
        description: input.description ?? null,
        status,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
      },
      select: projectSelect,
    });

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.PROJECT_CREATED,
      entity: AuditEntity.PROJECT,
      entityId: project.id,
      metadata: { name: project.name, status },
    });

    return withProgress(project);
  });

const listProjects = async (context: OrganizationContext, query: ListProjectsQuery) => {
  const where: Prisma.ProjectWhereInput = {
    organizationId: context.id,
    deletedAt: null,
    ...(query.status && { status: query.status }),
    ...(query.search && {
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
      ],
    }),
  };

  const [projects, total] = await prisma.$transaction([
    prisma.project.findMany({
      where,
      select: projectSelect,
      orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }],
      ...getPaginationArgs(query),
    }),
    prisma.project.count({ where }),
  ]);

  const stats = await getTaskStats(projects.map((project) => project.id));
  return {
    projects: projects.map((project) => withProgress(project, stats.get(project.id))),
    meta: buildPaginationMeta(query, total),
  };
};

const getProject = async (context: OrganizationContext, projectId: string) => {
  const project = await findProjectOrThrow(context.id, projectId);
  const stats = await getTaskStats([project.id]);
  return withProgress(project, stats.get(project.id));
};

const updateProject = (context: OrganizationContext, actor: AuthUser, projectId: string, input: UpdateProjectInput) =>
  prisma.$transaction(async (tx) => {
    const existing = await findProjectOrThrow(context.id, projectId, tx);

    // Re-activating a project counts against the plan's active-project limit.
    if (input.status === "ACTIVE" && existing.status !== "ACTIVE") {
      await lockOrganization(tx, context.id);
      await assertActiveProjectLimit(tx, context.id, existing.id);
    }

    const startDate = input.startDate !== undefined ? input.startDate : existing.startDate;
    const dueDate = input.dueDate !== undefined ? input.dueDate : existing.dueDate;
    if (startDate && dueDate && dueDate < startDate) {
      throw AppError.validation([
        { field: "dueDate", location: "body", message: "Due date must be on or after the start date" },
      ]);
    }

    const project = await tx.project.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.startDate !== undefined && { startDate: input.startDate }),
        ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
      },
      select: projectSelect,
    });

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.PROJECT_UPDATED,
      entity: AuditEntity.PROJECT,
      entityId: project.id,
      metadata: {
        fields: Object.keys(input),
        ...(input.status !== undefined && { statusFrom: existing.status, statusTo: input.status }),
      },
    });

    const stats = await getTaskStats([project.id], tx);
    return withProgress(project, stats.get(project.id));
  });

/** Soft delete: the project and its tasks get `deletedAt` and disappear from every query. */
const deleteProject = (context: OrganizationContext, actor: AuthUser, projectId: string) =>
  prisma.$transaction(async (tx) => {
    const project = await findProjectOrThrow(context.id, projectId, tx);
    const deletedAt = new Date();

    const { count: deletedTasks } = await tx.task.updateMany({
      where: { projectId: project.id, deletedAt: null },
      data: { deletedAt },
    });
    await tx.project.update({ where: { id: project.id }, data: { deletedAt } });

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.PROJECT_DELETED,
      entity: AuditEntity.PROJECT,
      entityId: project.id,
      metadata: { name: project.name, deletedTasks },
    });
  });

export const projectService = {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
};
