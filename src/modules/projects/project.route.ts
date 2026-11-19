import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  organizationMemberAccess,
  organizationOwnerAccess,
} from "../../middlewares/organization.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { createProject, deleteProject, getProject, listProjects, updateProject } from "./project.controller.js";
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  updateProjectSchema,
} from "./project.validation.js";

export const projectRoutes = Router();

projectRoutes.use(authenticate);

projectRoutes.post("/", organizationOwnerAccess(), validate({ body: createProjectSchema }), createProject);
projectRoutes.get("/", organizationMemberAccess(), validate({ query: listProjectsQuerySchema }), listProjects);
projectRoutes.get("/:projectId", organizationMemberAccess(), validate({ params: projectIdParamsSchema }), getProject);
projectRoutes.patch(
  "/:projectId",
  organizationOwnerAccess(),
  validate({ params: projectIdParamsSchema, body: updateProjectSchema }),
  updateProject,
);
projectRoutes.delete(
  "/:projectId",
  organizationOwnerAccess(),
  validate({ params: projectIdParamsSchema }),
  deleteProject,
);
