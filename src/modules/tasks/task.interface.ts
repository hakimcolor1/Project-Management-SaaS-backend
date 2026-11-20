import type { z } from "zod";
import type {
  assignTaskSchema,
  createTaskSchema,
  listMyTasksQuerySchema,
  listTasksQuerySchema,
  updateTaskSchema,
  updateTaskStatusSchema,
} from "./task.validation.js";

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
export type AssignTaskInput = z.infer<typeof assignTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type ListMyTasksQuery = z.infer<typeof listMyTasksQuerySchema>;
