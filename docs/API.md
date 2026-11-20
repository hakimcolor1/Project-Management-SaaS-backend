# TeamFlow API Guide

- **Base URL:** `{host}/api/v1`. Production: `https://teamflow-backend-two.vercel.app/api/v1`. Locally: `http://localhost:5000/api/v1`.
- **Interactive docs:** Swagger UI at `{host}/api-docs`, with the raw OpenAPI file at `{host}/api-docs/openapi.yaml` (source: [`api-documentation.yaml`](api-documentation.yaml)).
- **Postman:** import [`TeamFlow.postman_collection.json`](TeamFlow.postman_collection.json) and [`TeamFlow.postman_environment.json`](TeamFlow.postman_environment.json).

---

## 1. Authentication

| Step | Request | Result |
| --- | --- | --- |
| Sign up | `POST /auth/register` `{ name, email, password }` | Creates a **TEAM_OWNER** account. A `role` field is rejected (422). |
| Log in | `POST /auth/login` `{ email, password }` | Access token (15 min) and refresh token (7 days) |
| Google (browser) | Open `GET /auth/google` in a browser | Redirects to Google; Google returns to `GET /auth/google/callback`, which signs you in (cookies + user + tokens). No frontend needed. |
| Google (ID token) | `POST /auth/google` `{ idToken }` | Same result, for frontends using Google Identity Services. |
| Use the API | `Authorization: Bearer <accessToken>` **or** the `accessToken` cookie | |
| Renew | `POST /auth/refresh-token` (cookie, or `{ refreshToken }` in the body) | A new token pair. The old refresh token is revoked. |
| Log out | `POST /auth/logout` | The refresh token is revoked and the cookies are cleared. |
| Who am I | `GET /auth/me` or `GET /users/me` | The user and their organization (or `null`) |
| Edit profile | `PATCH /users/me` `{ name?, avatar? }` | Only name and avatar (https URL, `null` removes it). Any other field → 422. |

Token details:

- **Cookies.** Both tokens are set as `HttpOnly` cookies. In production they are also `Secure` and `SameSite=None`, because the frontend and API are on different domains. The refresh cookie is only sent to `/api/v1/auth`.
- **Response body.** Tokens are also returned in the body, for API clients. Browser apps should rely on the cookies and **never** store tokens in `localStorage`.
- **Rotation.** Every refresh revokes the presented token. Presenting a revoked token again is treated as theft and **signs the user out everywhere**.
- **Storage.** Only a SHA-256 hash of each refresh token is stored. Passwords are hashed with bcrypt (cost 12).
- **Password rules:** 8+ characters (max 72 bytes) with an upper-case letter, a lower-case letter and a number.
- **Google login (both flows):**
  - Identity comes **only** from a Google ID token verified on the server: signature, expiry, issuer, audience (`GOOGLE_CLIENT_ID`) and a verified email. Client-sent profile data is never trusted.
  - New emails become TEAM_OWNER accounts.
  - An existing account is linked by email. If that account's email was never verified, its password is removed and its sessions revoked, so whoever registered the address first can't keep access.
  - SUPER_ADMIN accounts cannot use Google login.
  - `POST /auth/google` needs `GOOGLE_CLIENT_ID`; the redirect flow also needs `GOOGLE_CLIENT_SECRET`. Without them the endpoints return 503.
- **Google redirect flow (Passport, `src/config/passport.ts`):**
  - `GET /auth/google` sets a one-time, 10-minute `HttpOnly; SameSite=Lax` cookie holding a random `state` (CSRF protection) and a PKCE verifier. It then redirects to Google with the `state` and an `S256` code challenge.
  - `GET /auth/google/callback` rejects a missing or mismatched `state` (401), a cancelled consent screen (401) and a missing `code` (400). It then exchanges the code server-to-server with the client secret and the PKCE verifier, and verifies the returned ID token as above.
  - No server sessions are used, so it works on Vercel serverless.
  - The GCP OAuth client must list `GOOGLE_CALLBACK_URL` (default `BACKEND_URL/api/v1/auth/google/callback`) as an authorized redirect URI.

## 2. Roles and permissions

| Capability | SUPER_ADMIN | TEAM_OWNER | TEAM_MEMBER |
| --- | :---: | :---: | :---: |
| Register / log in | seeded only | ✅ | ✅ |
| Create an organization (one per user) | – | ✅ | ❌ |
| View own organization | – | ✅ | ✅ |
| Update organization / manage members | – | ✅ | ❌ |
| View / edit own profile (`/users/me`) | ✅ | ✅ | ✅ |
| View projects and tasks | – | ✅ | ✅ |
| View my assigned tasks (`/tasks/my-assigned`) | – | ✅ | ✅ |
| Create / update / delete projects | – | ✅ | ❌ |
| Create / assign / delete tasks | – | ✅ | ❌ |
| Update a task | – | ✅ all fields | ✅ description only, on tasks **assigned to them** |
| Change task status | – | ✅ any status | ✅ own tasks, following the workflow |
| View subscription / pay / payment history and status | – | ✅ | ❌ |
| `/admin/*` (stats, organizations, users, payments, audit logs, plans) | ✅ | ❌ | ❌ |

How this is enforced:

- **Role check:** `authorize(...roles)` returns 401 when not logged in and 403 for the wrong role. The role is re-read from the database on every request, so a token cannot raise its own role.
- **Organization check:** the organization always comes from the caller's membership. Ids belonging to another organization return **404**, so their existence isn't revealed.
- **Suspended organizations:** every tenant route returns **403**, except `GET /organizations/current`, so the owner can still see the status.

**Task status workflow for members:** `TODO → IN_PROGRESS → REVIEW → COMPLETED`. Members can also step back (`IN_PROGRESS → TODO`, `REVIEW → IN_PROGRESS`) and reopen a task (`COMPLETED → IN_PROGRESS`).

## 3. Plans and limits

| Plan | Price | Members | Active projects | Tasks per project | Duration |
| --- | --- | --- | --- | --- | --- |
| FREE | 0 BDT | 5 | 2 | 50 | never expires |
| PRO | 1500 BDT | 25 | unlimited | 1000 | 30 days per payment |

- **Effective plan:** the best subscription that is ACTIVE, has started and has not ended; otherwise FREE. An expired PRO subscription therefore gives no PRO benefits.
- **Enforced on the server:** limits are checked under a row lock, so concurrent requests can't exceed them. Reaching a limit returns **403** with a clear message.
- **Renewing early:** buying PRO while a PRO period is running extends it; the new period starts when the current one ends.

## 4. Conventions

```jsonc
// Success
{ "success": true, "message": "Project created successfully", "data": { … } }
// List
{ "success": true, "message": "…", "data": [ … ], "meta": { "page": 1, "limit": 10, "total": 25, "totalPages": 3 } }
// Error
{ "success": false, "message": "Validation failed", "errors": [ { "location": "body", "field": "dueDate", "message": "Due date cannot be in the past" } ] }
```

- **Pagination:** `?page=1&limit=10` (limit 1–100).
- **Search and filters:** `search`, `status`, `priority`, `assignedTo=me|unassigned|<userId>`, `sortBy`, `sortOrder=asc|desc`.
- **IDs:** UUIDs. A malformed id → **422**.
- **Dates:** date-only `YYYY-MM-DD`, returned as `YYYY-MM-DDT00:00:00.000Z`.
- **Money:** decimal strings such as `"1500.00"`, in BDT.
- **Unknown body fields** are rejected (422). This is the protection against mass assignment, for example sending `role`, `organizationId` or `assignedToId` where they aren't allowed.
- **Progress:** `completed tasks / total tasks × 100`, rounded to 2 decimals; 0 when there are no tasks.

## 5. Endpoints

| Method | Path | Access |
| --- | --- | --- |
| GET | `/health` | public |
| POST | `/auth/register`, `/auth/login`, `/auth/google` | public (rate limited: 20 / 15 min / IP) |
| GET | `/auth/google`, `/auth/google/callback` | public, browser redirect flow (same rate limit) |
| POST | `/auth/refresh-token`, `/auth/logout` | refresh token |
| GET | `/auth/me` | authenticated |
| GET, PATCH | `/users/me` | authenticated (every role) |
| POST | `/organizations` | TEAM_OWNER |
| GET | `/organizations/current` | owner, member |
| PATCH | `/organizations/current` | owner |
| POST, GET | `/organizations/current/members` | owner (POST), owner/member (GET) |
| PATCH, DELETE | `/organizations/current/members/:memberId` | owner |
| POST, GET | `/projects` | owner (POST), owner/member (GET) |
| GET, PATCH, DELETE | `/projects/:projectId` | owner/member (GET), owner |
| POST, GET | `/projects/:projectId/tasks` | owner (POST), owner/member (GET) |
| GET | `/tasks/my-assigned` | owner/member: tasks assigned to me in every project (pagination, `status`, `priority`, `projectId`, `search`, `sortBy`) |
| GET, PATCH | `/tasks/:taskId` | owner/member (PATCH limited for members) |
| PATCH | `/tasks/:taskId/status` | owner, assigned member |
| PATCH | `/tasks/:taskId/assign` | owner |
| DELETE | `/tasks/:taskId` | owner |
| GET | `/plans` | public (cached) |
| GET | `/subscriptions/current` | owner |
| POST | `/payments/initiate` | owner |
| POST | `/payments/validate`, `/payments/ipn` | SSLCommerz callbacks |
| GET | `/payments/history` | owner |
| GET | `/payments/:paymentId` | owner: one payment's status, by id **or** `transactionId` |
| GET | `/admin/dashboard`, `/admin/organizations`, `/admin/users`, `/admin/payments`, `/admin/audit-logs` | SUPER_ADMIN |
| PATCH | `/admin/organizations/:id/status`, `/admin/plans/:planId` | SUPER_ADMIN |

## 6. Examples

**Register**

```http
POST /api/v1/auth/register
Content-Type: application/json

{ "name": "John Doe", "email": "john@example.com", "password": "SecurePassword123" }
```

```json
{
  "success": true,
  "message": "Registration successful",
  "data": { "user": { "id": "0193…", "name": "John Doe", "email": "john@example.com", "role": "TEAM_OWNER", "isActive": true, "emailVerified": false } }
}
```

**Login**: response `200`:

```json
{
  "success": true,
  "message": "Login successful",
  "data": { "user": { "id": "0193…", "role": "TEAM_OWNER" }, "accessToken": "eyJ…", "refreshToken": "eyJ…" }
}
```

**Create a project** (owner):

```http
POST /api/v1/projects
Authorization: Bearer eyJ…

{ "name": "Website Redesign", "startDate": "2027-01-01", "dueDate": "2027-03-31" }
```

```json
{
  "success": true,
  "message": "Project created successfully",
  "data": {
    "id": "0193…", "name": "Website Redesign", "status": "ACTIVE",
    "startDate": "2027-01-01T00:00:00.000Z", "dueDate": "2027-03-31T00:00:00.000Z",
    "taskStats": { "total": 0, "completed": 0, "byStatus": { "TODO": 0, "IN_PROGRESS": 0, "REVIEW": 0, "COMPLETED": 0 } },
    "progress": 0
  }
}
```

**Member skips a workflow step**: `PATCH /api/v1/tasks/:id/status { "status": "COMPLETED" }` on a TODO task returns `400`:

```json
{ "success": false, "message": "Cannot move a task from TODO to COMPLETED. Allowed: IN_PROGRESS", "errors": [] }
```

**Plan limit reached**: `POST /api/v1/projects` with two active projects on FREE returns `403`:

```json
{ "success": false, "message": "Your FREE plan allows at most 2 active projects. Upgrade your plan to add more.", "errors": [] }
```

## 7. Payments (SSLCommerz)

1. `POST /payments/initiate { "planId": "<PRO id>" }` creates a PENDING subscription and a PENDING payment, then returns `gatewayUrl`.
2. The client redirects the user to `gatewayUrl`, and the user pays on SSLCommerz.
3. SSLCommerz posts to `/payments/validate` (the browser redirect) and `/payments/ipn` (server-to-server).
4. The server calls the **SSLCommerz validation API** with `val_id`. It checks the status (`VALID`/`VALIDATED`), the transaction id, the amount and the currency against its own record. IPN requests must also carry a valid `verify_sign`.
5. Only then are the payment marked `SUCCESS` and the subscription `ACTIVE`, both in one database transaction. Duplicate callbacks are idempotent (`alreadyProcessed: true`).
6. The browser is redirected to `FRONTEND_URL/payment/result?status=success|failed|cancelled&transactionId=…`.
7. Status tracking: `GET /payments/:transactionId` (or the payment id) returns that payment's status, amount, plan and subscription period. `GET /payments/history` lists every payment, and `GET /subscriptions/current` shows the effective plan.

A success redirect **without** `val_id`, or with a forged one, never activates anything. Without SSLCommerz credentials, `/payments/initiate` returns `503`.

## 8. Errors

| Status | Meaning in TeamFlow |
| --- | --- |
| 400 | Business rule violated: invalid assignee, invalid status transition, FREE plan payment, duplicate status, bad IPN signature, malformed JSON |
| 401 | Missing, invalid or expired token; wrong credentials; revoked refresh token |
| 403 | Wrong role, not the organization owner, suspended organization, deactivated account, plan limit reached |
| 404 | Not found, **or belongs to another organization**; unknown route |
| 409 | Duplicate (email, membership, organization per owner) |
| 422 | Validation failed: body, params or query. `errors[]` lists every problem. |
| 429 | Rate limit exceeded |
| 500 | Unexpected error. A generic message only; details are logged on the server, never returned. |
| 502 / 503 | Payment gateway error / a dependency (DB, gateway, Google) not reachable or not configured |

## 9. Postman

1. Import the collection and the environment, then select **TeamFlow – Local**.
2. Set `baseUrl`, plus `adminEmail` and `adminPassword` (the `DEMO_ADMIN_*` values used by the seed). Optionally change `ownerEmail` and `memberEmail`.
3. Run the collection top to bottom; the requests chain together.
   - Test scripts save `accessToken`, `refreshToken`, `organizationId`, `projectId`, `taskId`, `memberId`, `memberUserId`, `planId` and `transactionId`.
   - The member and admin folders log in as those users first.
4. Verified with Newman (Postman's CLI runner) against a local production build with the SSLCommerz sandbox store: **59/59 requests and 65/65 assertions pass** (2026-11-20).
   - Re-running within 15 minutes from the same IP can hit the auth rate limit (20 requests).
   - Registering an existing email returns 409, which the test accepts.
