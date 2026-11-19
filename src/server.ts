// Local / long-running server entry point. Serverless deployments import
// `app` directly and must never call listen().
import app from "./app.js";
import { disconnectDatabase } from "./config/database.js";
import { env } from "./config/env.js";

const server = app.listen(env.PORT, (error?: Error) => {
  if (error) {
    console.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
  console.log(`TeamFlow API listening on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
});

let shuttingDown = false;

const shutdown = (reason: string, exitCode = 0): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${reason} – shutting down gracefully`);

  // Force-exit if open connections keep the server alive too long.
  setTimeout(() => process.exit(1), 10_000).unref();

  server.close(() => {
    disconnectDatabase()
      .catch((err: unknown) => console.error("Error while disconnecting the database", err))
      .finally(() => process.exit(exitCode));
  });
};

process.on("SIGINT", () => shutdown("SIGINT received"));
process.on("SIGTERM", () => shutdown("SIGTERM received"));
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
  shutdown("Unhandled rejection", 1);
});
