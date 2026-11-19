# TeamFlow Backend – Development Progress

Source of truth: `../REQUIREMENTS.md`. One phase at a time; each phase ends with typecheck, lint, tests and an update to this file.

## Roadmap

| # | Phase | Scope | Status |
| --- | --- | --- | --- |
| 1 | Project initialization & database | Bun/TS/Express setup, Prisma schema (10 models) + migration, seed, env validation, error handling, response/pagination/JWT/password utils, health check | ✅ Done (2026-11-19) |
| 2 | Authentication & authorization | register, login, refresh-token rotation, logout, me, Google ID-token login; `authenticate` + `authorize` middlewares; auth rate limit; DB-backed integration tests | ✅ Done (2026-11-19) |
| 3 | Organizations & members | create/current/update org; add (by existing email), list, update, remove members; organization-scope middleware; suspended-org handling; member plan limits | ⏳ Next – awaiting approval |
| 4 | Projects + audit log | CRUD, pagination, search, status filter, soft delete, progress %, project plan limits; reusable audit-log service | Planned |
| 5 | Tasks | CRUD, assign, status workflow, member-permitted fields, filters, pagination, due-date + assignee validation, task limits, audit entries | Planned |
| 6 | Subscriptions & SSLCommerz | plans, current subscription, effective-plan resolution (expiry), initiate / validate / IPN / history, gateway validation, idempotent processing | Planned |
| 7 | Super admin + Redis | dashboard stats, organizations, payments, audit logs, org status; Upstash caching with expiry + invalidation | Planned |
| 8 | API documentation | Swagger UI at `/api-docs` (OpenAPI YAML), Postman collection + environment, `docs/API.md` | Planned |
| 9 | Deployment & final QA | Vercel serverless entry + `vercel.json`, production DB migrations, live verification, README + submission details | Planned |

## Missing configuration

| What | Needed for | Status |
| --- | --- | --- |
| Google OAuth Client ID (GCP) | `POST /auth/google` | ❌ Not provided. The endpoint is implemented and returns **503 "Google login is not configured"** until `GOOGLE_CLIENT_ID` is set. It is never faked. |
| SSLCommerz sandbox Store ID / password | Phase 6 – payments | ❌ Not provided |
| Upstash Redis REST URL / token | Phase 7 – caching | ❌ Not provided (caching will be skipped when unset) |
| Production PostgreSQL | Phase 9 | ✅ Prisma Postgres (`db.prisma.io`) connected 2026-11-19 via `.env` `DATABASE_URL` (`sslmode=verify-full`): `init` migration applied with `migrate deploy`, seed run (SUPER_ADMIN + FREE/PRO), `/health` → database connected, admin login + `/auth/me` verified. Still to do: set the same `DATABASE_URL` on Vercel in Phase 9. Tests keep using the local `teamflow_test` DB. |
| GitHub remote + Vercel project | Push / deployment | ❌ No remote configured (local commits only) |

## Open questions

- `PATCH /organizations/current/members/:memberId`: membership has no editable fields in §6.3. Proposal: let the owner activate or deactivate the member's access. Confirm in Phase 3.

---

## Phase 2 – Authentication & authorization ✅

### Delivered – Phase 2

- **Endpoints** (`src/modules/auth/`):
  - `POST /auth/register`: always creates a TEAM_OWNER, with the password hashed by bcrypt (cost 12).
  - `POST /auth/login`
  - `POST /auth/google`
  - `POST /auth/refresh-token`
  - `POST /auth/logout`
  - `GET /auth/me`: returns the user plus their organization, or `null`.
- **Middlewares:**
  - `authenticate` accepts a Bearer header or the `accessToken` cookie and re-loads the user from the database on every request, so deactivation and role changes apply immediately.
  - `authorize(...roles)` is the centralized role check: 401 when unauthenticated, 403 for the wrong role.
  - `authRateLimiter` allows 20 requests per 15 minutes on register, login and Google; the general `/api` limiter moved to `rate-limit.middleware.ts`.
- **Tokens:**
  - Access token: 15 minutes. Refresh token: 7 days; it is a JWT whose `jti` is the database row id, and only its SHA-256 hash is stored.
  - Both are set as HTTP-only cookies. In production they are `Secure` and `SameSite=None`; locally they are `Lax`. The refresh cookie is limited to `/api/v1/auth`.
  - Both are also returned in the response body, for Postman and other API clients.
- **Refresh rotation:**
  - Each refresh revokes the old token and issues a new one inside a transaction. A conditional update makes parallel refreshes with the same token safe.
  - Presenting a revoked token is treated as theft and revokes every session of that user.
- **Login hardening:**
  - Wrong passwords, unknown emails and Google-only accounts all get the same "Invalid email or password" message.
  - An unknown email still runs a bcrypt comparison, so response time doesn't reveal which emails exist.
  - "Deactivated" (403) is only revealed after the correct password is given.
- **Google login** (ID-token flow, official `google-auth-library`):
  - The library checks the token's signature, expiry and audience; issuer and audience are also checked explicitly. Google must report the email as verified.
  - Only the `idToken` is accepted from the client; any other field gets a 422.
  - Linking rules:
    - known Google ID → sign in
    - new email → create a TEAM_OWNER without a password
    - existing email → link the Google account; if that email was never verified, remove its password and revoke its sessions (blocks account pre-hijacking)
    - an email already linked to a different Google account → 409
    - SUPER_ADMIN accounts cannot use Google login
  - Without `GOOGLE_CLIENT_ID` the endpoint returns 503.
- **Security fix:** the global `express.urlencoded` parser is removed. With `SameSite=None` cookies, a cross-site HTML form could otherwise post to the API. Only the payment callbacks (Phase 6) will accept form data.
- **Logging:** expected `AppError` 5xx responses are logged as one line; unexpected errors keep the full stack, server-side only.
- **Test setup:**
  - Tests use the dedicated `teamflow_test` database, migrated automatically by Vitest's global setup.
  - A guard refuses to run if the database name doesn't end in `_test`.
  - Tables are truncated before each test, and test files run one at a time.
  - Factories create users, and `bearerFor(user)` builds an auth header.

### Verification (2026-11-19) – Phase 2

- `bun run typecheck` ✅ · `bun run lint` ✅ · `bun run build` ✅ · `bun run test` ✅ **69/69**. The 35 new tests run against real PostgreSQL:
  - **Registration:** success, duplicate email (case-insensitive) → 409, `role: SUPER_ADMIN` in the body → 422 with no user created, field validation → 422.
  - **Login:** success with HTTP-only cookies and only the token hash stored; wrong password and unknown email give the same 401; Google-only account → 401; deactivated account → 403.
  - **Me:** works with a Bearer token and with the cookie; 401 without a token or with an invalid one; deleted user → 401; deactivated user → 403.
  - **Refresh:** rotation through the cookie and through the body; reuse of a revoked token revokes every session; missing, garbage or access token → 401; expired database record → 401; deactivated user → 403.
  - **Logout:** revokes the token and clears both cookies; calling it with no token still succeeds.
  - **Google** (verifier mocked):
    - creating a user, a returning user, and an email already linked to a different Google account (409)
    - linking an unverified account (password removed, old sessions revoked) and a verified account (password kept)
    - SUPER_ADMIN and deactivated accounts refused
    - a forged token → 401; extra client profile data → 422
    - an unmocked test confirms the 503 when `GOOGLE_CLIENT_ID` is not set
  - **Authorization:** 401 when unauthenticated; TEAM_OWNER calling an admin endpoint → 403; TEAM_MEMBER calling an owner endpoint → 403; a token claiming SUPER_ADMIN for a member account → 403 (the role comes from the database).
- Smoke test of the built server (`NODE_ENV=production`) against the dev database:
  - register → 201; duplicate → 409; extra `role` → 422
  - login → 200; cookies carry `HttpOnly; Secure; SameSite=None`, with the refresh cookie on `Path=/api/v1/auth`
  - `me` → 200 with a Bearer token or the cookie; 401 without a token
  - refresh → 200; reusing the old token → 401, after which the rotated token also → 401
  - logout → 200 and clears the cookies; refresh afterwards → 401
  - wrong password → 401; Google → 503 (not configured); seeded SUPER_ADMIN login → 200

### Technical decisions – Phase 2

- **No Passport.** The ID-token flow needs only Google's official library, so `src/config/google.ts` replaces the `config/passport.ts` slot in §18, and `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` are unused.
- **Tokens in cookies and in the body.** Browsers use the HTTP-only cookies. The Postman collection required by §22 needs `accessToken` / `refreshToken` variables, so the tokens are also returned in the body.
- **Register returns the user only.** The client then calls `/login`, which keeps one place where tokens are issued.
- **Strict request bodies for auth.** Unknown keys get a 422, which makes the rule "never accept SUPER_ADMIN from request data" explicit.
- **No `users` module yet.** The spec has no user endpoints before the admin APIs (Phase 7).
- **Rate-limit store is in memory.** That is fine for one server; on serverless it applies per warm instance.

---

## Phase 1 – Project initialization & database setup ✅

### Delivered – Phase 1

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
  - Helmet, a CORS allow-list (FRONTEND_URL with credentials), a JSON body limit, cookie-parser, and an `/api` rate limit.
  - `trust proxy` set in production.
  - `GET /` and `GET /api/v1/health`, which returns 503 when the database is down.
  - Graceful shutdown on SIGINT/SIGTERM.

### Verification (2026-11-19) – Phase 1

- `bun run typecheck` ✅ · `bun run lint` ✅ · `bun run test` ✅ **34/34** · `bun run build` ✅
- `prisma migrate dev` created the migration and applied it to a real PostgreSQL 17. `prisma migrate deploy` applied it cleanly to `teamflow_test`.
- `prisma migrate diff`: the multi-file schema has **no difference** from the migrated database (re-checked after the move to `prisma/schema/`).
- Seed was run twice: the first run created the admin and both plans, the second skipped all three. The stored password is a `$2b$` bcrypt hash.
- Built bundle (`node dist/server.js`, `NODE_ENV=production`) against the real DB:
  - `/api/v1/health` → 200 with the database connected.
  - An unknown route → structured 404.
  - Malformed JSON → structured 400.
  - HSTS and nosniff headers are present, and `X-Powered-By` is absent.

### Technical decisions – Phase 1

- **Prisma 7.10.1, pinned exactly.** npm's `latest` tag currently points at `8.0.0-rc`. Prisma 7's driver adapter has no native query engine, which suits Vercel serverless.
- **TypeScript 6.0.x, not 7.** typescript-eslint supports TypeScript below 6.1.
- **ESM end to end** (`"type": "module"`, `NodeNext`, `.js` import suffixes). The same source runs under tsx (dev), Vitest, the tsup bundle and Vercel without loader tricks.
- **Multi-file Prisma schema.** `prisma.config.ts` sets `schema: "prisma/schema"`. Files are organized by service:
  - `schema.prisma`: generator and datasource
  - `<service>.prisma`: auth, user, organization, project, task, subscription, payment, audit-log
  - `enums/<service>.enum.prisma`
- **UUIDv7 primary keys** (`@db.Uuid`): time-ordered, so index inserts stay compact, and route IDs can be validated with `z.uuid()`.
- **Express 5** forwards async errors to the error middleware natively, so no `catchAsync` wrapper is needed.
- **Tests never read `.env`.** `vitest.config.ts` supplies non-secret values, and `TEST_DATABASE_URL` overrides the test database.

### Schema additions and clarifications (vs. REQUIREMENTS §6) – Phase 1

| Item | Why |
| --- | --- |
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
