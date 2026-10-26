# Phase 0 Spec: Technical Foundations

| Field                  | Value                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| **Status**             | Implemented                                                               |
| **Approved by / date** | Amr - 21/10/2026 - 16:02 pm                                                                |
| **Depends on**         | None                                                                                       |
| **Related decisions**  | MVP 3.9 (audit), D16; Technical T1-T14                                                     |

---

## 1. Objective

Build the base every later phase stands on: a running, tested application with a tenant data model, audit entries written in the same transaction as the change, and login for operators and tenant users.
The design is deliberately minimal for the MVP: one database role, tenant filtering in application code, and JWT authentication.
Stronger controls are listed in `TECHNICAL_DECISIONS.md` under "Deferred hardening".

## 2. Scope

**In scope:**

- Project skeleton: Node 24 LTS, pnpm, strict TypeScript (ESM), Express 5, Biome, Vitest, PostgreSQL 18 in Docker, `GET /health`.
- Cross-cutting basics: validated startup configuration, standard error format, request IDs, structured logging, graceful shutdown.
- Database foundation: Drizzle schema and generated migrations for `tenants`, `users`, `tenant_members`, and `audit_log`.
- Audit: `writeAuditEntry(tx, entry)` inside the business transaction.
- Authentication: login, refresh, logout, and current user, with JWTs in httpOnly cookies, for both operators and tenant users.
- The `operator:create` CLI.

**Out of scope (and where it is handled instead):**

- Creating tenants and their first Tenant Admin, and email verification (`/auth/verify`): Phase 1.
- Subscription states and their effect on requests: Phase 1.
- Creating, editing, and deactivating users through the API: Phase 2.
- Permissions and tenant-defined roles (beyond `operator`/`user` and the `admin`/`member` membership role): Phase 3.
- Password reset and password change: Phase 2.
- Everything under "Deferred hardening" in `TECHNICAL_DECISIONS.md` (RLS, login throttling, CSRF tokens, database-enforced append-only audit).
- Application Docker image, CI pipeline, and hosting: when the hosting provider is decided.

## 3. Requirements

Example tenants: **Al-Noor** and **Al-Rashid**.
Example people: **Sara**, Tenant Admin at Al-Noor; **Khalid**, a user at Al-Rashid; **Omar**, a platform operator.

| ID     | Requirement                                                                                                                                                                            | Example                                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| R0.1   | The service exposes a health endpoint that reports database connectivity.                                                                                                              | _With PostgreSQL up, `GET /health` returns 200; with it down, 503, and the load balancer stops routing to that instance._        |
| R0.2   | A fresh clone installs and runs the full test suite with one command, given Node and Docker.                                                                                           | _`pnpm install --frozen-lockfile && pnpm test` passes; Testcontainers starts the test database._                                 |
| R0.3   | The application refuses to start when configuration is missing or invalid, naming the keys without printing values.                                                                    | _`DATABASE_URL` unset: exit code 1 and `Invalid configuration: DATABASE_URL (Required)`._                                        |
| R0.4   | Every error response uses one JSON shape that includes the request ID.                                                                                                                 | _`GET /no-such-route` returns 404 `{"error":{"code":"NOT_FOUND","requestId":"..."}}`._                                           |
| R0.5   | Every request gets a request ID, returned in `X-Request-Id` and attached to every log line of that request.                                                                            | _Sara quotes a request ID; support finds every log line of that request._                                                        |
| R0.6   | Unexpected errors return 500 without internal details and are logged with their stack.                                                                                                 | _A `TypeError` in a handler returns `{"error":{"code":"INTERNAL",...}}`; the log has the stack._                                 |
| R0.7   | Every query on tenant data filters by the caller's tenant.                                                                                                                             | _Sara lists users and sees only Al-Noor's members, never Khalid._                                                                |
| R0.8   | A user belongs to at most one tenant; an operator belongs to none.                                                                                                                     | _Adding Khalid to Al-Noor while he is a member of Al-Rashid fails with a unique violation._                                      |
| R0.8a  | Every membership has a role inside the tenant: `admin` or `member`, defaulting to `member`. The tenant's owner is always an `admin`.                                                   | _Sara's membership in Al-Noor has role `admin`; Khalid's in Al-Rashid has `member`._                                             |
| R0.9   | Every audit entry is written in the same transaction as the change it describes.                                                                                                       | _A rolled-back change leaves no audit row._                                                                                      |
| R0.10  | Operators and tenant users log in at one endpoint with email and password. A wrong email, wrong password, or inactive account gets the same response.                                  | _Sara posts a wrong password to `/auth/login` and gets 401 `INVALID_CREDENTIALS`; an unknown email gets the identical response._ |
| R0.11  | A successful login sets an access-token cookie and a refresh-token cookie, both `HttpOnly` and `Secure`. Protected routes reject a missing, invalid, or expired access token with 401. | _Sara's access token expires; her next request returns 401 `UNAUTHENTICATED`, and the client calls `/auth/refresh`._             |
| R0.12  | Logout revokes the refresh token and clears both cookies.                                                                                                                              | _After logout, replaying Sara's old refresh cookie returns 401._                                                                 |
| R0.12a | Refresh checks the database: a revoked or expired refresh token, or an inactive user, is rejected.                                                                                     | _Sara is deactivated; within 30 minutes her refresh fails and she is logged out._                                                |
| R0.13  | The first platform operator can be created without an existing operator and without an HTTP endpoint.                                                                                  | _The deployer runs `pnpm operator:create omar@watheeq.sa "Omar Al-Harbi"`, and Omar can log in._                                                 |

## 4. Design

### 4.1 Data model

One database role, used by the app, migrations, and the CLI (`DATABASE_URL`).
Tables are defined in `src/db/schema/`, and `pnpm db:generate` produces the migrations in `db/migrations/`.

**`users`**: every account, operators and tenant users alike (T4).

| Column          | Type              | Notes                                                                                                      |
| --------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`            | `uuid` PK         | Generated by the database.                                                                                 |
| `email`         | `text`            | Unique (T6). Check `email = lower(btrim(email))`, so `Sara@AlNoor.sa` cannot sit next to `sara@alnoor.sa`. |
| `user_name`     | `text`        | Not null. The person's display name, for example `Sara Al-Qahtani` or `سارة القحطاني`. Trimmed, 1-100 characters (check constraint). Not unique; login is by email (P0.20). |
| `password_hash` | `text`            | argon2id.                                                                                                  |
| `role`          | `user_roles` enum | `user` (default) or `operator`.                                                                            |
| `is_active`     | `boolean`         | Default `true`.                                                                                            |
| `locked_until`  | `timestamptz`     | Unused in the MVP (throttling is deferred); dropped in step 0.3 unless kept for throttling.                |
| `created_at`    | `timestamptz`     |                                                                                                            |

**`tenants`**:

| Column       | Type          | Notes                                                                                                                                                        |
| ------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`         | `uuid` PK     |                                                                                                                                                              |
| `name`       | `text`        | Not null.                                                                                                                                                    |
| `slug`       | `text`        | Not null, unique. A URL-safe short name, for example `al-noor`.                                                                                              |
| `owner_id`   | `uuid`        | FK to `users`, nullable only while the tenant is being created. The tenant's owner: its first Tenant Admin, who can never be deleted or deactivated (P0.10). |
| `created_at` | `timestamptz` |                                                                                                                                                              |

**`tenant_members`**: links a tenant user to their tenant (T5).

| Column       | Type                       | Notes                                                                                                                                                          |
| ------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant_id`  | `uuid`                     | FK to `tenants`, not null.                                                                                                                                     |
| `user_id`    | `uuid`                     | FK to `users`, not null, **unique**: one membership per user.                                                                                                  |
| `role`       | `tenant_member_roles` enum | Not null, default `member`. The user's role inside this tenant's organization: `admin` (Sara, Tenant Admin) or `member` (Khalid). Replaced in Phase 3 (P0.13). |
| `created_at` | `timestamptz`              |                                                                                                                                                                |

Primary key `(tenant_id, user_id)`; the unique index on `user_id` also serves "find Sara's tenant" at login.
Operators have no row here.

Two different "roles" exist, and they answer different questions:

- `users.role` (`operator` or `user`): is this a platform account or a tenant account?
- `tenant_members.role` (`admin` or `member`): what does this tenant user do inside their organization?

Phase 3 replaces `tenant_members.role` with `role_id`, a foreign key to the roles each tenant defines from the permission catalog (MVP 3.3, D1).
Rows with `admin` become members holding the tenant's Tenant Admin role.
The enum lets Phases 1 and 2 tell a Tenant Admin from other users before Phase 3 exists.

**`refresh_tokens`**: one row per issued refresh token, so refresh can be checked and revoked (P0.8).

| Column       | Type          | Notes                                                                         |
| ------------ | ------------- | ----------------------------------------------------------------------------- |
| `id`         | `uuid` PK     |                                                                               |
| `user_id`    | `uuid`        | FK to `users`, not null. Indexed.                                             |
| `token_hash` | `text`        | SHA-256 of the random token, unique. The raw token exists only in the cookie. |
| `expires_at` | `timestamptz` | 7 days after issue.                                                           |
| `revoked_at` | `timestamptz` | Set on rotation and logout. Null while valid.                                 |
| `created_at` | `timestamptz` |                                                                               |

Expired and revoked rows are harmless; a periodic cleanup comes with the Phase 7 job runner.

**`audit_log`**:

| Column          | Type                 | Notes                                                                           |
| --------------- | -------------------- | ------------------------------------------------------------------------------- |
| `id`            | `bigint` identity PK |                                                                                 |
| `tenant_id`     | `uuid`               | FK to `tenants`. Null marks a platform-level entry (for example a plan change). |
| `occurred_at`   | `timestamptz`        | Default `now()`, the transaction start time.                                    |
| `actor_type`    | `text`               | `user`, `operator`, or `system`.                                                |
| `actor_id`      | `uuid`               | Null only for `system`.                                                         |
| `action`        | `text`               | Dotted name, for example `user.deactivated`.                                    |
| `resource_type` | `text`               |                                                                                 |
| `resource_id`   | `text`               |                                                                                 |
| `reason`        | `text`               | Nullable.                                                                       |
| `details`       | `jsonb`              | Nullable. Before and after values where useful.                                 |
| `request_id`    | `text`               | Links the entry to logs.                                                        |

Checks: `actor_type` values; `actor_id` required unless `system`; a `user` actor always has a tenant.
Indexes: `(tenant_id, occurred_at)`, and `occurred_at` for platform-level entries.

#### Tenant isolation

Tenant isolation is a coding rule, not a database rule (T2):

- A repository function that touches tenant data takes `tenantId` as a parameter and puts it in the `WHERE` clause (or the inserted row).
- The tenant ID always comes from the authenticated user (the access token), never from the request body or URL.
- Operator code that reads across tenants lives only in operator modules (Phase 1).

What this does not protect against: a query that forgets the filter returns other tenants' rows.
The safeguard is review plus an isolation test per tenant-data repository that seeds two tenants and asserts that only one tenant's rows come back.

### 4.2 API

See [phase-0-foundations.API.md](phase-0-foundations.API.md).

### 4.3 Key flows

#### Login

1. Validate the body with zod; normalize the email (trim, lowercase).
2. Find the user by email, with their membership (`tenant_id`, `role`) if any.
3. No user: verify the password against a fixed dummy hash anyway (similar response time, so timing does not reveal which emails exist), then 401.
4. Wrong password, or `is_active = false`: 401 `INVALID_CREDENTIALS`.
5. Issue the access token (30 minutes; payload below) and a random refresh token (7 days), store the refresh token's hash, and set both cookies.

#### Access token payload

```json
{
  "sub": "<user id>",
  "iss": "watheeq_api",
  "iat": 1792590118,
  "exp": 1792591918,
  "username": "Sara Al-Qahtani",
  "email": "sara@alnoor.sa",
  "role": "user",
  "tenant": { "id": "<al-noor id>", "roleId": null, "roleName": "admin", "permissions": [] }
}
```

- `iss` is always `watheeq_api`, and verification rejects any other issuer (P0.19).
- `tenant` is `null` for an operator such as Omar.
- Until Phase 3, `roleId` is `null`, `roleName` is the membership enum (`admin` or `member`), and `permissions` is empty. Phase 3 fills them from the tenant's real roles without changing the shape (P0.18).
- Any change to the name, email, role, or membership reaches the token at the next refresh, so within 30 minutes.

#### Request authentication

The `authenticate()` middleware reads `wq_access`, verifies the signature and expiry, and attaches the user `{id, email, userName, role, tenant}` to the request.
It reads no database row, so a deactivated user keeps access until the access token expires: at most 30 minutes.
The same holds for a role change: if Khalid is promoted to `admin`, his new role reaches his token at his next refresh.

#### Refresh

1. Hash the `wq_refresh` cookie and, in one transaction, load its row with the user and membership.
2. Reject with 401 and clear both cookies if the row is missing, revoked, or expired, or the user is inactive.
3. Revoke the row, insert a new one, and issue a new access token with the account's current name, email, role, and tenant.

Example: Omar deactivates Sara at 10:00; her access token expires at 10:20.
At 10:20 the client calls `/auth/refresh`, step 2 finds `is_active = false`, and Sara is logged out.

Each refresh starts a new 7-day refresh token, so an active user stays logged in, and a user idle for 7 days must log in again.
Rotation also means a stolen refresh token stops working once the real client refreshes.
Presenting an already-revoked token is simply rejected; detecting reuse and revoking all of a user's tokens is deferred hardening.

#### Audit

```ts
await withTx(db, async (tx) => {
  await usersRepo.deactivate(tx, tenantId, khalidId);
  await writeAuditEntry(tx, {
    tenantId,
    actor: { type: "user", id: saraId },
    action: "user.deactivated",
    resourceType: "user",
    resourceId: khalidId,
    reason: "Left the company",
    requestId,
  });
});
```

`writeAuditEntry` accepts only a `Tx`, so it cannot run outside a transaction.
The tenant is passed explicitly (`null` for a platform-level entry), because there is no database tenant context any more.

#### Startup and shutdown

1. Load and validate configuration; exit with code 1 on failure (R0.3).
2. Create the pool and the app; listen on `PORT`.
3. On `SIGTERM` or `SIGINT`: stop accepting connections, let in-flight requests finish (up to 10 seconds), close the pool, exit.

### 4.4 Module structure

```
src/
  main.ts, app.ts          startup; buildApp(deps) mounts shared middleware and each module's router (T14)
  config/                  zod schema for environment variables
  http/                    AppError, validate()
  logging/                 pino with redaction
  middleware/              request logger, not-found, error handler
  db/
    pool.ts                pg pool, Drizzle instance, Db / Tx / Executor types
    tx.ts                  withTx(db, fn)
    migrate.ts, schema/
  audit/                   writeAuditEntry(tx, entry)
  modules/
    auth/                  auth.routes.ts (composes the module), controller, service, repository, auth.config.ts, auth.schemas.ts, auth.types.ts; shared/ (cookies, passwords, tokens, authenticate middleware)
    health/                routes, controller, repository
  cli/                     migrate.ts, create-operator.ts
db/migrations/             generated by Drizzle Kit
```

## 5. Edge Cases and Failure Behavior

| Scenario                                                                  | Expected behavior                                                                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A repository query on tenant data omits the `tenant_id` filter.           | Not prevented by the database (T2). Caught by that repository's two-tenant isolation test.                       |
| Khalid (Al-Rashid) is added to Al-Noor.                                   | Unique violation on `tenant_members.user_id`; the transaction rolls back (R0.8).                                 |
| Someone tries to change Sara's (the owner's) membership role to `member`. | Rejected by the service that changes roles (Phase 2), since the owner is always `admin` (P0.10).                 |
| The business update succeeds, then the audit insert fails.                | The whole transaction rolls back (R0.9).                                                                         |
| Sara is deactivated while logged in.                                      | Her access token keeps working for at most 30 minutes; her next refresh is rejected and her cookies are cleared. |
| Two tabs refresh at the same moment with the same refresh token.          | One rotation wins; the other gets 401 and the client logs in again. Accepted for the MVP.                        |
| Sara logs out, and an attacker replays her old refresh cookie.            | The row is revoked; 401.                                                                                         |
| Sara logs in with `Sara@AlNoor.sa` but is stored as `sara@alnoor.sa`.     | Emails are normalized on write and on lookup; login succeeds.                                                    |
| A tampered or expired access token.                                       | 401 `UNAUTHENTICATED`.                                                                                           |
| A login password field is 1 MB.                                           | 413 from the body limit; a password over 256 characters returns 400 before hashing.                              |
| PostgreSQL is down at startup.                                            | The app starts and `/health` returns 503; no crash loop.                                                         |
| A client sends `X-Request-Id: <script>...`.                               | Values not matching `^[A-Za-z0-9._-]{1,64}$` are replaced with a UUID.                                           |

## 6. Security and Authorization

- **Trust boundaries:** bodies validated with zod in the controller; configuration validated at startup.
- **Tenant isolation:** application-level filters (T2), with the tenant taken only from the access token.
- **Passwords:** argon2id (19 MiB, 2 iterations, 1 lane); never logged or returned.
- **Tokens:** a signed JWT access token (30 minutes) and an opaque random refresh token (7 days, stored only as a SHA-256 hash, rotated on every refresh, revoked on logout), both in `HttpOnly`, `Secure`, `SameSite=Lax` cookies; the refresh cookie is scoped to `/auth`.
- **CSRF:** `SameSite=Lax` cookies, a same-origin deployment, and JSON-only bodies (a cross-site form cannot send `application/json`). CSRF tokens are deferred.
- **Enumeration:** identical responses and similar timing for unknown email, wrong password, and inactive account.
- **Logging:** pino redacts `password`, `cookie`, `set-cookie`, and `authorization`; logs go to stdout only (data residency).
- **Audit:** logins and logouts go to the application log, not the audit table.

## 7. Implementation Steps

| Step                     | Objective                                           | Delivers                                                                                                                                                                                                                                                                                                                                                                                                    | Acceptance criteria                                                                                                                                                                                                        | Status      |
| ------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 0.1 Skeleton             | Prove the toolchain end to end.                     | Toolchain, Docker Compose PostgreSQL, Testcontainers, `GET /health`.                                                                                                                                                                                                                                                                                                                                        | Health returns 200 and 503 in the two cases; lint, typecheck, build, and tests pass on a fresh clone.                                                                                                                      | Implemented |
| 0.2 Cross-cutting basics | Make every endpoint consistent and observable.      | Config validation, `AppError` and handler, not-found, request IDs, pino with redaction, graceful shutdown.                                                                                                                                                                                                                                                                                                  | Invalid config exits 1 naming keys; unknown route 404 and thrown error 500 in the standard shape; log lines carry the request ID.                                                                                          | Implemented |
| 0.3 Database baseline    | One role, one fresh migration history, green suite. | Schema for `users`, `tenants`, `tenant_members`, `refresh_tokens`, `audit_log`; a fresh generated baseline migration; test setup without role bootstrap; config and `.env.example` reduced to used keys; obsolete RLS, session, throttle, and CSRF tests removed; the JSON body parser (100 KB, JSON only) restored, so the step 0.2 tests keep passing; `operator:create` CLI rewritten to insert a `users` row with role `operator`.                                                                                                                                           | `pnpm db:migrate` on an empty database creates all five tables; `pnpm operator:create` inserts an active operator and rejects a duplicate email or a password outside 12-256 characters; the membership unique constraint holds (R0.8); a membership without a role gets `member` (R0.8a); `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.     | Implemented |
| 0.4 Audit                | Audit in the same transaction.                      | `writeAuditEntry(tx, entry)` with an explicit `tenantId`.                                                                                                                                                                                                                                                                                                                                                   | A committed change leaves one row with the right tenant, actor, action, and request ID; a rolled-back change leaves none; a platform-level entry has a null tenant.                                                        | Implemented |
| 0.5 Authentication       | Login for operators and tenant users.               | Cookie parsing; JWT issue and verify; refresh-token rotation; config keys `JWT_SECRET` (at least 32 characters), `ACCESS_TOKEN_TTL_SECONDS` (default 1800), `REFRESH_TOKEN_TTL_SECONDS` (default 604800); `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`; `authenticate()`; a `requireRole('operator')` guard; a test that an operator created by the CLI can log in. | R0.10-R0.13 and R0.12a hold; a tenant user's token carries their tenant and membership role; an operator's token carries `tenant: null`; a tenant user on a `requireRole('operator')` route gets 403. | Implemented |

## 8. Test Plan

Integration tests run against a real PostgreSQL migrated from scratch; unit tests cover pure logic only.

| Requirement         | Test                                                                                                                                                                 | Step                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| R0.1, R0.2          | Integration: DB up and DB down; fresh-clone run.                                                                                                                     | 0.1                        |
| R0.3-R0.6           | Unit: config schema. Integration: error cases, request ID header and log line.                                                                                       | 0.2                        |
| R0.7, R0.8, R0.8a   | Integration: two seeded tenants per tenant-data repository; duplicate membership; default membership role.                                                           | 0.3, and every later phase |
| R0.9                | Integration: commit and rollback.                                                                                                                                    | 0.4                        |
| R0.10-R0.13, R0.12a | Integration: login success and failures, expired and tampered tokens, refresh rotation, revoked and expired refresh tokens, refresh after deactivation, logout, CLI. | 0.5                        |

Token expiry is tested by signing tokens with a past expiry, not by waiting.

## 9. Open Questions

| #   | Question                                                | Options                                                                                      | Resolution                                                                                                            |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Q1  | Does `/auth/refresh` check the database?                | (a) Yes: hashed, rotated refresh tokens; refresh checks `is_active`. (b) No: signature only. | **Resolved 2026-10-21: (a)** (P0.8).                                                                                  |
| Q2  | Token lifetimes.                                        |                                                                                              | **Resolved 2026-10-21:** access 30 minutes, refresh 7 days, configurable (P0.9).                                      |
| Q3  | JWT library.                                            | (a) `jose`. (b) `jsonwebtoken`.                                                              | **Resolved 2026-10-21: (a) `jose`** (P0.12).                                                                          |
| Q4  | What is `tenants.owner_id` for, given `tenant_members`? |                                                                                              | **Resolved 2026-10-21:** the tenant's owner, its first Tenant Admin, who can never be deleted or deactivated (P0.10). |
| Q5  | `/auth/me` method.                                      |                                                                                              | **Resolved 2026-10-21:** `GET` (P0.11).                                                                               |

Resolved on 2026-10-21 (owner): tenant isolation in application code (T2); membership through `tenant_members` with a unique `user_id` (T5); JWT access and refresh cookies (T7); `/auth/verify` is email verification after tenant creation (Phase 1, MVP D16).

## 10. Decisions Made in This Spec

| #     | Decision                                                                                                                                                                                             | Rationale                                                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0.1  | The tenant ID used for filtering comes only from the access token.                                                                                                                                   | A client cannot pick another tenant by editing a URL or body.                                                                                                                    |
| P0.2  | `writeAuditEntry` takes the tenant explicitly; `null` means platform-level.                                                                                                                          | No database tenant context exists; one audit table serves both levels.                                                                                                           |
| P0.3  | Emails are normalized (trim, lowercase) on write and lookup, and a check constraint enforces it.                                                                                                     | Prevents look-alike duplicates and failed logins over letter case.                                                                                                               |
| P0.4  | Login uses a dummy hash for unknown emails and one response for every failure.                                                                                                                       | Does not reveal which emails exist.                                                                                                                                              |
| P0.5  | Error responses carry `code`, `requestId`, and optional `details`, never a message.                                                                                                                  | Localized clients; no leaked internals (T11).                                                                                                                                    |
| P0.6  | Bodies must be `application/json` and at most 100 KB.                                                                                                                                                | Bounded input, and a cross-site form cannot post to the API.                                                                                                                     |
| P0.7  | Logins and logouts are logged, not audited.                                                                                                                                                          | MVP audit scope (3.9) covers business actions.                                                                                                                                   |
| P0.8  | Refresh tokens are opaque random values stored as SHA-256 hashes in `refresh_tokens`, rotated on every refresh and revoked on logout; refresh rejects inactive users.                                | A deactivated user loses access within one access-token lifetime; logout really ends the session; a database leak yields no usable tokens.                                       |
| P0.9  | Access tokens last 30 minutes, refresh tokens 7 days (sliding through rotation); both configurable.                                                                                                  | Owner decision (Q2): 30 minutes bounds the deactivation gap.                                                                                                                     |
| P0.10 | `tenants.owner_id` is the tenant's first Tenant Admin, who can never be deleted, deactivated, or lose the `admin` role. Phase 2's user-management endpoints enforce it.                              | Owner decision (Q4): a tenant always keeps one admin who can manage it.                                                                                                          |
| P0.11 | `/auth/me` is `GET`.                                                                                                                                                                                 | It only reads.                                                                                                                                                                   |
| P0.12 | Access tokens are signed and verified with `jose` (HS256 with `JWT_SECRET`).                                                                                                                         | Maintained, ESM-native, no native dependencies; one symmetric key is enough while the API is the only issuer and verifier.                                                       |
| P0.13 | `tenant_members.role` is an enum (`admin`, `member`, default `member`) until Phase 3 replaces it with `role_id` referencing tenant-defined roles; it is carried in the access token as `tenant.roleName` (P0.18). | Owner decision: Phases 1 and 2 need to recognize a Tenant Admin before the role catalog exists; there is no production data, so the Phase 3 change needs no data migration plan. |
| P0.14 | Known database errors become error codes in one place, `fromDatabaseError` in `src/http/errors.ts` (unique constraint name to code); repositories never catch. The error handler and the CLI both use it. | Owner's direction; see Phase 0.5 spec, 0.5-6. |
| P0.15 | Auth responses send `Cache-Control: no-store`. | They carry identity and set token cookies; no browser or proxy may cache them. |
| P0.16 | `/auth/me` returns the account's current data from the database; `authenticate()` itself still reads no row. | `/me` is called rarely (page load), so a read keeps the displayed user current at no real cost. |
| P0.17 | Refresh revokes the presented token with one conditional `UPDATE ... WHERE revoked_at IS NULL AND expires_at > now() RETURNING user_id`. | Of two concurrent refreshes with the same token, exactly one succeeds, without explicit locks. |
| P0.18 | The access token's `tenant` claim has its final shape now, `{id, roleId, roleName, permissions}`; until Phase 3, `roleId` is null, `roleName` is the membership enum, and `permissions` is empty. Auth responses return the same `tenant` object. | Owner decision: clients and later phases code against one shape that Phase 3 fills in. |
| P0.19 | Access tokens carry `iss: "watheeq_api"`, and verification requires it. | A token signed by another system that happens to share the key is still rejected. |
| P0.20 | `users.user_name` is the person's display name: required, trimmed, 1-100 characters, not unique. It is carried in the token as `username`. `operator:create` takes it as a second argument. | Owner decision: names are shown in the UI and audit views; login stays by email (T6). |

## 11. Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                    | Reason                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 2026-10-17 | Initial spec; steps 0.1 and 0.2 implemented.                                                                                                                                                                                                                                                                              | Phase 0 requested.                               |
| 2026-10-21 | Rewritten for the simplified MVP: one database role and application-level tenant filtering instead of RLS; one `users` table with a role instead of separate operator tables; `tenant_members` for membership; JWT cookies instead of server-side sessions; throttling and CSRF tokens deferred. Steps 0.3-0.5 redefined. | Owner simplified the codebase for the MVP stage. |
| 2026-10-21 | Resolved Q1, Q2, Q4, Q5: DB-checked rotating refresh tokens (`refresh_tokens` table, refresh flow, R0.12a), 30-minute access and 7-day refresh, `owner_id` meaning, `GET /auth/me` (P0.8-P0.11).                                                                                                                          | Owner review.                                    |
| 2026-10-21 | Resolved Q3: `jose` (P0.12). No open questions remain.                                                                                                                                                                                                                                                                    | Owner review.                                    |
| 2026-10-21 | Added `tenant_members.role` (`admin`, `member`), R0.8a, `tenantRole` in tokens and responses (P0.13).                                                                                                                                                                                                                     | Owner review.                                    |
| 2026-10-21 | Spec approved. Moved the JSON body parser and the `operator:create` rewrite from step 0.5 to step 0.3. | The step 0.2 tests need the body parser, and the old CLI blocks typecheck; owner approved. |
| 2026-10-21 | Step 0.3 implemented and verified. | Acceptance criteria met. |
| 2026-10-21 | Refactored `modules/auth/` to the per-module file rules (Phase 0.5 spec); added `409 EMAIL_TAKEN` and central database error translation (P0.14); removed the unused `CSRF_FAILED` and `TOO_MANY_ATTEMPTS` codes. | Owner's direction, before step 0.4. |
| 2026-10-21 | Step 0.4 implemented and verified: `writeAuditEntry(tx, entry)` with an explicit `tenantId`; audit types in `src/audit/audit.types.ts`. | Acceptance criteria met. |
| 2026-10-21 | Step 0.5 implemented and verified (P0.15-P0.17); phase status set to `Implemented`. | All steps meet their acceptance criteria. |
| 2026-10-21 | Post-implementation refactor (owner): added `users.user_name` (P0.20) to the baseline migration; access-token payload `{sub, iss, iat, exp, username, email, role, tenant}` (P0.18, P0.19); auth responses return `userName` and `tenant` instead of `tenantId`/`tenantRole`; each module's routes file composes its layers; every module type ends in `Type`. | Owner's direction. |
