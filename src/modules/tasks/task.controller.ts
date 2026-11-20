import type { RequestHandler } from "express";
import { getAuthUser } from "../../middlewares/auth.middleware.js";
import { getOrganizationContext } from "../../middlewares/organization.middleware.js";
import { sendSuccess } from "../../utils/response.js";
import type {
  AssignTaskInput,
  CreateTaskInput,
  ListMyTasksQuery,
  ListTasksQuery,
  UpdateTaskInput,
  UpdateTaskStatusInput,
} from "./task.interface.js";
import { taskService } from "./task.service.js";

type ProjectParams = { projectId: string };
type TaskParams = { taskId: string };

export const createTask: RequestHandler = async (req, res) => {
  const task = await taskService.createTask(
    getOrganizationContext(req),
    getAuthUser(req),
    (req.params as ProjectParams).projectId,
    req.body as CreateTaskInput,
  );
  sendSuccess(res, { statusCode: 201, message: "Task created successfully", data: task });
};

export const listProjectTasks: RequestHandler = async (req, res) => {
  const { tasks, meta } = await taskService.listProjectTasks(
    getOrganizationContext(req),
    getAuthUser(req),
    (req.params as ProjectParams).projectId,
    req.query as unknown as ListTasksQuery,
  );
  sendSuccess(res, { message: "Tasks retrieved successfully", data: tasks, meta });
};

export const listMyTasks: RequestHandler = async (req, res) => {
  const { tasks, meta } = await taskService.listMyTasks(
    getOrganizationContext(req),
    getAuthUser(req),
    req.query as unknown as ListMyTasksQuery,
  );
  sendSuccess(res, { message: "Assigned tasks retrieved successfully", data: tasks, meta });
};

export const getTask: RequestHandler = async (req, res) => {
  const task = await taskService.getTask(getOrganizationContext(req), (req.params as TaskParams).taskId);
  sendSuccess(res, { message: "Task retrieved successfully", data: task });
};

export const updateTask: RequestHandler = async (req, res) => {
  const task = await taskService.updateTask(
    getOrganizationContext(req),
    getAuthUser(req),
    (req.params as TaskParams).taskId,
    req.body as UpdateTaskInput,
  );
  sendSuccess(res, { message: "Task updated successfully", data: task });
};

export const updateTaskStatus: RequestHandler = async (req, res) => {
  const task = await taskService.updateTaskStatus(
    getOrganizationContext(req),
    getAuthUser(req),
    (req.params as TaskParams).taskId,
    req.body as UpdateTaskStatusInput,
  );
  sendSuccess(res, { message: "Task status updated successfully", data: task });
};

export const assignTask: RequestHandler = async (req, res) => {
  const task = await taskService.assignTask(
    getOrganizationContext(req),
    getAuthUser(req),
    (req.params as TaskParams).taskId,
    req.body as AssignTaskInput,
  );
  sendSuccess(res, {
    message: task.assignedTo ? "Task assigned successfully" : "Task unassigned successfully",
    data: task,
  });
};

export const deleteTask: RequestHandler = async (req, res) => {
  await taskService.deleteTask(getOrganizationContext(req), getAuthUser(req), (req.params as TaskParams).taskId);
  sendSuccess(res, { message: "Task deleted successfully" });
};
