import { prisma } from "../../config/database.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { TaskStatus } from "../../generated/prisma/enums.js";
import type { OrganizationContext } from "../../middlewares/organization.middleware.js";
import { AppError } from "../../utils/app-error.js";
import { AuditAction, AuditEntity, recordAuditLog } from "../../utils/audit-log.js";
import { buildPaginationMeta, getPaginationArgs } from "../../utils/pagination.js";
import { startOfTodayUtc } from "../../utils/validation.js";
import type { AuthUser } from "../auth/auth.interface.js";
import { findProjectOrThrow } from "../projects/project.service.js";
import { assertTaskLimit, lockOrganization } from "../subscriptions/subscription.service.js";
import type {
  AssignTaskInput,
  CreateTaskInput,
  ListTasksQuery,
  UpdateTaskInput,
  UpdateTaskStatusInput,
} from "./task.interface.js";

type Db = Prisma.TransactionClient;

const taskSelect = {
  id: true,
  projectId: true,
  organizationId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true, email: true, avatar: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

/**
 * Status workflow for team members. Owners may move a task to any status.
 *   TODO → IN_PROGRESS → REVIEW → COMPLETED, with steps back for rework and
 *   COMPLETED → IN_PROGRESS to reopen.
 */
export const MEMBER_STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: ["IN_PROGRESS"],
  IN_PROGRESS: ["TODO", "REVIEW"],
  REVIEW: ["IN_PROGRESS", "COMPLETED"],
  COMPLETED: ["IN_PROGRESS"],
};

/** Fields a team member may change on a task assigned to them. */
const MEMBER_EDITABLE_FIELDS: readonly string[] = ["description"];

/** A live task (task and project not deleted) of the caller's organization – otherwise 404. */
const findTaskOrThrow = async (organizationId: string, taskId: string, db: Db = prisma) => {
  const task = await db.task.findFirst({
    where: { id: taskId, organizationId, deletedAt: null, project: { deletedAt: null } },
    select: { ...taskSelect, assignedToId: true, project: { select: { id: true, name: true, dueDate: true } } },
  });
  if (!task) {
    throw AppError.notFound("Task not found");
  }
  return task;
};

/** Only active members of the same organization can be assignees. */
const assertAssignableMember = async (db: Db, organizationId: string, userId: string) => {
  const membership = await db.organizationMember.findFirst({
    where: { organizationId, userId },
    select: { user: { select: { isActive: true } } },
  });
  if (!membership) {
    throw AppError.badRequest("Invalid assignee", [
      { field: "assignedToId", location: "body", message: "Assignee must be a member of your organization" },
    ]);
  }
  if (!membership.user.isActive) {
    throw AppError.badRequest("Invalid assignee", [
      { field: "assignedToId", location: "body", message: "Assignee account is deactivated" },
    ]);
  }
};

/** Due dates may not be in the past or after the project's due date. */
const assertValidDueDate = (dueDate: Date | null | undefined, projectDueDate: Date | null) => {
  if (!dueDate) return;
  const message =
    dueDate < startOfTodayUtc()
      ? "Due date cannot be in the past"
      : projectDueDate && dueDate > projectDueDate
        ? "Due date cannot be after the project's due date"
        : null;
  if (message) {
    throw AppError.validation([{ field: "dueDate", location: "body", message }]);
  }
};

const assertCanModify = (context: OrganizationContext, actor: AuthUser, task: { assignedToId: string | null }) => {
  if (!context.isOwner && task.assignedToId !== actor.id) {
    throw AppError.forbidden("You can only update tasks assigned to you");
  }
};

const stripInternal = <T extends { assignedToId: string | null; project: { id: string; name: string } }>(task: T) => {
  const { assignedToId: _assignedToId, project, ...rest } = task;
  return { ...rest, project: { id: project.id, name: project.name } };
};

const createTask = (context: OrganizationContext, actor: AuthUser, projectId: string, input: CreateTaskInput) =>
  prisma.$transaction(async (tx) => {
    await lockOrganization(tx, context.id);
    const project = await findProjectOrThrow(context.id, projectId, tx);
    if (project.status === "ARCHIVED") {
      throw AppError.badRequest("Tasks cannot be added to an archived project");
    }

    assertValidDueDate(input.dueDate, project.dueDate);
    if (input.assignedToId) {
      await assertAssignableMember(tx, context.id, input.assignedToId);
    }
    await assertTaskLimit(tx, context.id, project.id);

    const task = await tx.task.create({
      data: {
        projectId: project.id,
        organizationId: context.id,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? "MEDIUM",
        dueDate: input.dueDate ?? null,
        assignedToId: input.assignedToId ?? null,
        createdById: actor.id,
      },
      select: taskSelect,
    });

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.TASK_CREATED,
      entity: AuditEntity.TASK,
      entityId: task.id,
      metadata: { projectId: project.id, title: task.title, assignedToId: input.assignedToId ?? null },
    });

    return task;
  });

const listProjectTasks = async (
  context: OrganizationContext,
  actor: AuthUser,
  projectId: string,
  query: ListTasksQuery,
) => {
  const project = await findProjectOrThrow(context.id, projectId);

  const assignee =
    query.assignedTo === "me" ? actor.id : query.assignedTo === "unassigned" ? null : query.assignedTo;

  const where: Prisma.TaskWhereInput = {
    projectId: project.id,
    organizationId: context.id,
    deletedAt: null,
    ...(query.status && { status: query.status }),
    ...(query.priority && { priority: query.priority }),
    ...(assignee !== undefined && { assignedToId: assignee }),
    ...(query.search && { title: { contains: query.search, mode: "insensitive" } }),
  };

  const [tasks, total] = await prisma.$transaction([
    prisma.task.findMany({
      where,
      select: taskSelect,
      orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }],
      ...getPaginationArgs(query),
    }),
    prisma.task.count({ where }),
  ]);

  return { tasks, meta: buildPaginationMeta(query, total) };
};

const getTask = async (context: OrganizationContext, taskId: string) =>
  stripInternal(await findTaskOrThrow(context.id, taskId));

/** Owners edit every field; assignees may edit the description only. Assignee and project are never editable here. */
const updateTask = (context: OrganizationContext, actor: AuthUser, taskId: string, input: UpdateTaskInput) =>
  prisma.$transaction(async (tx) => {
    const task = await findTaskOrThrow(context.id, taskId, tx);
    assertCanModify(context, actor, task);

    if (!context.isOwner) {
      const forbidden = Object.keys(input).filter((field) => !MEMBER_EDITABLE_FIELDS.includes(field));
      if (forbidden.length > 0) {
        throw AppError.forbidden(
          `Team members can only update: ${MEMBER_EDITABLE_FIELDS.join(", ")} (not allowed: ${forbidden.join(", ")})`,
        );
      }
    }
    if (input.dueDate !== undefined) {
      assertValidDueDate(input.dueDate, task.project.dueDate);
    }

    const updated = await tx.task.update({
      where: { id: task.id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
      },
      select: taskSelect,
    });

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.TASK_UPDATED,
      entity: AuditEntity.TASK,
      entityId: task.id,
      metadata: { fields: Object.keys(input) },
    });

    return updated;
  });

const updateTaskStatus = (
  context: OrganizationContext,
  actor: AuthUser,
  taskId: string,
  { status }: UpdateTaskStatusInput,
) =>
  prisma.$transaction(async (tx) => {
    const task = await findTaskOrThrow(context.id, taskId, tx);
    assertCanModify(context, actor, task);

    if (task.status === status) {
      throw AppError.badRequest(`Task is already ${status}`);
    }
    if (!context.isOwner && !MEMBER_STATUS_TRANSITIONS[task.status].includes(status)) {
      throw AppError.badRequest(
        `Cannot move a task from ${task.status} to ${status}. Allowed: ${MEMBER_STATUS_TRANSITIONS[task.status].join(", ")}`,
      );
    }

    const updated = await tx.task.update({ where: { id: task.id }, data: { status }, select: taskSelect });

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.TASK_STATUS_CHANGED,
      entity: AuditEntity.TASK,
      entityId: task.id,
      metadata: { from: task.status, to: status },
    });

    return updated;
  });

const assignTask = (context: OrganizationContext, actor: AuthUser, taskId: string, { assignedToId }: AssignTaskInput) =>
  prisma.$transaction(async (tx) => {
    const task = await findTaskOrThrow(context.id, taskId, tx);
    if (assignedToId) {
      await assertAssignableMember(tx, context.id, assignedToId);
    }

    const updated = await tx.task.update({ where: { id: task.id }, data: { assignedToId }, select: taskSelect });

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.TASK_ASSIGNED,
      entity: AuditEntity.TASK,
      entityId: task.id,
      metadata: { from: task.assignedToId, to: assignedToId },
    });

    return updated;
  });

const deleteTask = (context: OrganizationContext, actor: AuthUser, taskId: string) =>
  prisma.$transaction(async (tx) => {
    const task = await findTaskOrThrow(context.id, taskId, tx);
    await tx.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });

    await recordAuditLog(tx, {
      userId: actor.id,
      organizationId: context.id,
      action: AuditAction.TASK_DELETED,
      entity: AuditEntity.TASK,
      entityId: task.id,
      metadata: { projectId: task.projectId, title: task.title },
    });
  });

export const taskService = {
  createTask,
  listProjectTasks,
  getTask,
  updateTask,
  updateTaskStatus,
  assignTask,
  deleteTask,
};
