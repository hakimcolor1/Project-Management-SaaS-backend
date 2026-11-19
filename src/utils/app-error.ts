export interface ErrorDetail {
  /** Field path, e.g. "email" or "items.0.name". */
  field?: string;
  /** Where the field came from: body, query or params. */
  location?: "body" | "query" | "params";
  message: string;
}

/**
 * An expected, client-facing error. Anything thrown that is NOT an AppError
 * (or a recognised library error) is treated as an internal 500 and its
 * message is never sent to the client.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly errors: ErrorDetail[];

  constructor(statusCode: number, message: string, errors: ErrorDetail[] = []) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.errors = errors;
  }

  static badRequest(message = "Bad request", errors?: ErrorDetail[]) {
    return new AppError(400, message, errors);
  }

  static unauthorized(message = "Authentication required") {
    return new AppError(401, message);
  }

  static forbidden(message = "You do not have permission to perform this action") {
    return new AppError(403, message);
  }

  static notFound(message = "Resource not found") {
    return new AppError(404, message);
  }

  static conflict(message = "Resource already exists", errors?: ErrorDetail[]) {
    return new AppError(409, message, errors);
  }

  static validation(errors: ErrorDetail[], message = "Validation failed") {
    return new AppError(422, message, errors);
  }
}
