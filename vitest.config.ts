import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./tests/setup/test-database.js";

// Tests never read `.env`; they get an isolated, non-secret configuration.
// DB-backed tests use a dedicated database (TEST_DATABASE_URL, default: the
// `teamflow_test` DB from docker-compose) that is migrated before the run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global-setup.ts"],
    // DB-backed test files truncate shared tables, so run files one at a time.
    fileParallelism: false,
    restoreMocks: true,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef0123456789",
      JWT_REFRESH_SECRET: "test-refresh-secret-0123456789abcdef012345678",
      JWT_ACCESS_EXPIRES_IN: "15m",
      JWT_REFRESH_EXPIRES_IN: "7d",
      FRONTEND_URL: "http://localhost:3000",
      BACKEND_URL: "http://localhost:5000",
      // Fake gateway credentials: tests mock the SSLCommerz HTTP calls and
      // sign IPN payloads with this password.
      SSL_STORE_ID: "teamflow-test-store",
      SSL_STORE_PASSWORD: "teamflow-test-password",
      SSL_IS_LIVE: "false",
    },
  },
});
