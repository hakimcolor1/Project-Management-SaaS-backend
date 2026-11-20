# TeamFlow Backend – Development Progress

Source of truth: `../REQUIREMENTS.md`. One phase at a time; each phase ends with typecheck, lint, tests and an update to this file.

## Roadmap

| # | Phase | Scope | Status |
| --- | --- | --- | --- |
| 1 | Project initialization & database | Bun/TS/Express setup, Prisma schema (10 models) + migration, seed, env validation, error handling, response/pagination/JWT/password utils, health check | ✅ Done (2026-11-19) |
| 2 | Authentication & authorization | register, login, refresh-token rotation, logout, me, Google ID-token login; `authenticate` + `authorize` middlewares; auth rate limit; DB-backed integration tests | ✅ Done (2026-11-19) |
| 3 | Organizations & members (+ audit log helper, plan limits) | create/current/update org; add (by existing email), list, update, remove members; organization-scope middleware; suspended-org handling; member plan limits | ✅ Done (2026-11-20) |
| 4 | Projects | CRUD, pagination, search, status filter, soft delete, progress %, project plan limits, audit entries | ✅ Done (2026-11-20) |
| 5 | Tasks | CRUD, assign, status workflow, member-permitted fields, filters, pagination, due-date + assignee validation, task limits, audit entries | ✅ Done (2026-11-20) |
| 6 | Subscriptions & SSLCommerz | plans, current subscription, effective-plan resolution (expiry), initiate / validate / IPN / history, gateway validation, idempotent processing | ✅ Done (2026-11-20) |
| 7 | Super admin + Redis | dashboard stats, organizations, payments, audit logs, org status; Upstash caching with expiry + invalidation | ✅ Done (2026-11-20) |
| 8 | API documentation | Swagger UI at `/api-docs` (OpenAPI YAML), Postman collection + environment, `docs/API.md` | ✅ Done (2026-11-20) |
| 9 | Deployment & final QA | Vercel serverless entry + `vercel.json`, production DB migrations, live verification, README + submission details | ✅ Done (2026-11-20) |

## Missing configuration

| What | Needed for | Status |
| --- | --- | --- |
| Google OAuth Client ID (GCP) | `POST /auth/google` | ❌ Not provided. The endpoint is implemented and returns **503 "Google login is not configured"** until `GOOGLE_CLIENT_ID` is set. It is never faked. |
| SSLCommerz sandbox Store ID / password | Payments | ⚠️ No own store yet. SSLCommerz's **public sandbox demo store** (`SSL_STORE_ID=testbox`, `SSL_STORE_PASSWORD=qwerty`, `SSL_IS_LIVE=false`) works. It is set on Vercel and was used for the live checks. Swap in your own sandbox store on Vercel if you have one. Without credentials, `/payments/initiate` returns 503. |
| Upstash Redis REST URL / token | Phase 7 – caching | ❌ Not provided (caching is skipped when unset). Add `REDIS_URL` + `REDIS_TOKEN` on Vercel and redeploy to turn it on. |
| Production PostgreSQL | Phase 9 | ✅ Prisma Postgres (`db.prisma.io`). Migrated and seeded on 2026-11-19. Set as `DATABASE_URL` on Vercel on 2026-11-20. Every Vercel build runs `prisma migrate deploy`. Tests keep using the local `teamflow_test` DB. |
| GitHub remote + Vercel project | Push / deployment | ✅ `origin` = github.com/hakimcolor1/Project-Management-SaaS-backend. Vercel project `teamflow-backend` (team `hakimcolor2`) is linked to the repo, so a push to `main` deploys. |

## Open questions

- `PATCH /organizations/current/members/:memberId`: membership has no editable fields in §6.3. Decision: the owner activates or deactivates the member's access (`{ "isActive": false }`). No answer was given, so this was implemented as proposed. Easy to change if a different meaning is wanted.

---

## Phase 9 – Deployment & final QA ✅

**Live API:** https://teamflow-backend-two.vercel.app · **Docs:** https://teamflow-backend-two.vercel.app/api-docs

### Delivered – Phase 9

- **Duplicate backend removed.** `../teamflow-backend-readability` was a leftover git worktree of this repo, on branch `refactor/readability`. That branch was fully merged into `main` and had no uncommitted changes. The worktree was removed with `git worktree remove` and the merged branch was deleted. Only `teamflow-backend/` remains.
- **Serverless entry** `api/index.js`:
  - re-exports the compiled Express app (`dist/app.js`) and never calls `listen()`
  - defaults `NODE_ENV` to `production` before the app's config loads
- **`vercel.json`:**
  - Bun install, and the build command `bun run build:vercel` (`prisma generate` → `prisma migrate deploy` → `tsup`)
  - region `sin1`, with every path rewritten to the function
  - `includeFiles` for `dist/**/*.js` and the OpenAPI YAML
- **`.vercelignore`** keeps `.env`, `node_modules`, `dist` and the generated Prisma client out of uploads. `public/robots.txt` is served as the static output and tells crawlers to stay away.
- `engines.node` is pinned to `24.x`, which removes Vercel's auto-upgrade warning.
- **Vercel project `teamflow-backend`**, Production environment variables:
  - `DATABASE_URL`
  - fresh production JWT secrets, generated for the deployment and different from the local `.env` ones
  - JWT expiries, `BACKEND_URL`, `FRONTEND_URL`
  - SSLCommerz sandbox credentials
  - `GOOGLE_CLIENT_ID` and Redis are not set (see Missing configuration).

### Verification – Phase 9 (2026-11-20)

- Local: `bun run typecheck` ✅ · `bun run lint` ✅ · `bun run build` ✅ · `bun run test` ✅ **158/158**. The handler was also smoke-tested locally through `api/index.js` (root, health, Swagger, OpenAPI, 404).
- Vercel build log: `prisma migrate deploy` reported "No pending migrations to apply". The function `api/index` is 3.3 MB.
- **Newman run of the full Postman collection against production:** **53/53 requests and 53/53 assertions passed**, average 285 ms. It covers auth, organizations, members, projects, tasks with the member workflow, plans, a real SSLCommerz sandbox payment session, admin (with the seeded SUPER_ADMIN) and cleanup.
- Live spot checks:
  - `/api/v1/health` → database `connected`, environment `production`
  - auth cookies are `HttpOnly; Secure; SameSite=None`
  - Zod validation errors → 400
  - unauthenticated → 401, unknown route → 404 JSON
  - `/auth/google` → "not configured" (honest 503)
  - HSTS, `nosniff` and `RateLimit` headers are present
  - `/.env` and `/dist/app.js` are not served (404)
- **Not verified in a browser:** finishing a payment on the SSLCommerz sandbox checkout page. The Chrome extension was not connected. Initiation against production works and returns a real `sandbox.sslcommerz.com` checkout URL. See "Sandbox payment walkthrough" in README.md.

---

## Phase 8 – API documentation ✅

### Delivered – Phase 8

- **OpenAPI 3.0** (`docs/api-documentation.yaml`):
  - All 39 operations, with request schemas, response schemas and examples.
  - Bearer and cookie authentication.
  - Shared error responses for 400/401/403/404/409/422/429/503.
  - Role notes per endpoint.
  - Validated with Redocly CLI: **valid** (remaining warnings are optional `operationId`s).
- **Swagger UI at `/api-docs`:**
  - Pinned `swagger-ui-dist@5.34.1` from jsDelivr with **Subresource Integrity** hashes. The spec is served at `/api-docs/openapi.yaml`.
  - It has its own strict CSP: no inline scripts.
  - `swagger-ui-express` was avoided because its static files are unreliable on serverless.
- **Postman** (`docs/TeamFlow.postman_collection.json` + `TeamFlow.postman_environment.json`):
  - 53 requests in 9 folders, using the required variables `baseUrl`, `accessToken`, `refreshToken`, `organizationId`, `projectId` and `taskId`, plus helpers.
  - Test scripts save tokens and ids automatically.
  - Member and admin logins exercise role checks, with 403 checks included.
- **`docs/API.md`:** authentication, role/permission matrix, plan limits, conventions, every endpoint, request/response examples, payment flow, error codes, Postman usage.
- **README** rewritten: features, setup, environment table, tests, demo admin, sandbox payment walkthrough, structure.

### Verification – Phase 8

- `bun run test` ✅ **158/158**. 3 new docs tests check that:
  - Swagger UI is served with CSP and SRI
  - the documented operations **equal** the implemented list (two-way check)
  - **every documented endpoint is a real route**
- **Newman run of the Postman collection** against the built server (production mode, local DB, real SSLCommerz sandbox): **53/53 requests, 53/53 assertions passed**. It covers auth, organizations, members, projects, tasks with the member workflow, plans, payment initiation, admin and cleanup.
- Two collection bugs were found and fixed through these runs:
  - Postman reserves the global name `data`, so the token scripts failed. Renamed.
  - Repeated runs hit the auth rate limit (expected behaviour). This is now documented.

---

## Phase 7 – Super admin APIs & Redis caching ✅

### Delivered – Phase 7

- **Admin endpoints** (`src/modules/admin/`). All are protected by `authenticate` + `authorize("SUPER_ADMIN")` at router level.
  - `GET /admin/dashboard`: from database aggregations, never hard-coded.
    - users: total, active/inactive, by role, new in the last 30 days
    - organizations: by status, new in the last 30 days
    - project and task totals (including completed tasks); active paid subscriptions
    - payments by status; total revenue and revenue in the last 30 days
  - `GET /admin/organizations`: pagination, `search` on name/slug, `status` filter. Each row has the owner, member/project counts and the current plan; the plan for a whole page comes from one query.
  - `PATCH /admin/organizations/:id/status`: `{ status, reason? }` to suspend or reactivate, audited. Suspension immediately blocks the organization's tenant routes (403).
  - Two endpoints beyond the §13 list, added to cover the §5.1 permissions:
    - `GET /admin/users` (view all users)
    - `PATCH /admin/plans/:planId` (manage subscription plans). FREE must stay free and active; paid plans need a price > 0.
  - `GET /admin/payments`: all payments, with `status` and `organizationId` filters.
  - `GET /admin/audit-logs`: filters `action` (case-insensitive), `entity`, `organizationId`, `userId`.
- **Redis** (`src/config/redis.ts`, `src/utils/cache.ts`): Upstash REST client, optional. Cache-aside, and any Redis error falls back to PostgreSQL.
  - `GET /plans` is cached for 10 minutes and **invalidated** whenever an admin updates a plan.
  - The admin dashboard is cached for 60 seconds and invalidated when an organization's status changes.
  - **Never cached:** subscriptions, payments and plan-limit checks. Redis is never the source of truth for them.

### Verification – Phase 7

`bun run typecheck` ✅ · `bun run lint` ✅ · `bun run test` ✅ **155/155**. The 15 new tests cover:

- **Access control:** 401 without a token; 403 for TEAM_OWNER and TEAM_MEMBER on every admin endpoint.
- **Dashboard:** statistics match the seeded data (revenue `2000.50`).
- **Organizations:** list with plan, search and status filter.
- **Suspend/reactivate:** the tenant API is blocked, then allowed again; the audit trail records who did it and why; same status → 400; unknown id → 404; bad input → 422.
- **Users, payments, audit logs:** filters work, and no passwords are exposed.
- **Plans:** an update shows up in `GET /plans`; the FREE and paid-price rules hold.
- **Cache** (in-memory fake Redis):
  - a hit is served from the cache with a 600 s TTL
  - an admin plan update invalidates it
  - **Redis down → the database is used**
  - subscriptions and payments **never** touch Redis
  - the dashboard is cached with a 60 s TTL

---

## Phase 6 – Subscriptions & SSLCommerz payments ✅

### Delivered – Phase 6

- **Endpoints:**
  - `GET /plans` (public, active plans)
  - `GET /subscriptions/current` (owner): effective plan, current subscription, usage (members, active projects), and periods already bought in advance.
  - `POST /payments/initiate` (owner)
  - `POST /payments/validate`: SSLCommerz success/fail/cancel URL. A browser form post is redirected (303) to `FRONTEND_URL/payment/result?status=…`; a JSON call gets the standard envelope.
  - `POST /payments/ipn`: SSLCommerz IPN.
  - `GET /payments/history` (owner; pagination, `status` filter).
- **Payment flow** (§12):
  1. The owner picks a paid, active plan. FREE → 400; unknown or inactive → 404.
  2. A PENDING subscription and a PENDING payment are created in one transaction. The transaction id is random and up to 30 characters.
  3. An SSLCommerz session is opened outside the transaction and `gatewayUrl` is returned. If the gateway refuses, the payment becomes FAILED and the subscription CANCELLED (502).
  4. On a callback or IPN, the **SSLCommerz validation API** is called with the `val_id`. Status (VALID/VALIDATED), transaction id, currency and amount must all match our record.
  5. Only then, in one transaction: payment → SUCCESS (with the sanitized gateway response) and subscription → ACTIVE, for 30 days. If a PRO period is already running, the new one starts when it ends.
- **Security:**
  - A callback without `val_id` never activates anything.
  - IPN: the `verify_sign` / `verify_key` md5 signature is checked as SSLCommerz specifies, using a timing-safe comparison.
  - **Idempotency:** `updateMany … WHERE status <> 'SUCCESS'` lets exactly one callback activate. Repeated callbacks, IPN plus redirect, and parallel calls return `alreadyProcessed: true`.
  - A forged FAILED/CANCELLED callback only closes a PENDING payment; a later gateway-verified success still activates it.
  - Gateway secrets stay server-side; card numbers are never stored.
  - Form-encoded bodies are accepted only on the two callback routes.
- **Expiry:** limits always use the effective plan (ACTIVE, started, not ended). `GET /subscriptions/current` also marks ended subscriptions EXPIRED. The plan is never read from client data.
- **Client:** `src/config/sslcommerz.ts` calls the official v4 endpoints that the official `sslcommerz-lts` package also uses, with native fetch, timeouts and typed responses. That package wasn't used because it returns network failures as if they were responses, always sends POST, and doesn't URL-encode parameters.

### Verification – Phase 6

- `bun run typecheck` ✅ · `bun run lint` ✅ · `bun run test` ✅ **140/140**. The 17 new tests cover:
  - plans and the current subscription; expiry falls back to FREE
  - initiate: success; FREE, inactive, unknown, member and bad input rejected; the gateway refusing
  - successful verification, after which **PRO member limits apply**
  - duplicate callbacks, sequential and **concurrent**: exactly one activation
  - amount mismatch and INVALID_TRANSACTION → FAILED
  - a success redirect without `val_id` → not activated
  - failed and cancelled callbacks; unknown transaction → 404
  - the browser redirect to the frontend
  - extending a running period
  - a signed IPN activates; tampered or unsigned IPN → 400
  - payment history isolation; member → 403
  - In these tests only the two outbound SSLCommerz HTTP calls are mocked.
- **Live sandbox check** (built server, local DB, demo store `testbox`):
  - `POST /payments/initiate` reached the **real** SSLCommerz sandbox and returned a real `sandbox.sslcommerz.com/EasyCheckOut/…` URL.
  - A forged success callback with a fake `val_id` made our server ask the **real validation API**, which answered `INVALID_TRANSACTION`, so the payment → FAILED and the subscription → CANCELLED.
  - A bare success redirect and a forged IPN were rejected.
- **Not yet done:** completing a payment in the sandbox checkout page needs a browser, and the Chrome extension was not connected. See "Sandbox payment walkthrough" in README.md to do it in about 2 minutes.

---

## Phase 5 – Tasks ✅

### Delivered – Phase 5

- **Endpoints** (`src/modules/tasks/`):
  - `POST /projects/:projectId/tasks` (owner; can assign at creation)
  - `GET /projects/:projectId/tasks` (owner/member): pagination, `status`, `priority`, `assignedTo` = user id / `me` / `unassigned`, `search` on the title, `sortBy` = createdAt / dueDate / priority / title.
  - `GET /tasks/:taskId`
  - `PATCH /tasks/:taskId`
  - `PATCH /tasks/:taskId/status`
  - `PATCH /tasks/:taskId/assign` (owner; `null` unassigns)
  - `DELETE /tasks/:taskId` (owner; soft delete)
- **Permissions:**
  - The owner may edit title, description, priority and due date.
  - A member may edit only the **description**, and only of a task **assigned to them**.
  - The assignee and the project can never be changed through `PATCH /tasks/:id`: the strict schema rejects them with 422, and assignment has its own owner-only endpoint.
- **Status workflow:** members follow TODO → IN_PROGRESS → REVIEW → COMPLETED. They can step back (IN_PROGRESS → TODO, REVIEW → IN_PROGRESS) and reopen a task (COMPLETED → IN_PROGRESS). The owner may set any status. Setting the current status again → 400.
- **Validation:**
  - The assignee must be an **active member of the same organization** (400, with the `assignedToId` field named).
  - The due date can't be in the past or after the project's due date (422).
  - Tasks can't be added to an ARCHIVED project.
  - Task limit per project: FREE 50, PRO 1000, checked under the organization row lock.
- **Isolation:** tasks are always looked up by id **and** the caller's organization, and must belong to a non-deleted project. Anything else → 404.
- **Audit:** TASK_CREATED / TASK_UPDATED (fields) / TASK_STATUS_CHANGED (from → to) / TASK_ASSIGNED (from → to) / TASK_DELETED.

### Verification – Phase 5

`bun run typecheck` ✅ · `bun run lint` ✅ · `bun run test` ✅ **123/123**. The 18 new tests cover:

- create and assign; member create → 403; foreign or deactivated assignee → 400
- due-date rules; archived, deleted or foreign projects; the 50-task FREE limit
- list filters, sorting and pagination; another organization's project → 404
- get and isolation
- owner update; member limited to the description of their own tasks; protected fields → 422
- full workflow to COMPLETED, with **project progress updating to 50%** and the audit trail
- invalid transitions, same status, and someone else's task
- owner override; assign/reassign/unassign with the audit trail; non-member assignee; member assigning → 403
- soft delete removes the task from progress; member and cross-organization deletes

---

## Phase 4 – Projects ✅

### Delivered – Phase 4

- **Endpoints** (`src/modules/projects/`):
  - `POST /projects` (owner)
  - `GET /projects` (owner/member): pagination, `search` on name/description, `status` filter, `sortBy` = createdAt / name / dueDate, `sortOrder`.
  - `GET /projects/:projectId` (owner/member)
  - `PATCH /projects/:projectId` (owner)
  - `DELETE /projects/:projectId` (owner)
- **Progress:** completed ÷ total tasks × 100, to 2 decimals; 0 when there are no tasks; soft-deleted tasks are ignored. Every project response includes `taskStats` (total, completed, count per status). A list page needs only one grouped query, with no query per project.
- **Plan limit:** "active projects" means status ACTIVE and not deleted. Creating an ACTIVE project, or switching another project back to ACTIVE, is checked under the organization row lock. Projects with other statuses don't count (FREE: 2, PRO: unlimited).
- **Dates:**
  - `YYYY-MM-DD` date-only values.
  - On create, the due date can't be in the past.
  - The due date must be on or after the start date, also when checked against values already stored.
- **Soft delete:** sets `deletedAt` on the project and its tasks. Deleted rows disappear from every query and return 404.
- **Isolation:** every query is scoped to the caller's organization, so another organization's project ids return 404.
- **Audit:** PROJECT_CREATED / PROJECT_UPDATED (changed fields and status before/after) / PROJECT_DELETED (number of tasks deleted).

### Verification – Phase 4

`bun run typecheck` ✅ · `bun run lint` ✅ · `bun run test` ✅ **105/105**. The 13 new tests cover:

- the progress formula
- create, the member/unauthenticated rejections, and validation (name, date order, past date, date format, mass assignment, unknown status)
- the FREE limit, including re-activating a project
- the list: organization isolation, deleted projects excluded, progress 33.33%, search, filter, sorting and pagination
- get: invalid id (422), another organization's or a deleted project (404)
- update, with the date check against stored values and the audit entry
- update/delete by a member (403) or another organization (404)
- soft delete of the project and its tasks

---

## Phase 3 – Organizations & members ✅

### Delivered – Phase 3

- **Endpoints** (`src/modules/organizations/`):
  - `POST /organizations` (TEAM_OWNER): in one transaction, creates the organization with a unique slug, the owner's membership and a FREE subscription.
  - `GET /organizations/current` (owner/member; works even when suspended): plan limits, member/project counts and `isOwner`.
  - `PATCH /organizations/current` (owner): name and description.
  - `POST /organizations/current/members` (owner): add an existing account by email. The account becomes TEAM_MEMBER.
  - `GET /organizations/current/members` (owner/member): pagination and search by name or email.
  - `PATCH /organizations/current/members/:memberId` (owner): `{ isActive }`. Deactivation also revokes the member's refresh tokens.
  - `DELETE /organizations/current/members/:memberId` (owner): the member's tasks become unassigned and their role returns to TEAM_OWNER.
- **Organization scope** (`organization.middleware.ts`):
  - The organization is resolved from the caller's membership, never from a client-supplied id.
  - Suspended organizations are blocked (403), except for `GET /current`.
  - `organizationOwnerAccess()` combines the role check with the organization-ownership check.
  - Another organization's ids return 404, so their existence isn't revealed.
- **Plans** (`subscriptions/subscription.service.ts`):
  - The effective plan is the best ACTIVE subscription that has started and not ended, otherwise FREE.
  - An expired PRO subscription never counts, even while its status is still ACTIVE.
  - Limit checks run after `SELECT … FOR UPDATE` on the organization row, so concurrent requests cannot exceed a limit.
- **Audit log helper** (`utils/audit-log.ts`): written inside the same transaction as the change. Records ORGANIZATION_CREATED/UPDATED and MEMBER_ADDED/UPDATED/REMOVED.
- **Rules enforced:** one owned organization per user; one organization per user; admin, deactivated and foreign-organization accounts can't be added; the owner can't remove or deactivate themselves.

### Verification – Phase 3

`bun run typecheck` ✅ · `bun run lint` ✅ · `bun run test` ✅ **92/92**. The 23 new organization tests cover:

- create, duplicate (409), and the wrong role or no login (403/401)
- current organization for owner and member, no organization (404), suspended organization
- profile update, member and empty-body rejections
- adding a member: success, unknown email (404), duplicate or foreign membership (409), admin (400)
- the FREE limit of 5; **three concurrent adds for one free slot give exactly one success**
- PRO limits while active and FREE limits once it expires
- pagination and search; deactivation (sessions revoked, login blocked)
- the owner can't be changed or removed
- removal unassigns tasks and leaves the user with no organization access
- cross-organization ids → 404

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
