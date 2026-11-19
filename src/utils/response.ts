import type { Response } from "express";
import type { ErrorDetail } from "./app-error.js";
import type { PaginationMeta } from "./pagination.js";

export interface SuccessBody<T> {
  success: true;
  message: string;
  data: T | null;
  meta?: PaginationMeta;
}

export interface ErrorBody {
  success: false;
  message: string;
  errors: ErrorDetail[];
}

interface SendSuccessOptions<T> {
  statusCode?: number;
  message: string;
  data?: T;
  meta?: PaginationMeta;
}

/** Sends the standard success envelope: { success, message, data[, meta] }. */
export const sendSuccess = <T>(
  res: Response,
  { statusCode = 200, message, data, meta }: SendSuccessOptions<T>,
): void => {
  const body: SuccessBody<T> = { success: true, message, data: data ?? null };
  if (meta) body.meta = meta;
  res.status(statusCode).json(body);
};

/** Sends the standard error envelope: { success, message, errors }. */
export const sendError = (
  res: Response,
  statusCode: number,
  message: string,
  errors: ErrorDetail[] = [],
): void => {
  const body: ErrorBody = { success: false, message, errors };
  res.status(statusCode).json(body);
};
