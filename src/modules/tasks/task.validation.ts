import { z } from "zod";
import { TaskPriority, TaskStatus } from "../../generated/prisma/enums.js";
import { paginationQuerySchema } from "../../utils/pagination.js";
import {
  NON_EMPTY_BODY_MESSAGE,
  dateOnlySchema,
  nonEmptyBody,
  searchQuerySchema,
  sortOrderSchema,
  uuidSchema,
} from "../../utils/validation.js";

const titleSchema = z
  .string()
  .trim()
  .min(2, "Title must be at least 2 characters")
  .max(200, "Title must be at most 200 characters");
const descriptionSchema = z.string().trim().max(5000, "Description must be at most 5000 characters");
const statusSchema = z.enum(TaskStatus, { error: "Status must be TODO, IN_PROGRESS, REVIEW or COMPLETED" });
const prioritySchema = z.enum(TaskPriority, { error: "Priority must be LOW, MEDIUM, HIGH or URGENT" });

export const projectTasksParamsSchema = z.object({ projectId: uuidSchema("project ID") });
export const taskIdParamsSchema = z.object({ taskId: uuidSchema("task ID") });

export const createTaskSchema = z.strictObject({
  title: titleSchema,
  description: descriptionSchema.optional(),
  priority: prioritySchema.optional(),
  dueDate: dateOnlySchema.optional(),
  assignedToId: uuidSchema("assignee ID").optional(),
});

/** Owner: every field. Team member (assignee): `description` only – enforced in the service. */
export const updateTaskSchema = z
  .strictObject({
    title: titleSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    priority: prioritySchema.optional(),
    dueDate: dateOnlySchema.nullable().optional(),
  })
  .refine(nonEmptyBody, { message: NON_EMPTY_BODY_MESSAGE });

export const updateTaskStatusSchema = z.strictObject({ status: statusSchema });

/** `null` unassigns the task. */
export const assignTaskSchema = z.strictObject({
  assignedToId: uuidSchema("assignee ID").nullable(),
});

export const listTasksQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  /** A user id, `me` (tasks assigned to the caller) or `unassigned`. */
  assignedTo: z.union([z.literal("me"), z.literal("unassigned"), uuidSchema("assignee ID")]).optional(),
  sortBy: z.enum(["createdAt", "dueDate", "priority", "title"]).default("createdAt"),
  sortOrder: sortOrderSchema,
});
