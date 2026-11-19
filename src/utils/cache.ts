import { redis } from "../config/redis.js";

/**
 * Cache-aside helpers for READ-ONLY, non-critical data (plan list, admin
 * dashboard). Redis is never the source of truth: payments, subscriptions
 * and plan limits are always read from PostgreSQL. Every Redis failure falls
 * back to the database so caching can never break a request.
 */

export const CacheKeys = {
  activePlans: "teamflow:plans:active",
  adminDashboard: "teamflow:admin:dashboard",
} as const;

export const CacheTtlSeconds = {
  activePlans: 600, // invalidated whenever an admin edits a plan
  adminDashboard: 60, // short-lived statistics
} as const;

const warn = (operation: string, key: string, error: unknown) => {
  console.warn(`[cache] ${operation} ${key} failed – using the database instead:`, error instanceof Error ? error.message : error);
};

export const getOrSetCache = async <T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> => {
  if (!redis) return load();

  try {
    const cached = await redis.get<T>(key);
    if (cached !== null) return cached;
  } catch (error) {
    warn("read", key, error);
    return load();
  }

  const value = await load();
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (error) {
    warn("write", key, error);
  }
  return value;
};

export const invalidateCache = async (...keys: string[]): Promise<void> => {
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (error) {
    warn("invalidate", keys.join(","), error);
  }
};
