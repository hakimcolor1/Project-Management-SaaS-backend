import { z } from "zod";
import { ProjectStatus } from "../../generated/prisma/enums.js";
import { paginationQuerySchema } from "../../utils/pagination.js";
import {
  NON_EMPTY_BODY_MESSAGE,
  dateOnlySchema,
  nonEmptyBody,
  searchQuerySchema,
  sortOrderSchema,
  startOfTodayUtc,
  uuidSchema,
} from "../../utils/validation.js";

const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(150, "Name must be at most 150 characters");
const descriptionSchema = z.string().trim().max(2000, "Description must be at most 2000 characters");
const statusSchema = z.enum(ProjectStatus, { error: "Status must be ACTIVE, COMPLETED, ON_HOLD or ARCHIVED" });

export const projectIdParamsSchema = z.object({
  projectId: uuidSchema("project ID"),
});

export const createProjectSchema = z
  .strictObject({
    name: nameSchema,
    description: descriptionSchema.optional(),
    status: statusSchema.optional(),
    startDate: dateOnlySchema.optional(),
    dueDate: dateOnlySchema.optional(),
  })
  .refine((body) => !body.dueDate || body.dueDate >= startOfTodayUtc(), {
    message: "Due date cannot be in the past",
    path: ["dueDate"],
  })
  .refine((body) => !body.startDate || !body.dueDate || body.dueDate >= body.startDate, {
    message: "Due date must be on or after the start date",
    path: ["dueDate"],
  });

/** Date order against the stored values is checked in the service. */
export const updateProjectSchema = z
  .strictObject({
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    status: statusSchema.optional(),
    startDate: dateOnlySchema.nullable().optional(),
    dueDate: dateOnlySchema.nullable().optional(),
  })
  .refine(nonEmptyBody, { message: NON_EMPTY_BODY_MESSAGE });

export const listProjectsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  status: statusSchema.optional(),
  sortBy: z.enum(["createdAt", "name", "dueDate"]).default("createdAt"),
  sortOrder: sortOrderSchema,
});
