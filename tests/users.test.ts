import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { prisma, resetDatabase } from "./helpers/db.js";
import { addMemberTo, bearerFor, createOrganizationWithOwner, createUser, seedPlans } from "./helpers/factories.js";

const ME = "/api/v1/users/me";
const AVATAR = "https://cdn.example.com/avatars/jane.png";

beforeEach(async () => {
  await resetDatabase();
  await seedPlans();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /users/me", () => {
  it("requires authentication", async () => {
    const res = await request(app).get(ME);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: "Authentication required", errors: [] });
  });

  it("returns the profile without an organization for a new owner, never secrets", async () => {
    const user = await createUser({ name: "Solo Owner" });

    const res = await request(app).get(ME).set("Authorization", bearerFor(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id: user.id, name: "Solo Owner", role: "TEAM_OWNER", organization: null });
    expect(res.body.data).not.toHaveProperty("password");
    expect(res.body.data).not.toHaveProperty("googleId");
  });

  it("returns the member's organization and matches GET /auth/me", async () => {
    const { organization } = await createOrganizationWithOwner({ name: "Acme" });
    const { user } = await addMemberTo(organization.id);
    const auth = bearerFor(user);

    const res = await request(app).get(ME).set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.data.organization).toMatchObject({ id: organization.id, name: "Acme", isOwner: false });

    const authMe = await request(app).get("/api/v1/auth/me").set("Authorization", auth);
    expect(authMe.body.data).toEqual(res.body.data);
  });
});

describe("PATCH /users/me", () => {
  it("updates the caller's own name and avatar", async () => {
    const user = await createUser({ name: "Old Name" });

    const res = await request(app)
      .patch(ME)
      .set("Authorization", bearerFor(user))
      .send({ name: "  Jane Doe  ", avatar: AVATAR });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Profile updated successfully");
    expect(res.body.data).toMatchObject({ id: user.id, name: "Jane Doe", avatar: AVATAR });
    expect(res.body.data).not.toHaveProperty("password");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ name: "Jane Doe", avatar: AVATAR });
  });

  it("removes the avatar with null and leaves other fields untouched", async () => {
    const user = await createUser({ name: "Keep Me" });
    await prisma.user.update({ where: { id: user.id }, data: { avatar: AVATAR } });

    const res = await request(app).patch(ME).set("Authorization", bearerFor(user)).send({ avatar: null });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "Keep Me", avatar: null });
  });

  it("works for every role", async () => {
    const { organization } = await createOrganizationWithOwner();
    const { user: member } = await addMemberTo(organization.id);
    const admin = await createUser({ role: "SUPER_ADMIN" });

    for (const user of [member, admin]) {
      const res = await request(app).patch(ME).set("Authorization", bearerFor(user)).send({ name: "Renamed" });
      expect(res.status, user.role).toBe(200);
      expect(res.body.data.role).toBe(user.role);
    }
  });

  it("rejects protected fields (mass assignment) and changes nothing", async () => {
    const { organization } = await createOrganizationWithOwner();
    const { user } = await addMemberTo(organization.id, { name: "Member" });

    for (const body of [
      { role: "SUPER_ADMIN" },
      { email: "new@example.com" },
      { isActive: false },
      { password: "NewPassword123" },
      { emailVerified: true },
      { name: "Sneaky", role: "TEAM_OWNER" },
    ]) {
      const res = await request(app).patch(ME).set("Authorization", bearerFor(user)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.success).toBe(false);
    }

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ name: "Member", role: "TEAM_MEMBER", email: user.email, isActive: true });
  });

  it("validates the body", async () => {
    const user = await createUser();
    const auth = bearerFor(user);

    const empty = await request(app).patch(ME).set("Authorization", auth).send({});
    expect(empty.status).toBe(422);
    expect(empty.body.errors[0].message).toBe("Provide at least one field to update");

    const shortName = await request(app).patch(ME).set("Authorization", auth).send({ name: "J" });
    expect(shortName.status).toBe(422);
    expect(shortName.body.errors[0]).toMatchObject({ field: "name", location: "body" });

    for (const avatar of ["http://insecure.example.com/a.png", "not-a-url", `https://x.com/${"a".repeat(500)}`]) {
      const res = await request(app).patch(ME).set("Authorization", auth).send({ avatar });
      expect(res.status, avatar).toBe(422);
      expect(res.body.errors[0].field).toBe("avatar");
    }
  });

  it("requires authentication", async () => {
    const res = await request(app).patch(ME).send({ name: "Nobody" });
    expect(res.status).toBe(401);
  });
});
