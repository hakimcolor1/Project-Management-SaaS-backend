import type { RequestHandler } from "express";
import { getAuthUser } from "../../middlewares/auth.middleware.js";
import { getOrganizationContext } from "../../middlewares/organization.middleware.js";
import { sendSuccess } from "../../utils/response.js";
import type { CreateProjectInput, ListProjectsQuery, UpdateProjectInput } from "./project.interface.js";
import { projectService } from "./project.service.js";

type ProjectParams = { projectId: string };

export const createProject: RequestHandler = async (req, res) => {
  const project = await projectService.createProject(
    getOrganizationContext(req),
    getAuthUser(req),
    req.body as CreateProjectInput,
  );
  sendSuccess(res, { statusCode: 201, message: "Project created successfully", data: project });
};

export const listProjects: RequestHandler = async (req, res) => {
  const { projects, meta } = await projectService.listProjects(
    getOrganizationContext(req),
    req.query as unknown as ListProjectsQuery,
  );
  sendSuccess(res, { message: "Projects retrieved successfully", data: projects, meta });
};

export const getProject: RequestHandler = async (req, res) => {
  const project = await projectService.getProject(getOrganizationContext(req), (req.params as ProjectParams).projectId);
  sendSuccess(res, { message: "Project retrieved successfully", data: project });
};

export const updateProject: RequestHandler = async (req, res) => {
  const project = await projectService.updateProject(
    getOrganizationContext(req),
    getAuthUser(req),
    (req.params as ProjectParams).projectId,
    req.body as UpdateProjectInput,
  );
  sendSuccess(res, { message: "Project updated successfully", data: project });
};

export const deleteProject: RequestHandler = async (req, res) => {
  await projectService.deleteProject(
    getOrganizationContext(req),
    getAuthUser(req),
    (req.params as ProjectParams).projectId,
  );
  sendSuccess(res, { message: "Project deleted successfully" });
};
