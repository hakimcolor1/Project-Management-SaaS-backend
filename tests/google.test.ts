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
