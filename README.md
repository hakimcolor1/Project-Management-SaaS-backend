# TeamFlow – Project Management SaaS (Backend)

Multi-tenant REST API for TeamFlow: organizations manage their members, projects, tasks and subscriptions in isolated workspaces.

> **Status:** Phase 1 of 9 complete (project setup, database schema, common utilities). See [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md).

## Tech stack

| Concern | Choice |
|---|---|
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
|---|---|
| `bun run dev` | Start the dev server with reload (tsx) |
| `bun run build` | Generate the Prisma client and bundle to `dist/` (tsup) |
| `bun run start` | Run the production build |
| `bun run lint` / `typecheck` / `test` | ESLint / `tsc --noEmit` / Vitest |
| `bun run db:generate` | Regenerate the Prisma client |
| `bun run db:migrate` | Create/apply migrations in development |
| `bun run db:deploy` | Apply migrations in production (`prisma migrate deploy`) |
| `bun run db:seed` | Seed the SUPER_ADMIN account and subscription plans |

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

```
prisma/          schema.prisma (generator + datasource), enums.prisma, models/*.prisma, migrations/, seed.ts
src/config/      env validation, Prisma client
src/middlewares/ validation, error handling, 404
src/modules/     one folder per feature (route / controller / service / validation)
src/utils/       response, errors, pagination, password, JWT helpers
src/routes/      mounts module routers under /api/v1
tests/           Vitest + Supertest
```
