import { defineConfig } from "tsup";

// Production build: bundles our own source (including the generated Prisma
// client) into ESM, while npm dependencies stay external in node_modules.
export default defineConfig({
  entry: {
    server: "src/server.ts", // local / long-running server
    app: "src/app.ts", // Express app export (used by the Vercel handler)
  },
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: true,
  skipNodeModulesBundle: true,
  dts: false,
});
