// Vercel Function entry. vercel.json rewrites every request here and the
// compiled Express app (`bun run build` → dist/app.js) handles it. This file
// never calls listen(); the long-running local server is dist/server.js.

// Production unless the project sets NODE_ENV itself. It is not set on Vercel
// because a NODE_ENV=production install would skip the build's devDependencies.
// Set before the app loads, since its config is validated on import.
process.env.NODE_ENV ??= "production";

const { default: app } = await import("../dist/app.js");

export default app;
