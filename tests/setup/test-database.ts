/** Database used by DB-backed tests. Override with TEST_DATABASE_URL. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://teamflow:teamflow@localhost:5433/teamflow_test";

/**
 * Tests truncate every table, so refuse to run against anything that is not
 * clearly a test database (name must end with `_test`).
 */
export const assertIsTestDatabase = (databaseUrl: string): void => {
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against database "${databaseName}": its name must end with "_test".`,
    );
  }
};
