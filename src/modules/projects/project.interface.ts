import type { z } from "zod";
import type { TaskStatus } from "../../generated/prisma/enums.js";
import type { createProjectSchema, listProjectsQuerySchema, updateProjectSchema } from "./project.validation.js";

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export interface TaskStats {
  total: number;
  completed: number;
  byStatus: Record<TaskStatus, number>;
}
