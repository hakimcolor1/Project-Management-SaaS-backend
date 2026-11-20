import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  organizationMemberAccess,
  organizationOwnerAccess,
} from "../../middlewares/organization.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  assignTask,
  createTask,
  deleteTask,
  getTask,
  listMyTasks,
  listProjectTasks,
  updateTask,
  updateTaskStatus,
} from "./task.controller.js";
import {
  assignTaskSchema,
  createTaskSchema,
  listMyTasksQuerySchema,
  listTasksQuerySchema,
  projectTasksParamsSchema,
  taskIdParamsSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
} from "./task.validation.js";

/** Mounted at /projects/:projectId/tasks */
export const projectTaskRoutes = Router({ mergeParams: true });

projectTaskRoutes.use(authenticate);
projectTaskRoutes.post(
  "/",
  organizationOwnerAccess(),
  validate({ params: projectTasksParamsSchema, body: createTaskSchema }),
  createTask,
);
projectTaskRoutes.get(
  "/",
  organizationMemberAccess(),
  validate({ params: projectTasksParamsSchema, query: listTasksQuerySchema }),
  listProjectTasks,
);

/** Mounted at /tasks */
export const taskRoutes = Router();

taskRoutes.use(authenticate);
// Before /:taskId, which would otherwise reject "my-assigned" as an invalid task id.
taskRoutes.get("/my-assigned", organizationMemberAccess(), validate({ query: listMyTasksQuerySchema }), listMyTasks);
taskRoutes.get("/:taskId", organizationMemberAccess(), validate({ params: taskIdParamsSchema }), getTask);
// Owner: all fields. Assigned member: permitted fields only (checked in the service).
taskRoutes.patch(
  "/:taskId",
  organizationMemberAccess(),
  validate({ params: taskIdParamsSchema, body: updateTaskSchema }),
  updateTask,
);
taskRoutes.patch(
  "/:taskId/status",
  organizationMemberAccess(),
  validate({ params: taskIdParamsSchema, body: updateTaskStatusSchema }),
  updateTaskStatus,
);
taskRoutes.patch(
  "/:taskId/assign",
  organizationOwnerAccess(),
  validate({ params: taskIdParamsSchema, body: assignTaskSchema }),
  assignTask,
);
taskRoutes.delete("/:taskId", organizationOwnerAccess(), validate({ params: taskIdParamsSchema }), deleteTask);
