# TeamFlow Backend – Development Progress

Source of truth: `../REQUIREMENTS.md`. One phase at a time; each phase ends with typecheck, lint, tests and an update to this file.

## Roadmap

| # | Phase | Scope | Status |
|---|---|---|---|
| 1 | Project initialization & database | Bun/TS/Express setup, Prisma schema (10 models) + migration, seed, env validation, error handling, response/pagination/JWT/password utils, health check | ✅ Done (2026-11-19) |
| 2 | Authentication & authorization | register, login, refresh-token rotation, logout, me, Google ID-token login; `auth` + `role` middlewares; auth rate limit; DB-backed integration tests | ⏳ Next – awaiting approval |
| 3 | Organizations & members | create/current/update org; add (by existing email), list, update, remove members; organization-scope middleware; suspended-org handling; member plan limits | Planned |
| 4 | Projects + audit log | CRUD, pagination, search, status filter, soft delete, progress %, project plan limits; reusable audit-log service | Planned |
| 5 | Tasks | CRUD, assign, status workflow, member-permitted fields, filters, pagination, due-date + assignee validation, task limits, audit entries | Planned |
| 6 | Subscriptions & SSLCommerz | plans, current subscription, effective-plan resolution (expiry), initiate / validate / IPN / history, gateway validation, idempotent processing | Planned |
| 7 | Super admin + Redis | dashboard stats, organizations, payments, audit logs, org status; Upstash caching with expiry + invalidation | Planned |
| 8 | API documentation | Swagger UI at `/api-docs` (OpenAPI YAML), Postman collection + environment, `docs/API.md` | Planned |
| 9 | Deployment & final QA | Vercel serverless entry + `vercel.json`, production DB migrations, live verification, README + submission details | Planned |

## Phase 1 – Project initialization & database setup ✅

### Delivered
- **Tooling:** Bun 1.4.5, TypeScript 6.0.3 (strict, ESM, `NodeNext`), Express 5, tsup 9 build, ESLint 10 (type-aware typescript-eslint), Vitest 5 + Supertest. Scripts: `dev, build, start, lint, typecheck, test, db:generate, db:migrate, db:deploy, db:seed, db:studio`.
- **Database:** Prisma 7.10.1 with the `pg` driver adapter. A multi-file schema with all 10 required models, 8 enums, 30 indexes (9 unique) and 15 foreign keys. Initial migration `20261119172414_init`.
- **Seed:** idempotent SUPER_ADMIN (env-driven, bcrypt) plus FREE and PRO plans.
- **Config:** Zod-validated environment (`src/config/env.ts`) that fails fast and lists variable names only, never values; `.env.example`; optional `docker-compose.yml` (PostgreSQL 17 on port 5433 with a `teamflow_test` DB).
- **Common code:**
  - `AppError` and the centralized error middleware, which maps Zod, Prisma (P2002/P2025/P2003/P2000/P2023), JWT and body-parser errors, and never leaks internals or stacks outside development.
  - Reusable `validate({ params, query, body })` middleware. It returns 422 with every issue and replaces the request data with the parsed output, so unknown keys are stripped.
  - A 404 handler.
  - The standard response envelope, pagination helpers, a password policy with bcrypt (cost 12), and JWT helpers (access/refresh, issuer/audience/type checks, SHA-256 token hashing).
- **App shell:**
  - Helmet, a CORS allow-list (FRONTEND_URL with credentials), JSON and form body limits, cookie-parser, and an `/api` rate limit.
  - `trust proxy` set in production.
  - `GET /` and `GET /api/v1/health`, which returns 503 when the database is down.
  - Graceful shutdown on SIGINT/SIGTERM.

### Verification (2026-11-19)
- `bun run typecheck` ✅ · `bun run lint` ✅ · `bun run test` ✅ **34/34** · `bun run build` ✅
- `prisma migrate dev` created the migration and applied it to a real PostgreSQL 17. `prisma migrate deploy` applied it cleanly to `teamflow_test`.
- `prisma migrate diff`: the split schema has **no difference** from the migrated database. `migrate status` reports it as up to date.
- Seed was run twice: the first run created the admin and both plans, the second skipped all three. The stored password is a `$2b$` bcrypt hash.
- Built bundle (`node dist/server.js`, `NODE_ENV=production`) against the real DB:
  - `/api/v1/health` → 200 with the database connected.
  - An unknown route → structured 404.
  - Malformed JSON → structured 400.
  - HSTS and nosniff headers are present, and `X-Powered-By` is absent.

### Technical decisions
- **Prisma 7.10.1, pinned exactly.** npm's `latest` tag currently points at `8.0.0-rc`. Prisma 7's driver adapter has no native query engine, which suits Vercel serverless.
- **TypeScript 6.0.x, not 7.** typescript-eslint supports TypeScript below 6.1.
- **ESM end to end** (`"type": "module"`, `NodeNext`, `.js` import suffixes). The same source runs under tsx (dev), Vitest, the tsup bundle and Vercel without loader tricks.
- **Multi-file Prisma schema.** `prisma.config.ts` sets `schema: "prisma"` and the files are:
  - `schema.prisma`: generator and datasource
  - `enums.prisma`
  - `models/<domain>.prisma`
- **UUIDv7 primary keys** (`@db.Uuid`): time-ordered, so index inserts stay compact, and route IDs can be validated with `z.uuid()`.
- **Refresh tokens are JWTs whose `jti` is the `RefreshToken.id`.** Only the SHA-256 hash is stored. SHA-256 is enough here because tokens are high-entropy, and it allows direct lookup by hash.
- **Express 5** forwards async errors to the error middleware natively, so no `catchAsync` wrapper is needed.
- **Tests never read `.env`.** `vitest.config.ts` supplies non-secret values, and `TEST_DATABASE_URL` overrides the database for DB-backed tests.

### Schema additions and clarifications (vs. REQUIREMENTS §6)
| Item | Why |
|---|---|
| `User.googleId` (unique) | Safe Google account linking by the stable `sub` claim rather than by email alone (§7). |
| `Organization.ownerId` unique | Enforces "a user can own one organization" (§8) at the database level. |
| `OrganizationMember.userId` unique | One organization per user, which is what `/organizations/current` resolves to. The required `(organizationId, userId)` unique is kept too. |
| `SubscriptionPlan.currency` | Plan price needs a currency for the payment amount/currency checks (§12). |
| Nullable `durationDays` / `maxProjects` / `maxTasksPerProject` | `null` means "never expires" or "unlimited" (FREE never expires; PRO has unlimited projects). |
| Nullable `Subscription.startDate/endDate` | PENDING subscriptions have no dates until a verified payment activates them. |
| `Payment.paymentGateway` enum (`SSLCOMMERZ`) | Type-safe instead of free text. |
| Nullable `AuditLog.userId` | System actions (gateway IPN) have no acting user. |
| `REDIS_TOKEN` env var | Upstash's REST client needs a URL **and** a token; `REDIS_URL` alone is insufficient. |
| `health` module, `src/routes/index.ts`, `docker-compose.yml` | Health endpoint (§25), route aggregator, and a reproducible local DB. |

### Missing configuration (needed in later phases)
| What | Needed for | Status |
|---|---|---|
| Google OAuth Client ID (GCP) | Phase 2 – `POST /auth/google` | ❌ Not provided. The endpoint will return a clear "not configured" error until it is set; it will never be faked. |
| SSLCommerz sandbox Store ID / password | Phase 6 – payments | ❌ Not provided |
| Upstash Redis REST URL / token | Phase 7 – caching | ❌ Not provided (caching will be skipped when unset) |
| Production PostgreSQL (e.g. Neon) | Phase 9 | ❌ Not provided |
| GitHub remote + Vercel project | Commits / deployment | ❌ No remote configured (local commits only) |

### Open questions for later phases
- `PATCH /organizations/current/members/:memberId`: membership has no editable fields in §6.3. Proposal: let the owner activate or deactivate the member's access. Confirm in Phase 3.
