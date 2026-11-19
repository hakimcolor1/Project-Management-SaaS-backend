import { Router } from "express";
import { healthRoutes } from "../modules/health/health.route.js";

/** All versioned API routes, mounted under /api/v1 in app.ts. */
export const apiRouter = Router();

const moduleRoutes: { path: string; router: Router }[] = [
  { path: "/health", router: healthRoutes },
  // Feature modules (auth, organizations, projects, …) are added phase by phase.
];

for (const { path, router } of moduleRoutes) {
  apiRouter.use(path, router);
}
