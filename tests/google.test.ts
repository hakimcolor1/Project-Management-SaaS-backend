import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../src/app.js";
import { verifyGoogleIdToken } from "../src/config/google.js";

// The test environment has no GOOGLE_CLIENT_ID: Google login must fail
// clearly instead of pretending to work.
describe("Google login without configuration", () => {
  it("verifyGoogleIdToken throws a 503 AppError", async () => {
    await expect(verifyGoogleIdToken("any-token")).rejects.toMatchObject({
      statusCode: 503,
      message: "Google login is not configured on this server",
    });
  });

  it("the redirect flow (GET /auth/google and its callback) responds 503", async () => {
    const expected = {
      success: false,
      message: "Google OAuth redirect login is not configured on this server",
      errors: [],
    };
    const start = await request(app).get("/api/v1/auth/google");
    expect(start.status).toBe(503);
    expect(start.body).toEqual(expected);
    expect(start.headers.location).toBeUndefined();

    const callback = await request(app).get("/api/v1/auth/google/callback").query({ code: "c", state: "s" });
    expect(callback.status).toBe(503);
    expect(callback.body).toEqual(expected);
  });

  it("POST /auth/google responds 503 with the standard error envelope", async () => {
    const res = await request(app).post("/api/v1/auth/google").send({ idToken: "any-token" });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      message: "Google login is not configured on this server",
      errors: [],
    });
  });
});
