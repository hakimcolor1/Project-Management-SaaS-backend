import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The app shell is tested without a database; the probe is controlled here.
const { checkDatabaseConnection } = vi.hoisted(() => ({ checkDatabaseConnection: vi.fn<() => Promise<boolean>>() }));
vi.mock("../src/config/database.js", () => ({
  prisma: {},
  checkDatabaseConnection,
  disconnectDatabase: vi.fn(),
}));

const { default: app } = await import("../src/app.js");

describe("app shell", () => {
  beforeEach(() => {
    checkDatabaseConnection.mockResolvedValue(true);
  });

  it("GET / returns the standard success envelope", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: "Welcome to the TeamFlow API" });
  });

  it("GET /api/v1/health reports a healthy database", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { status: "ok", database: "connected", environment: "test" },
    });
  });

  it("GET /api/v1/health returns 503 when the database is unreachable", async () => {
    checkDatabaseConnection.mockResolvedValue(false);
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      message: "Service unavailable",
      errors: [{ message: "Database connection failed" }],
    });
  });

  it("unknown routes return a structured 404", async () => {
    const res = await request(app).get("/api/v1/does-not-exist?x=1");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: "Route not found: GET /api/v1/does-not-exist",
      errors: [],
    });
  });

  it("malformed JSON returns a structured 400", async () => {
    const res = await request(app)
      .post("/api/v1/health")
      .set("Content-Type", "application/json")
      .send('{"name": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "Malformed JSON in request body", errors: [] });
  });

  it("sets security headers and hides the framework", async () => {
    const res = await request(app).get("/");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows credentialed CORS only for the configured frontend origin", async () => {
    const allowed = await request(app).get("/").set("Origin", "http://localhost:3000");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const blocked = await request(app).get("/").set("Origin", "https://evil.example");
    expect(blocked.headers["access-control-allow-origin"]).not.toBe("https://evil.example");
  });
});
