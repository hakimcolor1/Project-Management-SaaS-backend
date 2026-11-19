import type { RequestHandler } from "express";
import { AppError } from "../utils/app-error.js";

/** Catches any request that no route handled. Must be mounted after all routes. */
export const notFound: RequestHandler = (req, _res, next) => {
  const path = req.originalUrl.split("?")[0] ?? req.originalUrl;
  next(AppError.notFound(`Route not found: ${req.method} ${path}`));
};
