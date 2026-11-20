import { readFileSync } from "node:fs";
import path from "node:path";
import { Router } from "express";

/**
 * Swagger UI at /api-docs. The UI assets come from a pinned jsDelivr version
 * with Subresource Integrity hashes; the OpenAPI document is served from
 * docs/api-documentation.yaml. (swagger-ui-express is avoided because its
 * node_modules static files are not served reliably on serverless hosts.)
 */
const SWAGGER_UI = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1";
const BUNDLE_SRI = "sha384-XFYN47VzPiDY6qPtxYKg0nqUeW/upo20xf1j2SUE7gT/i35FJB4cuS/71Iegzk8Z";
const CSS_SRI = "sha384-4c3vsE5f+trhFyHrFrLM1fFGUn531NIaC7dcqEWIJdoRQJ5CkJbSuSCwXLpaS1KF";

const SPEC_FILE = path.resolve(process.cwd(), "docs/api-documentation.yaml");
let specCache: string | undefined;
const loadSpec = () => (specCache ??= readFileSync(SPEC_FILE, "utf8"));

// Swagger UI needs the CDN for scripts/styles and inline style attributes.
const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' https://cdn.jsdelivr.net",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TeamFlow API Docs</title>
    <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css" integrity="${CSS_SRI}" crossorigin="anonymous" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI}/swagger-ui-bundle.js" integrity="${BUNDLE_SRI}" crossorigin="anonymous"></script>
    <script src="/api-docs/init.js"></script>
  </body>
</html>`;

// Separate file instead of an inline script, so the CSP needs no 'unsafe-inline' for scripts.
const INIT_SCRIPT = `window.ui = SwaggerUIBundle({
  url: "/api-docs/openapi.yaml",
  dom_id: "#swagger-ui",
  deepLinking: true,
  persistAuthorization: true,
  withCredentials: true,
});`;

export const docsRoutes = Router();

docsRoutes.get("/", (_req, res) => {
  res.setHeader("Content-Security-Policy", DOCS_CSP);
  res.type("html").send(PAGE);
});

docsRoutes.get("/init.js", (_req, res) => {
  res.type("application/javascript").send(INIT_SCRIPT);
});

docsRoutes.get("/openapi.yaml", (_req, res) => {
  res.type("application/yaml").send(loadSpec());
});
