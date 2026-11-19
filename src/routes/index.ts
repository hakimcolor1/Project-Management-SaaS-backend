import { Router } from "express";
import { authRoutes } from "../modules/auth/auth.route.js";
import { healthRoutes } from "../modules/health/health.route.js";

/** All versioned API routes, mounted under /api/v1 in app.ts. */
export const apiRouter = Router();

const moduleRoutes: { path: string; router: Router }[] = [
  { path: "/health", router: healthRoutes },
  { path: "/auth", router: authRoutes },
  // Further modules (organizations, projects, …) are added phase by phase.
];

for (const { path, router } of moduleRoutes) {
  apiRouter.use(path, router);
}
