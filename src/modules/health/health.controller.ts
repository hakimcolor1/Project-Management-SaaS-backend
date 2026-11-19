import type { RequestHandler } from "express";
import { checkDatabaseConnection } from "../../config/database.js";
import { env } from "../../config/env.js";
import { sendError, sendSuccess } from "../../utils/response.js";

/** GET /api/v1/health – reports API and database status (503 when the DB is unreachable). */
export const getHealth: RequestHandler = async (_req, res) => {
  const databaseConnected = await checkDatabaseConnection();

  if (!databaseConnected) {
    sendError(res, 503, "Service unavailable", [{ message: "Database connection failed" }]);
    return;
  }

  sendSuccess(res, {
    message: "TeamFlow API is healthy",
    data: {
      status: "ok",
      database: "connected",
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
};
