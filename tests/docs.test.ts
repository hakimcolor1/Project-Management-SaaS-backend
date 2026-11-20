import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import app from "../src/app.js";
import { prisma } from "./helpers/db.js";

/** Every endpoint the API implements (REQUIREMENTS §7–§13 plus /health and two admin extras). */
const ENDPOINTS: readonly [method: string, path: string][] = [
  ["get", "/health"],
  ["post", "/auth/register"],
  ["post", "/auth/login"],
  ["post", "/auth/google"],
  ["post", "/auth/refresh-token"],
  ["post", "/auth/logout"],
  ["get", "/auth/me"],
  ["post", "/organizations"],
  ["get", "/organizations/current"],
  ["patch", "/organizations/current"],
  ["post", "/organizations/current/members"],
  ["get", "/organizations/current/members"],
  ["patch", "/organizations/current/members/{memberId}"],
  ["delete", "/organizations/current/members/{memberId}"],
  ["post", "/projects"],
  ["get", "/projects"],
  ["get", "/projects/{projectId}"],
  ["patch", "/projects/{projectId}"],
  ["delete", "/projects/{projectId}"],
  ["post", "/projects/{projectId}/tasks"],
  ["get", "/projects/{projectId}/tasks"],
  ["get", "/tasks/{taskId}"],
  ["patch", "/tasks/{taskId}"],
  ["patch", "/tasks/{taskId}/status"],
  ["patch", "/tasks/{taskId}/assign"],
  ["delete", "/tasks/{taskId}"],
  ["get", "/plans"],
  ["get", "/subscriptions/current"],
  ["post", "/payments/initiate"],
  ["post", "/payments/validate"],
  ["post", "/payments/ipn"],
  ["get", "/payments/history"],
  ["get", "/admin/dashboard"],
  ["get", "/admin/organizations"],
  ["patch", "/admin/organizations/{id}/status"],
  ["get", "/admin/users"],
  ["get", "/admin/payments"],
  ["get", "/admin/audit-logs"],
  ["patch", "/admin/plans/{planId}"],
];

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("API documentation", () => {
  it("serves Swagger UI with a restrictive CSP and pinned, integrity-checked assets", async () => {
    const res = await request(app).get("/api-docs");
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="swagger-ui"');
    expect(res.text).toMatch(/swagger-ui-dist@\d+\.\d+\.\d+\/swagger-ui-bundle\.js" integrity="sha384-/);
    expect(res.headers["content-security-policy"]).toContain("script-src 'self' https://cdn.jsdelivr.net");
    expect(res.headers["content-security-policy"]).not.toContain("script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'");

    expect((await request(app).get("/api-docs/init.js")).text).toContain('url: "/api-docs/openapi.yaml"');
  });

  it("documents every implemented endpoint, and every documented endpoint exists", async () => {
    const res = await request(app).get("/api-docs/openapi.yaml");
    expect(res.status).toBe(200);
    const spec = parse(res.text) as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(spec.openapi).toMatch(/^3\./);

    const documented = Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((key) => HTTP_METHODS.has(key))
        .map((method) => `${method.toUpperCase()} ${path}`),
    );
    const implemented = ENDPOINTS.map(([method, path]) => `${method.toUpperCase()} ${path}`);
    expect(documented.sort()).toEqual([...implemented].sort());
  });

  it("every listed endpoint is a real route (never 'Route not found')", async () => {
    const id = crypto.randomUUID();
    for (const [method, path] of ENDPOINTS) {
      const url = `/api/v1${path.replace(/\{[^}]+\}/g, id)}`;
      const res = await request(app)[method as "get" | "post" | "patch" | "delete"](url);
      expect(res.body.message ?? "", `${method.toUpperCase()} ${path}`).not.toMatch(/^Route not found/);
    }
  });
});
