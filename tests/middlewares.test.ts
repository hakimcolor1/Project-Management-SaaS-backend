import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Prisma } from "../src/generated/prisma/client.js";
import { errorHandler } from "../src/middlewares/error.middleware.js";
import { notFound } from "../src/middlewares/not-found.middleware.js";
import { validate } from "../src/middlewares/validate.middleware.js";
import { AppError } from "../src/utils/app-error.js";
import { paginationQuerySchema } from "../src/utils/pagination.js";

const VALID_ID = "0190f3a2-7c1e-7b3a-9f10-2d4c5e6f7a8b";

/** Small app exercising validate → handler → errorHandler. */
const buildValidationApp = () => {
  const app = express();
  app.use(express.json());
  app.post(
    "/items/:id",
    validate({
      params: z.object({ id: z.uuid() }),
      query: paginationQuerySchema,
      body: z.object({ name: z.string().min(1), priority: z.enum(["LOW", "HIGH"]) }),
    }),
    (req, res) => {
      res.json({ params: req.params, query: req.query, body: req.body as unknown });
    },
  );
  app.use(notFound);
  app.use(errorHandler);
  return app;
};

/** App whose only route throws the given error. */
const appThrowing = (error: unknown) => {
  const app = express();
  app.get("/boom", () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
};

describe("validate middleware", () => {
  const app = buildValidationApp();

  it("passes parsed, coerced and stripped data to the handler", async () => {
    const res = await request(app)
      .post(`/items/${VALID_ID}?page=2`)
      .send({ name: "Task", priority: "HIGH", role: "SUPER_ADMIN" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      params: { id: VALID_ID },
      query: { page: 2, limit: 10 },
      // Unknown keys are stripped – no mass assignment.
      body: { name: "Task", priority: "HIGH" },
    });
  });

  it("returns 422 with every issue across params, query and body", async () => {
    const res = await request(app).post("/items/not-a-uuid?limit=500").send({ priority: "MEDIUM" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Validation failed");
    const fields = (res.body.errors as { location: string; field: string }[]).map((e) => `${e.location}.${e.field}`);
    expect(fields).toEqual(expect.arrayContaining(["params.id", "query.limit", "body.name", "body.priority"]));
  });

  it("treats a missing body as an empty object", async () => {
    const res = await request(app).post(`/items/${VALID_ID}`);
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: "name" })]));
  });
});

describe("error middleware", () => {
  it("returns AppError status, message and details", async () => {
    const res = await request(appThrowing(AppError.conflict("Email already registered"))).get("/boom");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: "Email already registered", errors: [] });
  });

  it("hides internal error messages and stack traces", async () => {
    const res = await request(appThrowing(new Error("connection string postgres://secret"))).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: "Internal server error", errors: [] });
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("maps Prisma unique violations to 409 with field names", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: Prisma.prismaVersion.client,
      meta: { target: ["email"] },
    });
    const res = await request(appThrowing(error)).get("/boom");
    expect(res.status).toBe(409);
    expect(res.body.errors).toEqual([{ field: "email", message: "email is already in use" }]);
  });

  it("maps Prisma record-not-found to 404", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: Prisma.prismaVersion.client,
    });
    const res = await request(appThrowing(error)).get("/boom");
    expect(res.status).toBe(404);
  });

  it("maps a thrown ZodError to 422", async () => {
    const zodError = z.object({ email: z.email() }).safeParse({ email: "nope" }).error;
    const res = await request(appThrowing(zodError)).get("/boom");
    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe("email");
  });

  it("maps JWT errors to 401", async () => {
    const expired = await request(appThrowing(new jwt.TokenExpiredError("jwt expired", new Date()))).get("/boom");
    expect(expired.status).toBe(401);
    expect(expired.body.message).toBe("Token has expired");

    const invalid = await request(appThrowing(new jwt.JsonWebTokenError("invalid signature"))).get("/boom");
    expect(invalid.status).toBe(401);
    expect(invalid.body.message).toBe("Invalid token");
  });
});
