import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TEST_DATABASE_URL, assertIsTestDatabase } from "./test-database.js";

/** Runs once before the test run: brings the test database schema up to date. */
export default function globalSetup(): void {
  assertIsTestDatabase(TEST_DATABASE_URL);

  const prismaCli = fileURLToPath(new URL("../../node_modules/prisma/build/index.js", import.meta.url));
  try {
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: "pipe",
    });
  } catch (error) {
    const output = (error as { stderr?: Buffer; stdout?: Buffer }).stderr?.toString() ?? "";
    throw new Error(
      "Could not migrate the test database. Is PostgreSQL running? (docker compose up -d)\n" + output,
      { cause: error },
    );
  }
}
