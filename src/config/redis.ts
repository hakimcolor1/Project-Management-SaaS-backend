import { Redis } from "@upstash/redis";
import { env } from "./env.js";

/**
 * Upstash Redis over its REST API – no persistent TCP connection, which suits
 * serverless. Optional: without REDIS_URL / REDIS_TOKEN the app still works
 * and simply reads from PostgreSQL every time.
 */
export const redis: Redis | null =
  env.REDIS_URL && env.REDIS_TOKEN ? new Redis({ url: env.REDIS_URL, token: env.REDIS_TOKEN }) : null;
