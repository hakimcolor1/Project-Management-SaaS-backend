import express from "express";
import request, { type Response } from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app.js";
import type { GoogleProfile } from "../src/config/google.js";
import { authenticate } from "../src/middlewares/auth.middleware.js";
import { errorHandler } from "../src/middlewares/error.middleware.js";
import { authorize } from "../src/middlewares/role.middleware.js";
import { AppError } from "../src/utils/app-error.js";
import { REFRESH_TOKEN_TTL_MS, hashToken, signRefreshToken } from "../src/utils/jwt.js";
import { prisma, resetDatabase } from "./helpers/db.js";
import { DEFAULT_PASSWORD, bearerFor, createUser } from "./helpers/factories.js";

// Google's signature check is the library's job; here we control what a
// *verified* token contains and test our own find-or-create / linking rules.
const { verifyGoogleIdToken } = vi.hoisted(() => ({
  verifyGoogleIdToken: vi.fn<(idToken: string) => Promise<GoogleProfile>>(),
}));
vi.mock("../src/config/google.js", () => ({ verifyGoogleIdToken }));

const AUTH = "/api/v1/auth";

const setCookies = (res: Response): string[] => {
  const header: unknown = res.headers["set-cookie"];
  if (Array.isArray(header)) return header.filter((value): value is string => typeof value === "string");
  return typeof header === "string" ? [header] : [];
};
const findCookie = (res: Response, name: string) => setCookies(res).find((c) => c.startsWith(`${name}=`));

const loginAs = (email: string, password = DEFAULT_PASSWORD) =>
  request(app).post(`${AUTH}/login`).send({ email, password });

beforeEach(async () => {
  await resetDatabase();
  verifyGoogleIdToken.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /auth/register", () => {
  const payload = { name: "John Doe", email: "John@Example.com", password: "SecurePassword123" };

  it("creates a TEAM_OWNER with a bcrypt-hashed password and never returns it", async () => {
    const res = await request(app).post(`${AUTH}/register`).send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({ name: "John Doe", email: "john@example.com", role: "TEAM_OWNER" });
    expect(res.body.data.user).not.toHaveProperty("password");

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: "john@example.com" } });
    expect(stored.password).toMatch(/^\$2b\$12\$/);
    expect(stored.password).not.toContain(payload.password);
  });

  it("rejects a duplicate email (case-insensitive) with 409", async () => {
    await request(app).post(`${AUTH}/register`).send(payload);
    const res = await request(app)
      .post(`${AUTH}/register`)
      .send({ ...payload, email: "JOHN@example.com" });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(await prisma.user.count()).toBe(1);
  });

  it("never accepts a role from the request", async () => {
    const res = await request(app)
      .post(`${AUTH}/register`)
      .send({ ...payload, role: "SUPER_ADMIN" });

    expect(res.status).toBe(422);
    expect(await prisma.user.count()).toBe(0);
  });

  it("validates every field with a structured 422", async () => {
    const res = await request(app).post(`${AUTH}/register`).send({ name: "J", email: "not-an-email", password: "weak" });

    expect(res.status).toBe(422);
    const fields = (res.body.errors as { field: string }[]).map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(["name", "email", "password"]));
  });
});

describe("POST /auth/login", () => {
  it("returns tokens, sets HTTP-only cookies and stores only the refresh-token hash", async () => {
    const user = await createUser({ email: "owner@example.com" });
    const res = await loginAs("OWNER@example.com");

    expect(res.status).toBe(200);
    const { accessToken, refreshToken } = res.body.data as { accessToken: string; refreshToken: string };
    expect(typeof accessToken).toBe("string");
    expect(res.body.data.user).toMatchObject({ id: user.id, role: "TEAM_OWNER" });
    expect(res.body.data.user).not.toHaveProperty("password");

    const accessCookie = findCookie(res, "accessToken");
    const refreshCookie = findCookie(res, "refreshToken");
    expect(accessCookie).toMatch(/HttpOnly/i);
    expect(accessCookie).toMatch(/Path=\/;/);
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(refreshCookie).toMatch(/SameSite=Lax/i);

    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.tokenHash).toBe(hashToken(refreshToken));
    expect(tokens[0]?.tokenHash).not.toBe(refreshToken);
  });

  it("rejects a wrong password and an unknown email with the same 401", async () => {
    await createUser({ email: "owner@example.com" });

    const wrongPassword = await loginAs("owner@example.com", "WrongPassword123");
    const unknownEmail = await loginAs("nobody@example.com");

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.message).toBe("Invalid email or password");
    expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
  });

  it("rejects password login for Google-only accounts", async () => {
    await createUser({ email: "google@example.com", password: null, googleId: "google-sub-1" });
    const res = await loginAs("google@example.com");
    expect(res.status).toBe(401);
  });

  it("rejects deactivated accounts with 403", async () => {
    await createUser({ email: "inactive@example.com", isActive: false });
    const res = await loginAs("inactive@example.com");
    expect(res.status).toBe(403);
  });
});

describe("GET /auth/me", () => {
  it("returns the current user via Bearer token", async () => {
    const user = await createUser();
    const res = await request(app).get(`${AUTH}/me`).set("Authorization", bearerFor(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: user.id, email: user.email, organization: null });
    expect(res.body.data).not.toHaveProperty("password");
    expect(res.body.data).not.toHaveProperty("googleId");
  });

  it("returns the current user via the access-token cookie", async () => {
    const user = await createUser({ email: "cookie@example.com" });
    const agent = request.agent(app);
    await agent.post(`${AUTH}/login`).send({ email: user.email, password: DEFAULT_PASSWORD });

    const res = await agent.get(`${AUTH}/me`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(user.id);
  });

  it("returns 401 without a token or with an invalid token", async () => {
    const missing = await request(app).get(`${AUTH}/me`);
    const invalid = await request(app).get(`${AUTH}/me`).set("Authorization", "Bearer not.a.token");

    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ success: false, message: "Authentication required", errors: [] });
    expect(invalid.status).toBe(401);
  });

  it("rejects tokens of deleted users (401) and deactivated users (403)", async () => {
    const deleted = await createUser();
    const deactivated = await createUser();
    const deletedHeader = bearerFor(deleted);
    const deactivatedHeader = bearerFor(deactivated);
    await prisma.user.delete({ where: { id: deleted.id } });
    await prisma.user.update({ where: { id: deactivated.id }, data: { isActive: false } });

    expect((await request(app).get(`${AUTH}/me`).set("Authorization", deletedHeader)).status).toBe(401);
    expect((await request(app).get(`${AUTH}/me`).set("Authorization", deactivatedHeader)).status).toBe(403);
  });
});

describe("POST /auth/refresh-token", () => {
  it("rotates the refresh token from the cookie", async () => {
    const user = await createUser();
    const agent = request.agent(app);
    const login = await agent.post(`${AUTH}/login`).send({ email: user.email, password: DEFAULT_PASSWORD });
    const oldRefresh = login.body.data.refreshToken as string;

    const res = await agent.post(`${AUTH}/refresh-token`);

    expect(res.status).toBe(200);
    const { accessToken, refreshToken } = res.body.data as { accessToken: string; refreshToken: string };
    expect(refreshToken).not.toBe(oldRefresh);
    expect(findCookie(res, "refreshToken")).toBeDefined();

    const old = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(oldRefresh) } });
    expect(old.revokedAt).not.toBeNull();
    const fresh = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(refreshToken) } });
    expect(fresh.revokedAt).toBeNull();

    const me = await request(app).get(`${AUTH}/me`).set("Authorization", `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
  });

  it("accepts the refresh token in the body (API clients)", async () => {
    const user = await createUser();
    const login = await loginAs(user.email);
    const res = await request(app)
      .post(`${AUTH}/refresh-token`)
      .send({ refreshToken: login.body.data.refreshToken as string });
    expect(res.status).toBe(200);
  });

  it("detects reuse of a rotated token and revokes every session", async () => {
    const user = await createUser();
    const login = await loginAs(user.email);
    const original = login.body.data.refreshToken as string;

    const rotated = await request(app).post(`${AUTH}/refresh-token`).send({ refreshToken: original });
    const newToken = rotated.body.data.refreshToken as string;

    const reuse = await request(app).post(`${AUTH}/refresh-token`).send({ refreshToken: original });
    expect(reuse.status).toBe(401);
    expect(reuse.body.message).toMatch(/revoked/);

    // The legitimately rotated token is now revoked as well.
    const afterReuse = await request(app).post(`${AUTH}/refresh-token`).send({ refreshToken: newToken });
    expect(afterReuse.status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it("returns 401 for missing, malformed or access tokens", async () => {
    const user = await createUser();
    const missing = await request(app).post(`${AUTH}/refresh-token`);
    const garbage = await request(app).post(`${AUTH}/refresh-token`).send({ refreshToken: "garbage" });
    const accessToken = bearerFor(user).replace("Bearer ", "");
    const wrongType = await request(app).post(`${AUTH}/refresh-token`).send({ refreshToken: accessToken });

    expect(missing.status).toBe(401);
    expect(missing.body.message).toBe("Refresh token is required");
    expect(garbage.status).toBe(401);
    expect(wrongType.status).toBe(401);
  });

  it("rejects a token whose database record has expired", async () => {
    const user = await createUser();
    const tokenId = crypto.randomUUID();
    const refreshToken = signRefreshToken({ userId: user.id, tokenId });
    await prisma.refreshToken.create({
      data: { id: tokenId, userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app).post(`${AUTH}/refresh-token`).send({ refreshToken });
    expect(res.status).toBe(401);
  });

  it("rejects refresh for a deactivated user", async () => {
    const user = await createUser();
    const tokenId = crypto.randomUUID();
    const refreshToken = signRefreshToken({ userId: user.id, tokenId });
    await prisma.refreshToken.create({
      data: {
        id: tokenId,
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const res = await request(app).post(`${AUTH}/refresh-token`).send({ refreshToken });
    expect(res.status).toBe(403);
  });
});

describe("POST /auth/logout", () => {
  it("revokes the refresh token and clears both cookies", async () => {
    const user = await createUser();
    const agent = request.agent(app);
    const login = await agent.post(`${AUTH}/login`).send({ email: user.email, password: DEFAULT_PASSWORD });
    const refreshToken = login.body.data.refreshToken as string;

    const res = await agent.post(`${AUTH}/logout`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "Logged out successfully", data: null });
    expect(findCookie(res, "accessToken")).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(findCookie(res, "refreshToken")).toMatch(/Expires=Thu, 01 Jan 1970/);

    const stored = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(refreshToken) } });
    expect(stored.revokedAt).not.toBeNull();

    const refreshAfterLogout = await request(app).post(`${AUTH}/refresh-token`).send({ refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
  });

  it("is idempotent when no token is present", async () => {
    const res = await request(app).post(`${AUTH}/logout`);
    expect(res.status).toBe(200);
  });
});

describe("POST /auth/google", () => {
  const profile: GoogleProfile = {
    googleId: "google-sub-123",
    email: "jane@gmail.com",
    name: "Jane Google",
    avatar: "https://lh3.googleusercontent.com/a/photo",
  };

  it("creates a TEAM_OWNER from the verified Google profile", async () => {
    verifyGoogleIdToken.mockResolvedValue(profile);

    const res = await request(app).post(`${AUTH}/google`).send({ idToken: "google-id-token" });

    expect(res.status).toBe(200);
    expect(verifyGoogleIdToken).toHaveBeenCalledWith("google-id-token");
    expect(res.body.data.user).toMatchObject({ email: profile.email, role: "TEAM_OWNER", emailVerified: true });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(findCookie(res, "accessToken")).toBeDefined();

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: profile.email } });
    expect(stored).toMatchObject({ googleId: profile.googleId, password: null, avatar: profile.avatar });
  });

  it("signs in a returning Google user without creating a duplicate", async () => {
    const existing = await createUser({ email: profile.email, password: null, googleId: profile.googleId });
    verifyGoogleIdToken.mockResolvedValue(profile);

    const res = await request(app).post(`${AUTH}/google`).send({ idToken: "google-id-token" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(existing.id);
    expect(await prisma.user.count()).toBe(1);
  });

  it("links an unverified password account: removes the password and revokes old sessions", async () => {
    const existing = await createUser({ email: profile.email, emailVerified: false });
    const oldSession = await loginAs(profile.email);
    verifyGoogleIdToken.mockResolvedValue(profile);

    const res = await request(app).post(`${AUTH}/google`).send({ idToken: "google-id-token" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(existing.id);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(stored).toMatchObject({ googleId: profile.googleId, password: null, emailVerified: true });

    const oldRefresh = await request(app)
      .post(`${AUTH}/refresh-token`)
      .send({ refreshToken: oldSession.body.data.refreshToken as string });
    expect(oldRefresh.status).toBe(401);
    expect((await loginAs(profile.email)).status).toBe(401);
  });

  it("links a verified account and keeps its password", async () => {
    await createUser({ email: profile.email, emailVerified: true });
    verifyGoogleIdToken.mockResolvedValue(profile);

    const res = await request(app).post(`${AUTH}/google`).send({ idToken: "google-id-token" });

    expect(res.status).toBe(200);
    expect((await loginAs(profile.email)).status).toBe(200);
  });

  it("refuses SUPER_ADMIN and deactivated accounts without linking them", async () => {
    const admin = await createUser({ email: "admin@gmail.com", role: "SUPER_ADMIN", emailVerified: true });
    verifyGoogleIdToken.mockResolvedValue({ ...profile, email: admin.email });
    const adminRes = await request(app).post(`${AUTH}/google`).send({ idToken: "t" });

    const inactive = await createUser({ email: "inactive@gmail.com", isActive: false });
    verifyGoogleIdToken.mockResolvedValue({ ...profile, googleId: "other-sub", email: inactive.email });
    const inactiveRes = await request(app).post(`${AUTH}/google`).send({ idToken: "t" });

    expect(adminRes.status).toBe(403);
    expect(inactiveRes.status).toBe(403);
    const linked = await prisma.user.count({ where: { googleId: { not: null } } });
    expect(linked).toBe(0);
  });

  it("rejects an email already linked to a different Google account", async () => {
    await createUser({ email: profile.email, password: null, googleId: "another-google-sub" });
    verifyGoogleIdToken.mockResolvedValue(profile);

    const res = await request(app).post(`${AUTH}/google`).send({ idToken: "google-id-token" });
    expect(res.status).toBe(409);
  });

  it("returns 401 when Google rejects the token", async () => {
    verifyGoogleIdToken.mockRejectedValue(AppError.unauthorized("Invalid Google ID token"));
    const res = await request(app).post(`${AUTH}/google`).send({ idToken: "forged" });
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(0);
  });

  it("does not accept client-submitted profile data", async () => {
    const res = await request(app)
      .post(`${AUTH}/google`)
      .send({ idToken: "google-id-token", email: "attacker@example.com", name: "Attacker" });
    expect(res.status).toBe(422);
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });
});

describe("authorize middleware (role-based access)", () => {
  const guarded = express();
  guarded.get("/admin-only", authenticate, authorize("SUPER_ADMIN"), (_req, res) => {
    res.json({ ok: true });
  });
  guarded.get("/owner-only", authenticate, authorize("TEAM_OWNER"), (_req, res) => {
    res.json({ ok: true });
  });
  guarded.use(errorHandler);

  it("returns 401 for unauthenticated requests", async () => {
    expect((await request(guarded).get("/admin-only")).status).toBe(401);
  });

  it("returns 403 when a TEAM_OWNER calls an admin endpoint", async () => {
    const owner = await createUser({ role: "TEAM_OWNER" });
    const res = await request(guarded).get("/admin-only").set("Authorization", bearerFor(owner));
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("returns 403 when a TEAM_MEMBER calls an owner endpoint", async () => {
    const member = await createUser({ role: "TEAM_MEMBER" });
    const res = await request(guarded).get("/owner-only").set("Authorization", bearerFor(member));
    expect(res.status).toBe(403);
  });

  it("allows the permitted role", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN" });
    const owner = await createUser({ role: "TEAM_OWNER" });
    expect((await request(guarded).get("/admin-only").set("Authorization", bearerFor(admin))).status).toBe(200);
    expect((await request(guarded).get("/owner-only").set("Authorization", bearerFor(owner))).status).toBe(200);
  });

  it("uses the role stored in the database, not the one inside the token", async () => {
    const member = await createUser({ role: "TEAM_MEMBER" });
    // Token claims SUPER_ADMIN, but the account is only a TEAM_MEMBER.
    const forgedRoleToken = bearerFor({ id: member.id, role: "SUPER_ADMIN" });
    const res = await request(guarded).get("/admin-only").set("Authorization", forgedRoleToken);
    expect(res.status).toBe(403);
  });
});
