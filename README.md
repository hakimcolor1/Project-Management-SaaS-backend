# TeamFlow – Project Management SaaS (Backend)

Multi-tenant REST API for TeamFlow: organizations manage their members, projects, tasks and subscriptions in isolated workspaces.

> **Status:** Phase 2 of 9 complete (project setup, database, authentication & role-based authorization). See [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md).

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime / language | Node.js 24, TypeScript 6 (strict, ESM) |
| Package manager | Bun |
| Framework | Express 5 |
| Database | PostgreSQL + Prisma 7 (`pg` driver adapter) |
| Validation | Zod 4 |
| Auth | JWT (access + rotating refresh), bcrypt, Google ID-token login |
| Build / tests | tsup, Vitest + Supertest, ESLint |
| Planned | Upstash Redis, SSLCommerz, Swagger UI, Vercel |

Architecture: modular monolith – `Routes → Middlewares → Controllers → Services → Prisma → PostgreSQL`.

## Getting started

Prerequisites: Node.js ≥ 24.11, Bun ≥ 1.2, and a PostgreSQL database (Docker Compose file included).

```bash
bun install                     # also generates the Prisma client
cp .env.example .env            # then fill in the values (see below)
docker compose up -d            # optional: local PostgreSQL on port 5433
bun run db:migrate              # apply migrations
bun run db:seed                 # create the SUPER_ADMIN + FREE/PRO plans
bun run dev                     # http://localhost:5000
```

Check it works: `GET http://localhost:5000/api/v1/health` → `200` with `"database": "connected"`.

### Environment variables

All variables are validated at startup (`src/config/env.ts`); the app refuses to start with a clear list of what is missing or invalid. Required now: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (two different 32+ character secrets). Google, SSLCommerz and Redis credentials are optional until their phases; see `.env.example` for every variable.

## Scripts

| Script | Purpose |
| --- | --- |
| `bun run dev` | Start the dev server with reload (tsx) |
| `bun run build` | Generate the Prisma client and bundle to `dist/` (tsup) |
| `bun run start` | Run the production build |
| `bun run lint` / `typecheck` / `test` | ESLint / `tsc --noEmit` / Vitest |
| `bun run db:generate` | Regenerate the Prisma client |
| `bun run db:migrate` | Create/apply migrations in development |
| `bun run db:deploy` | Apply migrations in production (`prisma migrate deploy`) |
| `bun run db:seed` | Seed the SUPER_ADMIN account and subscription plans |

### Running tests

Tests run against a separate database, `teamflow_test`, which `docker compose up -d` creates. Vitest migrates it automatically before each run. Tests empty its tables, so they refuse to run against any database whose name does not end in `_test`. Use `TEST_DATABASE_URL` to point them at another test database. Run them with `bun run test`; plain `bun test` starts Bun's own runner instead of Vitest.

## Authentication

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /api/v1/auth/register` | – | Create a TEAM_OWNER account (`name`, `email`, `password`) |
| `POST /api/v1/auth/login` | – | Email + password → access & refresh tokens |
| `POST /api/v1/auth/google` | – | Google ID token (`idToken`) → tokens. Needs `GOOGLE_CLIENT_ID`. |
| `POST /api/v1/auth/refresh-token` | refresh token | Rotate the refresh token, issue a new access token |
| `POST /api/v1/auth/logout` | refresh token | Revoke the refresh token and clear cookies |
| `GET /api/v1/auth/me` | access token | Current user and their organization |

How the tokens work:

- **Access token** (15 min). Send it as `Authorization: Bearer <token>`, or let the browser send the `accessToken` HTTP-only cookie.
- **Refresh token** (7 days). It is kept in the `refreshToken` HTTP-only cookie, which is only sent to `/api/v1/auth`. API clients such as Postman can send it as `{ "refreshToken": "…" }` instead.
  - Each refresh revokes the old token and issues a new one.
  - Reusing a revoked token signs the user out of every session.
  - Only a SHA-256 hash of each refresh token is stored.
- **Response body.** Login responses also return both tokens in the body, for API clients. Browser apps should rely on the cookies and never store tokens in `localStorage`.
- **Cookie settings in production.** Cookies are `Secure` and `SameSite=None` because the frontend and API run on different domains.

Roles: `SUPER_ADMIN` (seed only), `TEAM_OWNER` (every public sign-up), `TEAM_MEMBER` (added by an owner). Routes are protected with `authenticate` and `authorize(...roles)`. The role is re-read from the database on every request.

## Demo admin account

`bun run db:seed` creates a SUPER_ADMIN from `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD`, hashed with bcrypt. Re-running it never duplicates the admin and never promotes an existing non-admin account. Public registration cannot create a SUPER_ADMIN. The deployed demo credentials will be listed here in the deployment phase.

## API response format

```jsonc
// Success
{ "success": true, "message": "Operation successful", "data": {} }
// Success with pagination
{ "success": true, "message": "…", "data": [], "meta": { "page": 1, "limit": 10, "total": 0, "totalPages": 0 } }
// Error
{ "success": false, "message": "Validation failed", "errors": [{ "location": "body", "field": "email", "message": "Invalid email address" }] }
```

## Project structure

```text
prisma/schema/   schema.prisma (generator + datasource), <service>.prisma models, enums/<service>.enum.prisma
prisma/          migrations/, seed.ts
src/config/      env validation, Prisma client, Google ID-token verification
src/middlewares/ authenticate, authorize, validate, rate limits, error handling, 404
src/modules/     one folder per feature (route / controller / service / validation / interface)
src/utils/       response, errors, pagination, password, JWT, cookie helpers
src/routes/      mounts module routers under /api/v1
tests/           Vitest + Supertest (helpers/, setup/)
```
