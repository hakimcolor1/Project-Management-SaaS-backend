# TeamFlow – Project Management SaaS (Backend)

Multi-tenant REST API for TeamFlow. Each organization gets an isolated workspace for its members, projects, tasks and subscription. Payments run through SSLCommerz.

| | |
| --- | --- |
| **API docs** | Swagger UI at `/api-docs` · [docs/API.md](docs/API.md) · [Postman collection](docs/TeamFlow.postman_collection.json) |
| **Progress log** | [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md) |
| **Live API** | See [Deployment](#deployment) |

## Features

- **Authentication:**
  - email/password registration and login
  - Google sign-in (the ID token is verified on the server)
  - JWT access tokens with rotating refresh tokens in HTTP-only cookies
  - refresh-token reuse detection, and logout
- **Three roles:** `SUPER_ADMIN` (seeded), `TEAM_OWNER` (every sign-up), `TEAM_MEMBER` (added by an owner). Checks happen at the role level **and** the organization level.
- **Organizations and members:** one organization per owner; add existing accounts by email; activate/deactivate or remove members; plan member limits.
- **Projects:** create, read, update and soft-delete, with search, status filter, sorting, pagination and a progress % calculated from completed tasks.
- **Tasks:**
  - create, read, update and soft-delete
  - assignment, restricted to active members of the organization
  - a status workflow; members may edit only the description and status of their own tasks
  - due-date checks, filters and pagination
- **Subscriptions:** FREE and PRO plans, limits enforced on the server under row locks, and expiry handling.
- **SSLCommerz payments:**
  - session start, then validation through SSLCommerz's own validation API
  - IPN signature check
  - idempotent activation; renewing early extends the current period
- **Super Admin:** statistics from the database, organization suspend/reactivate, users, payments, audit logs, plan management.
- **Audit log** for organization, member, project, task, payment and plan changes.
- **Upstash Redis** caches the plan list and the admin dashboard, with expiry and invalidation. Payments and subscriptions are never cached.
- **Security:**
  - Helmet, a CORS allow-list and rate limiting
  - Zod validation everywhere, and strict request bodies (protection against mass assignment)
  - safe error handling, and environment variables validated at startup

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime / language | Node.js 24, TypeScript 6 (strict, ESM) |
| Package manager | Bun |
| Framework | Express 5 |
| Database | PostgreSQL + Prisma 7 (`pg` driver adapter, migrations) |
| Validation | Zod 4 |
| Auth | jsonwebtoken, bcrypt, google-auth-library |
| Cache | Upstash Redis (REST) |
| Payments | SSLCommerz v4 API (sandbox / live) |
| Docs | OpenAPI 3 + Swagger UI, Postman |
| Build / quality | tsup, ESLint (type-aware), Vitest + Supertest |
| Deployment | Vercel |

Architecture: modular monolith – `Routes → Middlewares → Controllers → Services → Prisma → PostgreSQL`.

## Getting started

Prerequisites: Node.js ≥ 24.11, Bun ≥ 1.2, and PostgreSQL. A Docker Compose file is included.

```bash
bun install                     # also generates the Prisma client
cp .env.example .env            # fill in the values (see below)
docker compose up -d            # optional: local PostgreSQL on :5433 (+ teamflow_test DB)
bun run db:migrate              # apply migrations (production: bun run db:deploy)
bun run db:seed                 # SUPER_ADMIN + FREE/PRO plans
bun run dev                     # http://localhost:5000  ·  docs: http://localhost:5000/api-docs
```

### Environment variables

Every variable is validated at startup (`src/config/env.ts`). If anything is missing or invalid, the app refuses to start and lists which variables are wrong, without printing their values. See [.env.example](.env.example).

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ✅ | Two **different** secrets, 32+ characters each |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | – | Default `15m` / `7d` |
| `FRONTEND_URL`, `BACKEND_URL` | – | CORS origin, payment redirect URLs and gateway callback URLs |
| `GOOGLE_CLIENT_ID` | for Google login | GCP OAuth client ID. Without it, `/auth/google` returns 503. |
| `SSL_STORE_ID`, `SSL_STORE_PASSWORD`, `SSL_IS_LIVE` | for payments | Without them, `/payments/initiate` returns 503 |
| `REDIS_URL`, `REDIS_TOKEN` | – | Upstash REST URL + token. Without them, caching is skipped. |
| `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD` | for the seed | The SUPER_ADMIN account |

## Scripts

| Script | Purpose |
| --- | --- |
| `bun run dev` | Dev server with reload (tsx) |
| `bun run build` | Generate the Prisma client and bundle to `dist/` (tsup) |
| `bun run start` | Run the production build |
| `bun run lint` / `typecheck` / `test` | ESLint / `tsc --noEmit` / Vitest |
| `bun run db:generate` / `db:migrate` / `db:deploy` / `db:seed` | Prisma client, dev migrations, production migrations, seed |

### Tests

`bun run test` runs the Vitest suite. Use that command, not plain `bun test`, which starts Bun's own runner instead.

- The suite has unit tests and HTTP tests run through Supertest, and it uses a **real PostgreSQL database**.
- That database is a separate `teamflow_test`, which `docker compose up -d` creates and Vitest migrates automatically.
- The tests empty its tables, so they refuse to run against any database whose name doesn't end in `_test`. Override it with `TEST_DATABASE_URL`.
- Only the outbound HTTP calls to Google and SSLCommerz are mocked.

## Demo admin account

- `bun run db:seed` creates a SUPER_ADMIN from `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD`, hashed with bcrypt.
- Re-running the seed never duplicates the admin and never promotes an existing non-admin account.
- Public registration can never create a SUPER_ADMIN.
- Evaluators should log in with `POST /api/v1/auth/login` using the demo credentials given in the submission, then use the `/admin/*` endpoints.

## Sandbox payment walkthrough

1. Set SSLCommerz sandbox credentials. SSLCommerz's public demo store works: `SSL_STORE_ID=testbox`, `SSL_STORE_PASSWORD=qwerty`, `SSL_IS_LIVE=false`.
2. Set `BACKEND_URL` to the API's public URL. For a local run, `http://localhost:5000` works for the browser redirect, but IPN needs a public URL.
3. As an owner with an organization, get the PRO plan id from `GET /plans`, then call `POST /payments/initiate { "planId": "…" }`.
4. Open the returned `gatewayUrl` in a browser and pay with an **SSLCommerz sandbox test card**, using the test details shown on the sandbox page or in the SSLCommerz developer docs.
5. SSLCommerz posts back to `/payments/validate` and `/payments/ipn`. The server re-validates the payment with SSLCommerz, then activates PRO.
6. Check it: `GET /subscriptions/current` shows `PRO`, and `GET /payments/history` shows `SUCCESS`.

## Deployment

The project deploys to Vercel as a serverless function. Fill in after deploying:

- **Live API:** *(pending)*
- **API docs:** *(pending)*/api-docs

## Project structure

```text
prisma/schema/    schema.prisma (generator + datasource), <service>.prisma models, enums/
prisma/           migrations/, seed.ts
src/config/       env validation, Prisma client, Google, SSLCommerz, Redis
src/middlewares/  authenticate, authorize, organization scope, validate, rate limits, errors, 404
src/modules/      auth, organizations, projects, tasks, subscriptions, payments, admin, docs, health
src/utils/        response, errors, pagination, password, JWT, cookies, audit log, cache, validation
src/routes/       mounts module routers under /api/v1
docs/             OpenAPI (Swagger) spec, API guide, Postman collection + environment
tests/            Vitest + Supertest (helpers/, setup/)
```
