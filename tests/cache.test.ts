import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for Upstash Redis (same get/set/del contract, JSON round-trip).
const fake = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const state = { failing: false };
  const guard = () => {
    if (state.failing) throw new Error("Redis unavailable");
  };
  const redis = {
    get: vi.fn((key: string) => {
      guard();
      return Promise.resolve(store.has(key) ? store.get(key) : null);
    }),
    set: vi.fn((key: string, value: unknown, _options?: { ex: number }) => {
      guard();
      store.set(key, JSON.parse(JSON.stringify(value)));
      return Promise.resolve("OK");
    }),
    del: vi.fn((...keys: string[]) => {
      guard();
      keys.forEach((key) => store.delete(key));
      return Promise.resolve(keys.length);
    }),
  };
  return { store, state, redis };
});
vi.mock("../src/config/redis.js", () => ({ redis: fake.redis }));

const { default: app } = await import("../src/app.js");
const { prisma, resetDatabase } = await import("./helpers/db.js");
const { bearerFor, createOrganizationWithOwner, createUser, seedPlans } = await import("./helpers/factories.js");

let plans: Awaited<ReturnType<typeof seedPlans>>;

beforeEach(async () => {
  await resetDatabase();
  plans = await seedPlans();
  fake.store.clear();
  fake.state.failing = false;
  vi.clearAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const proPrice = (res: request.Response) =>
  (res.body.data as { name: string; price: string }[]).find((plan) => plan.name === "PRO")?.price;

describe("plan list caching", () => {
  it("serves GET /plans from Redis with a 10-minute expiry", async () => {
    await request(app).get("/api/v1/plans");
    expect(fake.redis.set).toHaveBeenCalledWith("teamflow:plans:active", expect.any(Array), { ex: 600 });

    // Changed directly in the DB (bypassing the API): the cached copy is served.
    await prisma.subscriptionPlan.update({ where: { id: plans.pro.id }, data: { price: "2500.00" } });
    expect(proPrice(await request(app).get("/api/v1/plans"))).toBe("1500.00");
  });

  it("invalidates the cache when an admin updates a plan", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN" });
    await request(app).get("/api/v1/plans"); // warm the cache

    await request(app).patch(`/api/v1/admin/plans/${plans.pro.id}`).set("Authorization", bearerFor(admin)).send({ price: "1800.00" });

    expect(fake.redis.del).toHaveBeenCalledWith("teamflow:plans:active");
    expect(proPrice(await request(app).get("/api/v1/plans"))).toBe("1800.00");
  });

  it("falls back to the database when Redis is down", async () => {
    fake.state.failing = true;
    const res = await request(app).get("/api/v1/plans");
    expect(res.status).toBe(200);
    expect(proPrice(res)).toBe("1500.00");
  });
});

describe("what is NOT cached", () => {
  it("never reads subscriptions or payments from Redis", async () => {
    const { owner } = await createOrganizationWithOwner();
    const auth = bearerFor(owner);

    await request(app).get("/api/v1/subscriptions/current").set("Authorization", auth);
    await request(app).get("/api/v1/payments/history").set("Authorization", auth);

    expect(fake.redis.get).not.toHaveBeenCalled();
    expect(fake.redis.set).not.toHaveBeenCalled();
  });
});

describe("admin dashboard caching", () => {
  it("caches statistics for 60 seconds", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN" });
    await request(app).get("/api/v1/admin/dashboard").set("Authorization", bearerFor(admin));
    expect(fake.redis.set).toHaveBeenCalledWith("teamflow:admin:dashboard", expect.any(Object), { ex: 60 });
  });
});
