import { defineConfig } from "vitest/config";

// Tests never read `.env`; they get an isolated, non-secret configuration.
// Override the database with TEST_DATABASE_URL when running DB-backed tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgresql://teamflow:teamflow@localhost:5433/teamflow_test",
      JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef0123456789",
      JWT_REFRESH_SECRET: "test-refresh-secret-0123456789abcdef012345678",
      JWT_ACCESS_EXPIRES_IN: "15m",
      JWT_REFRESH_EXPIRES_IN: "7d",
      FRONTEND_URL: "http://localhost:3000",
      BACKEND_URL: "http://localhost:5000",
    },
  },
});
