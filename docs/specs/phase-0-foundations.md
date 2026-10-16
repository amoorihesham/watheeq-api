# Phase 0 Spec: Technical Foundations

| Field                  | Value                             |
| ---------------------- | --------------------------------- |
| **Status**             | Approved                          |
| **Approved by / date** | _Amr - 17/10/2026 at 01:56 am_    |
| **Depends on**         | None                              |
| **Related decisions**  | MVP 3.9 (audit); Technical T1-T10 |

---

## 1. Objective

Build the base every later phase stands on: a running, tested application in which tenant data cannot leak between tenants, every business change is audited in the same transaction, and operators and tenant users can log in through separate realms.
These concerns are needed first because retrofitting isolation, audit, or authentication into existing features is where data leaks and silent gaps come from.

## 2. Scope

**In scope:**

- Project skeleton: Node 24 LTS, pnpm, strict TypeScript (ESM), Express 5, Biome, Vitest, PostgreSQL 18 in Docker, `GET /health`.
- Cross-cutting basics: validated startup configuration, standard error format, request IDs, structured logging, graceful shutdown.
- Database foundation: database roles, migrations, Drizzle, the tenant-context transaction helper, and Row-Level Security (RLS) on tenant-owned tables.
- Minimal `tenants`, `users`, and `operators` tables, containing only the columns Phase 0 needs.
- Audit mechanism: append-only audit table and a helper that writes inside the business transaction.
- Authentication: operator and tenant user login, logout, current-session endpoint, server-side sessions in PostgreSQL, CSRF protection, login throttling.
- A command-line tool to create the first platform operator.

**Out of scope (and where it is handled instead):**

- Creating tenants and the first Tenant Admin through the API, and how operators access tenant data across tenants: Phase 1.
- Subscription states and their effect on sessions (for example, read-only tenants): Phase 1.
- Creating, editing, and deactivating users through the API; org membership: Phase 2.
- Permissions, roles, and authorization checks beyond "is logged in to this realm": Phase 3.
- Auditing operator and platform-level actions (audit rows without a tenant): Phase 1.
- Password reset and password change flows: deferred (no email channel in the MVP, D10). To be scheduled in Phase 2.
- Application Docker image, CI pipeline, and hosting: added when the hosting provider is decided (deferred technical decision).
- MFA and SSO: after the MVP.

## 3. Requirements

Example tenants used throughout: **Al-Noor** and **Al-Rashid**.
Example people: **Sara**, Tenant Admin at Al-Noor; **Khalid**, a user at Al-Rashid; **Omar**, a platform operator.

| ID    | Requirement                                                                                                                                               | Example                                                                                                                                                                                                                                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0.1  | The service exposes a health endpoint that reports database connectivity.                                                                                 | _The hosting load balancer calls `GET /health`. With PostgreSQL up it gets 200; with PostgreSQL down it gets 503 and stops routing traffic to that instance._                                                                                                                                                                                                          |
| R0.2  | A fresh clone can install and run the full test suite with one command, given Node and Docker.                                                            | _A new developer runs `pnpm install --frozen-lockfile && pnpm test` and every test passes without starting anything by hand; Testcontainers starts the test database._                                                                                                                                                                                                 |
| R0.3  | The application refuses to start when required configuration is missing or invalid, and names the offending keys without printing their values.           | _`DATABASE_URL` is unset: the process exits with code 1 and logs `Invalid configuration: DATABASE_URL (Required)`._                                                                                                                                                                                                                                                    |
| R0.4  | Every error response uses one standard JSON shape that includes the request ID.                                                                           | _A call to `GET /no-such-route` returns 404 with `{"error":{"code":"NOT_FOUND",...,"requestId":"..."}}`._                                                                                                                                                                                                                                                              |
| R0.5  | Every request gets a request ID. It is returned in the `X-Request-Id` response header and attached to every log line written for that request.            | _Sara reports an error and quotes the request ID; support finds every log line of that request by searching for it._                                                                                                                                                                                                                                                   |
| R0.6  | Unexpected errors return 500 without leaking internal details, and are logged with their stack trace.                                                     | _A bug throws `TypeError` in a handler: the client sees `{"error":{"code":"INTERNAL",...}}`, the log has the stack._                                                                                                                                                                                                                                                   |
| R0.7  | Tenant-owned data is isolated by the database itself: with tenant A's context set, a query that omits any tenant filter returns no rows of tenant B.      | _A future bug writes `SELECT * FROM users` without `WHERE tenant_id = ...` in Al-Noor's context; the result contains only Al-Noor users._                                                                                                                                                                                                                              |
| R0.8  | Querying tenant-owned data without a tenant context fails with an error instead of returning rows.                                                        | _Code forgets to open a tenant transaction and queries `users`; the query raises an error, it does not return all users or silently return none._                                                                                                                                                                                                                      |
| R0.9  | Every audit entry is written in the same transaction as the change it describes.                                                                          | _A change to Sara's account and its audit entry either both commit or both roll back. A rolled-back change leaves no audit row._                                                                                                                                                                                                                                       |
| R0.10 | The application cannot update or delete audit entries.                                                                                                    | _Even a buggy or compromised code path running `DELETE FROM audit_log` is rejected by the database._                                                                                                                                                                                                                                                                   |
| R0.11 | Operators and tenant users log in through separate endpoints with email and password. A wrong email or wrong password is rejected with the same response. | _Sara posts a wrong password to `/auth/login` and gets 401 `INVALID_CREDENTIALS`; posting an email that does not exist gives the identical response._                                                                                                                                                                                                                  |
| R0.12 | A successful login creates a server-side session and sets an httpOnly, Secure cookie. Logout ends the session immediately.                                | _Sara logs out; replaying her old cookie on the next call returns 401._                                                                                                                                                                                                                                                                                                |
| R0.13 | A session that is revoked, expired, or belongs to a deactivated account is rejected on the very next call.                                                | _Khalid is deactivated while logged in; his next request returns 401 without waiting for any expiry._                                                                                                                                                                                                                                                                  |
| R0.14 | Sessions are bound to their realm. A tenant session never authenticates on operator routes, and an operator session never authenticates on tenant routes. | _Sara's tenant cookie sent to `GET /operator/auth/session` returns 401._                                                                                                                                                                                                                                                                                               |
| R0.15 | State-changing requests made with a session require a valid CSRF token.                                                                                   | _A malicious site makes Sara's browser POST to `/auth/logout`; the request lacks the CSRF token and is rejected with 403._                                                                                                                                                                                                                                             |
| R0.16 | Failed logins are throttled per account and per client IP address.                                                                                        | _An attacker tries 50 passwords for Sara's email from many IPs: after 5 failures her account is locked for 15 minutes, even for the right password. An attacker tries one password against 2,000 emails from one IP: after 100 failures in 15 minutes that IP is blocked. Al-Noor's 40 employees sharing one office IP never reach that limit through ordinary typos._ |
| R0.17 | The first platform operator can be created without any existing operator, and without an HTTP endpoint.                                                   | _During setup, the deployer runs `pnpm operator:create` and Omar can then log in at `/operator/auth/login`._                                                                                                                                                                                                                                                           |

## 4. Design

### 4.1 Data model

#### Database roles

The application must not be able to bypass RLS.
PostgreSQL skips RLS for superusers, for roles with `BYPASSRLS`, and for a table's owner unless the table uses `FORCE ROW LEVEL SECURITY`.
So the runtime connection uses a role that is none of these.

| Role            | Used by                 | Privileges                                                                                |
| --------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `watheeq_owner` | Migrations only         | Owns the schema and all tables, functions, and policies.                                  |
| `watheeq_app`   | The running application | `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`. Only the table privileges granted per table below. |

Roles are cluster-level objects, and managed PostgreSQL offerings often restrict who can create them.
So roles are created by a one-time bootstrap SQL script (`db/bootstrap/roles.sql`), run by the database administrator, the Docker init hook, and the test setup.
Migrations assume the roles exist and only issue grants on objects they own.
All tenant-owned tables also use `FORCE ROW LEVEL SECURITY`, as a second safeguard in case the owner role is ever used by mistake.

#### Tenant context

The current tenant is held in a transaction-local PostgreSQL setting, `app.tenant_id`.
A SQL function reads it and fails loudly when it is missing:

```sql
CREATE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v text := current_setting('app.tenant_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'tenant context is not set' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v::uuid;
END $$;
```

Every RLS policy compares against `app_current_tenant()`.
This is what makes R0.8 hold: without a context, the policy raises an error instead of matching nothing.

Why the explicit check: after one transaction has set `app.tenant_id`, PostgreSQL keeps the setting defined as an empty string on that pooled connection.
Without the check, the behavior of a later context-less query would depend on which connection it happened to get.

#### Tables

**`tenants`**: the anchor for tenant isolation. Phase 1 adds subscription-related columns.

| Column       | Type          | Notes                      |
| ------------ | ------------- | -------------------------- |
| `id`         | `uuid` PK     | Generated by the database. |
| `name`       | `text`        | Not null.                  |
| `created_at` | `timestamptz` | Default `now()`.           |

RLS: `SELECT` only where `id = app_current_tenant()`.
`watheeq_app` has `SELECT` only; Phase 1 defines how tenants are created.

**`users`**: tenant users. Phase 2 adds names, org unit, role, and management endpoints.

| Column               | Type          | Notes                                                                                    |
| -------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `id`                 | `uuid` PK     |                                                                                          |
| `tenant_id`          | `uuid`        | FK to `tenants`, not null.                                                               |
| `email`              | `text`        | Lowercased and trimmed, enforced by the check constraint `email = lower(btrim(email))`. Unique across the platform (T7): unique index on `email`. |
| `password_hash`      | `text`        | argon2id encoded hash.                                                                   |
| `is_active`          | `boolean`     | Default `true`.                                                                          |
| `failed_login_count` | `integer`     | Default 0. Used by login throttling.                                                     |
| `locked_until`       | `timestamptz` | Null unless throttled.                                                                   |
| `created_at`         | `timestamptz` |                                                                                          |

RLS: `tenant_id = app_current_tenant()` for `SELECT`, `INSERT`, `UPDATE`.
`watheeq_app` has `SELECT`, `INSERT`, `UPDATE`; no `DELETE`.
Index on `tenant_id`, since every RLS check filters on it.

**`user_sessions`**: tenant user sessions.

| Column             | Type          | Notes                                                  |
| ------------------ | ------------- | ------------------------------------------------------ |
| `id`               | `uuid` PK     |                                                        |
| `tenant_id`        | `uuid`        | Not null. Same tenant as the user.                     |
| `user_id`          | `uuid`        | FK to `users`.                                         |
| `token_hash`       | `bytea`       | SHA-256 of the session token. Unique.                  |
| `csrf_token_hash`  | `bytea`       | SHA-256 of the CSRF token.                             |
| `created_at`       | `timestamptz` |                                                        |
| `last_seen_at`     | `timestamptz` | Used for the idle timeout.                             |
| `expires_at`       | `timestamptz` | Absolute expiry.                                       |
| `revoked_at`       | `timestamptz` | Null while valid.                                      |
| `user_agent`, `ip` | `text`        | For future "active sessions" views and investigations. |

RLS: `tenant_id = app_current_tenant()`.

**`operators`** and **`operator_sessions`**: same shape as `users` and `user_sessions` without `tenant_id`.
They are platform tables, not tenant-owned, so they have no RLS.
They are reached only by the operator realm code (T6).
`watheeq_app` has `SELECT`, `UPDATE` on `operators` (no `INSERT`, no `DELETE`) and `SELECT`, `INSERT`, `UPDATE` on `operator_sessions`.
So even an attacker who takes over the running application cannot create an operator account for themselves.
Operators are created only by `pnpm operator:create`, which connects as `watheeq_owner` through `MIGRATION_DATABASE_URL`.

Only hashes of tokens are stored.
If the database or a backup leaks, the stored values cannot be replayed as cookies.

**`audit_log`**:

| Column          | Type                 | Notes                                                                       |
| --------------- | -------------------- | --------------------------------------------------------------------------- |
| `id`            | `bigint` identity PK |                                                                             |
| `tenant_id`     | `uuid`               | Not null in Phase 0. Phase 1 decides how platform-level entries are stored. |
| `occurred_at`   | `timestamptz`        | Default `now()`, which is the transaction start time.                       |
| `actor_type`    | `text`               | `user`, `operator`, or `system`. Check constraint.                          |
| `actor_id`      | `uuid`               | Null only for `system`.                                                     |
| `action`        | `text`               | Dotted name, for example `user.deactivated`.                                |
| `resource_type` | `text`               | For example `user`.                                                         |
| `resource_id`   | `text`               |                                                                             |
| `reason`        | `text`               | Nullable.                                                                   |
| `details`       | `jsonb`              | Nullable. Before/after values where useful.                                 |
| `request_id`    | `text`               | Links the entry to logs.                                                    |

RLS: `INSERT` and `SELECT` where `tenant_id = app_current_tenant()`.
`watheeq_app` is granted `INSERT` and `SELECT` only.
Without `UPDATE` or `DELETE` privileges and without policies for them, the database rejects both (R0.10).

**`login_ip_throttle`**: failed login attempts per client IP, shared by both realms.

| Column              | Type          | Notes                                                            |
| ------------------- | ------------- | ---------------------------------------------------------------- |
| `ip`                | `inet` PK     | Client IP as resolved under the trusted proxy setting (see 4.3). |
| `failed_count`      | `integer`     | Failures within the current window.                              |
| `window_started_at` | `timestamptz` | Start of the current 15-minute window.                           |

This is platform-level security data, not tenant data, so it has no RLS.
`watheeq_app` has `SELECT`, `INSERT`, `UPDATE`.
Rows for old windows are harmless and are reset on the next failure from that IP; a periodic cleanup is added with the Phase 7 job runner.

Why PostgreSQL and not Redis: login failures are a few writes per minute platform-wide, every application instance already shares PostgreSQL, and Redis would add a second datastore to host in KSA, operate, and run in tests.
Revisit if rate limiting extends to all endpoints.

#### Pre-context lookups

Two lookups must happen before the tenant is known:

1. Login: Sara types her email; we must find her user row to learn her tenant (T7).
2. Every request: the cookie carries only a token; we must find the session to learn the tenant.

Under RLS, both queries would fail because no tenant context exists yet.
They go through two narrow `SECURITY DEFINER` functions owned by `watheeq_owner`, which run with the owner's rights:

- `auth_find_user_for_login(email)` returns `id, tenant_id, password_hash, is_active, failed_login_count, locked_until` for one email.
- `auth_resolve_user_session(token_hash)` returns the session and user if the session is valid: not revoked, not expired, idle timeout not exceeded, user active.

Both pin `search_path`, revoke `EXECUTE` from `PUBLIC`, and grant it only to `watheeq_app`.
Everything after these lookups runs inside a normal tenant transaction.

Alternative considered: keep sessions and a login email index in tables without RLS.
Rejected, because it creates tenant-related tables that the database does not protect, and those exceptions tend to grow.

#### Migrations

Drizzle schema files define tables.
Drizzle Kit generates SQL migration files, which are committed and reviewed.
RLS policies, grants, and the functions above are written as hand-authored SQL migrations, so their exact SQL is visible in review.
Migrations run as `watheeq_owner` via the Drizzle migrator, never at application startup.

_To verify in step 0.3:_ how Drizzle Kit's built-in RLS and policy support interacts with hand-written policy migrations; if both would fight over the same policies, we use only one of them.

### 4.2 API

| Method | Path                     | Realm    | Permission     | Request             | Responses                                                                                                                         |
| ------ | ------------------------ | -------- | -------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                | none     | none           | none                | 200 `{status:"ok",db:"up"}`; 503 `{status:"error",db:"down"}`                                                                     |
| POST   | `/auth/login`            | tenant   | none           | `{email, password}` | 200 `{user:{id,email,tenantId}, csrfToken}` + cookie; 400 `VALIDATION_FAILED`; 401 `INVALID_CREDENTIALS`; 429 `TOO_MANY_ATTEMPTS` |
| POST   | `/auth/logout`           | tenant   | session + CSRF | none                | 204, cookie cleared; 403 `CSRF_FAILED`                                                                                            |
| GET    | `/auth/session`          | tenant   | session        | none                | 200 `{user:{...}, csrfToken}`; 401 `UNAUTHENTICATED`                                                                              |
| POST   | `/operator/auth/login`   | operator | none           | `{email, password}` | Same as tenant login, with `operator` instead of `user`.                                                                          |
| POST   | `/operator/auth/logout`  | operator | session + CSRF | none                | Same as tenant logout.                                                                                                            |
| GET    | `/operator/auth/session` | operator | session        | none                | Same as tenant session.                                                                                                           |

`GET /auth/session` returns the CSRF token so that the browser app can recover it after a page reload, since the app keeps it only in memory.

#### Standard error shape

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "requestId": "8f2c...",
    "details": [{ "path": "email", "code": "invalid_string" }]
  }
}
```

| HTTP | Code                     | When                                                  |
| ---- | ------------------------ | ----------------------------------------------------- |
| 400  | `VALIDATION_FAILED`      | zod validation failed, or malformed JSON body.        |
| 401  | `UNAUTHENTICATED`        | No valid session for this realm.                      |
| 401  | `INVALID_CREDENTIALS`    | Login failed.                                         |
| 403  | `CSRF_FAILED`            | Missing or wrong CSRF token.                          |
| 404  | `NOT_FOUND`              | Unknown route or resource.                            |
| 413  | `PAYLOAD_TOO_LARGE`      | Body exceeds the limit (100 KB).                      |
| 415  | `UNSUPPORTED_MEDIA_TYPE` | Body sent without `Content-Type: application/json`.   |
| 429  | `TOO_MANY_ATTEMPTS`      | Login throttled.                                      |
| 500  | `INTERNAL`               | Anything unexpected. No internal details in the body. |

The response carries no human-readable `message`.
The client maps `code` (and each detail's `code`) to text in the user's language, which matters for an Arabic and English interface.
Server-side context for debugging goes to the log, found through `requestId`.

`details` appears only for validation errors.
Each detail has the field `path` and a machine-readable `code` taken from the zod issue.
Later phases add codes (for example `FORBIDDEN`, `CONFLICT`) to this table's successor in their own specs.

#### Cookies

| Realm    | Cookie name          | Flags                                          |
| -------- | -------------------- | ---------------------------------------------- |
| Tenant   | `__Host-wq_session`  | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` |
| Operator | `__Host-wq_operator` | Same                                           |

The `__Host-` prefix makes the browser refuse the cookie unless it is Secure, has `Path=/`, and has no `Domain`, so a sibling subdomain cannot overwrite it.
Browsers treat `http://localhost` as a secure context, so this also works in local development.

### 4.3 Key flows and state transitions

#### Tenant transaction helper

```ts
await withTenantTx(tenantId, async (tx) => {
  // 1. BEGIN
  // 2. SELECT set_config('app.tenant_id', $1, true)   -- true = transaction-local
  // 3. run the callback's queries
  // 4. COMMIT, or ROLLBACK if the callback throws
});
```

`set_config(..., true)` is the parameterized form of `SET LOCAL`, so the tenant ID is passed as a bind parameter and never concatenated into SQL.
Because the setting is transaction-local, it disappears at `COMMIT` or `ROLLBACK`, and the next transaction on that pooled connection starts without a tenant.

#### Audit helper

```ts
await withTenantTx(tenantId, async (tx) => {
  await tx.update(users).set({ isActive: false }).where(eq(users.id, khalidId));
  await audit(tx, ctx, {
    action: "user.deactivated",
    resourceType: "user",
    resourceId: khalidId,
    reason: "Left the company",
  });
});
```

`audit` accepts only a tenant transaction object, so it cannot be called outside a transaction.
`ctx` carries the actor and request ID from the request, and the tenant ID comes from the transaction's context setting, so callers cannot record a mismatched tenant.

#### Tenant login

1. Validate the body with zod. Normalize the email (trim, lowercase).
2. If the client IP has 100 or more failures in its current 15-minute window, return 429 `TOO_MANY_ATTEMPTS`.
3. Call `auth_find_user_for_login(email)`.
4. If no user is found, verify the password against a fixed dummy hash anyway, then return 401 `INVALID_CREDENTIALS`. This keeps response time similar, so timing does not reveal which emails exist.
5. If `locked_until` is in the future, return 429 `TOO_MANY_ATTEMPTS` without checking the password.
6. Verify the password with argon2id.
   - Wrong: in a tenant transaction, increment `failed_login_count`; at 5, set `locked_until` to 15 minutes ahead and reset the count. Return 401.
   - Right but `is_active = false`: return 401 `INVALID_CREDENTIALS`.
   - Right and active: continue.
7. In a tenant transaction: reset `failed_login_count`, revoke the session from the presented cookie if there is one, and insert a new `user_sessions` row.
8. Set the cookie and return the user and the CSRF token.

Every 401 from login also increments the IP counter with one atomic upsert, which starts a new window when the current one is older than 15 minutes.
A successful login does **not** reset the IP counter; otherwise an attacker could interleave logins to their own valid account to keep the counter low.
Thresholds (5 per account, 100 per IP, 15-minute windows) come from configuration with these defaults.

A new session token is issued on every login, so a token planted before login (session fixation) is never upgraded to a logged-in session.

Operator login follows the same flow against `operators` and `operator_sessions`, without tenant transactions.

#### Request authentication

1. Tenant routes read only `__Host-wq_session`; operator routes read only `__Host-wq_operator`.
2. Hash the token and resolve it (`auth_resolve_user_session` for tenants, a direct query for operators).
3. If nothing valid is found, return 401 `UNAUTHENTICATED`.
4. If `last_seen_at` is older than one minute, update it. This bounds session writes to about one per minute per active user, instead of one per request.
5. For `POST`, `PUT`, `PATCH`, and `DELETE`: compare the SHA-256 of the `X-CSRF-Token` header with `csrf_token_hash` using a constant-time comparison. Mismatch or missing: 403 `CSRF_FAILED`.
6. Attach the principal and tenant ID to the request context.

Realm separation (R0.14) holds by construction.
The operator middleware never reads the tenant cookie and never queries `user_sessions`, so Sara's session token has nothing to match on operator routes.

#### Session lifetime

| Realm    | Idle timeout | Absolute lifetime |
| -------- | ------------ | ----------------- |
| Tenant   | 2 hours      | 12 hours          |
| Operator | 30 minutes   | 8 hours           |

Values come from configuration, with these defaults.

#### Deployment topology and client IP

The browser app and the API are served from the **same origin**, for example `https://watheeq.com.sa/` for the app and `https://watheeq.com.sa/api/...` for the API, behind one reverse proxy.
The proxy forwards `/api/*` to this backend with the `/api` prefix removed, so backend paths stay as listed in 4.2.
The API sends no CORS headers, and browsers therefore refuse cross-origin reads of its responses.

Behind a proxy, every request reaches Express from the proxy's address.
If the IP throttle used that address, all of Al-Noor's and Al-Rashid's users would share one counter and block each other.
If Express trusted any `X-Forwarded-For` header, an attacker could send a fake IP with each attempt and never be throttled.
So Express's `trust proxy` setting comes from configuration (`TRUST_PROXY`, the number of proxy hops in front of the app), and the client IP is taken only from hops added by trusted proxies.

#### Login CSRF

Before login there is no session and so no CSRF token.
Login is protected differently: every endpoint that takes a body requires `Content-Type: application/json`.
A cross-site HTML form cannot send that content type, and a cross-site script cannot send it without a CORS preflight, which the API rejects because it sends no CORS headers.
`SameSite=Lax` cookies add a second layer.

#### Startup and shutdown

1. Load and validate configuration; exit with code 1 on failure (R0.3).
2. Create the database pool and the Express app; listen on `PORT`.
3. On `SIGTERM` or `SIGINT`: stop accepting connections, let in-flight requests finish (up to a timeout), close the pool, exit.

### 4.4 Module structure

```
src/
  main.ts                 startup and shutdown
  app.ts                  buildApp(deps): assembles middleware and routes
  config/                 zod schema for environment variables
  http/                   error class, error handler, not-found, request ID, validation helper
  logging/                pino setup and redaction rules
  db/
    pool.ts               pg pool and Drizzle instance
    tenant-tx.ts          withTenantTx
    schema/               Drizzle table definitions
  audit/                  audit(tx, ctx, entry)
  auth/
    shared/               passwords, tokens, cookies, CSRF, throttling, session lookup
    tenant/               /auth routes and middleware
    operator/             /operator/auth routes and middleware
  health/                 /health route
  cli/
    create-operator.ts    pnpm operator:create
db/
  bootstrap/roles.sql     one-time role creation
  migrations/             generated and hand-written SQL migrations
test/
  setup/                  container startup, migrations, fixtures
```

Modules depend on `db`, `http`, `logging`, and `config`; nothing depends on `auth` except route wiring.
`buildApp` receives its dependencies (pool, config, logger), so tests build an app against the test database without global state.

## 5. Edge Cases and Failure Behavior

| Scenario                                                                                                                                           | Expected behavior                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A transaction for Al-Noor commits on pooled connection #3. The next transaction on #3 is for code that forgot to set a tenant and queries `users`. | `app.tenant_id` was transaction-local and is now empty; `app_current_tenant()` raises; the query fails (R0.8).                                |
| Code sets Al-Noor's context and queries `users` without a `tenant_id` filter, while Al-Rashid's users exist.                                       | RLS filters to Al-Noor rows only (R0.7).                                                                                                      |
| Code in Al-Noor's context tries to `INSERT` a user with Al-Rashid's `tenant_id`.                                                                   | The policy's `WITH CHECK` rejects the row.                                                                                                    |
| The business update succeeds, then the audit insert fails (for example, a constraint violation).                                                   | The whole transaction rolls back; neither the change nor the audit row exists (R0.9).                                                         |
| The audit insert succeeds, then the callback throws.                                                                                               | Rollback; no audit row remains.                                                                                                               |
| Sara logs in, then is deactivated directly in the database, then makes a request.                                                                  | `auth_resolve_user_session` checks `is_active`; 401 on that request (R0.13).                                                                  |
| Sara's session was idle for 2 hours and 1 minute.                                                                                                  | Rejected with 401.                                                                                                                            |
| Two browser tabs log in as Sara at the same time.                                                                                                  | Two independent sessions; both are valid.                                                                                                     |
| Sara's tenant cookie value is copied into the operator cookie name and sent to `/operator/auth/session`.                                           | Hashed token not found in `operator_sessions`; 401 (R0.14).                                                                                   |
| An attacker sends 50 wrong passwords for Sara's email, from many IP addresses.                                                                     | The per-account counter is stored in `users`, so it holds across IPs and application instances. After 5 failures, 429 for 15 minutes (R0.16). |
| An attacker tries one password against 2,000 emails from one IP (password spraying).                                                               | No single account reaches 5 failures, but the IP counter reaches 100 and that IP gets 429 for the rest of its window (R0.16).                 |
| 40 Al-Noor employees log in from one office IP on Sunday morning, a few with typos.                                                                | A handful of failures stays far below 100; nobody is blocked.                                                                                 |
| An attacker sends `X-Forwarded-For: 1.2.3.4` with a different fake IP on every attempt.                                                            | Express only trusts hops added by the configured proxies, so the attacker's real IP is counted.                                               |
| Two wrong-password requests for Sara arrive at the same moment.                                                                                    | `failed_login_count = failed_login_count + 1` is a single atomic update, so neither increment is lost.                                        |
| PostgreSQL is down at startup.                                                                                                                     | The app starts (config is valid) and `/health` returns 503. It does not crash-loop, so the host can see the failing health check.             |
| PostgreSQL goes down while the app runs.                                                                                                           | `/health` returns 503 within its 2-second check timeout; other requests fail with 500 `INTERNAL`.                                             |
| A client sends `X-Request-Id: <script>...` or a 10 KB value.                                                                                       | Values not matching `^[A-Za-z0-9._-]{1,64}$` are ignored and a new ID is generated, so log content is never attacker-shaped.                  |
| A request body is malformed JSON.                                                                                                                  | 400 `VALIDATION_FAILED` in the standard shape, not Express's default HTML error.                                                              |
| A login password field is 1 MB long.                                                                                                               | The body limit returns 413; a password above 256 characters returns 400, before any hashing work.                                             |
| A user with a mixed-case email, `Sara@AlNoor.sa`, logs in as `sara@alnoor.sa`.                                                                     | Emails are normalized on write and on lookup; login succeeds.                                                                                 |

## 6. Security and Authorization

- **Trust boundaries:** every request body, query, header, and cookie is untrusted. Bodies are validated with zod at the route before any logic runs. Configuration is validated at startup.
- **Tenant isolation:** enforced by PostgreSQL RLS with a non-owner, non-bypass runtime role, `FORCE ROW LEVEL SECURITY`, and a context function that fails when unset. Application-level `tenant_id` filters are still written, as clarity, but are not relied on.
- **Pre-context lookups:** limited to two `SECURITY DEFINER` functions with pinned `search_path` and narrow return values.
- **Passwords:** argon2id with OWASP-recommended minimum parameters (19 MiB memory, 2 iterations, 1 lane). Hashes are never logged or returned.
- **Sessions:** 256-bit random tokens; only SHA-256 hashes stored; httpOnly, Secure, `SameSite=Lax`, `__Host-` cookies; idle and absolute expiry; immediate revocation.
- **CSRF:** a per-session token (synchronizer token pattern) on unsafe methods; JSON-only bodies for login.
- **Enumeration:** identical responses and similar timing for unknown email, wrong password, and inactive account.
- **Logging:** pino redacts `password`, `cookie`, `set-cookie`, `x-csrf-token`, and `authorization` fields. Logs never contain request bodies of auth routes.
- **Data residency:** logs go to stdout only. No third-party log or error service in Phase 0.
- **Audit:** Phase 0 delivers the mechanism. Logins and logouts are written to the application log, not to the audit table, since the MVP audit list (3.9) covers business actions. Operator actions are audited from Phase 1.

## 7. Implementation Steps

| Step                            | Objective                                                                                  | Delivers                                                                                                                                                                                          | Acceptance criteria                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Verification                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.1 Skeleton                    | Prove the toolchain end to end.                                                            | Node 24 LTS, pnpm, strict TypeScript, ESM, `tsx` for development, tsup for builds, Express 5, Biome, Vitest, Docker Compose PostgreSQL 18 for local dev, Testcontainers for tests, `GET /health`. | `GET /health` returns 200 with `db:"up"` against a real DB, and 503 with `db:"down"` when the DB is unreachable. `pnpm install --frozen-lockfile && pnpm test` passes on a fresh clone with only Node, pnpm, and Docker installed. `pnpm lint` (Biome), `pnpm typecheck`, and `pnpm build` pass.                                                                                                                                                                     | Integration tests for both health outcomes; a fresh-clone run in a clean directory.                                                              |
| 0.2 Cross-cutting basics        | Make every later endpoint consistent and observable.                                       | Config validation, error class and handler, standard error shape, not-found handler, JSON-only and body-size guards, request IDs, pino logging with redaction, graceful shutdown.                 | The app exits with code 1 and names the missing keys when config is invalid. An unknown route returns 404 in the standard shape. Malformed JSON returns 400 in the standard shape. A thrown error returns 500 `INTERNAL` with no stack in the body. Log lines carry the request ID, which matches the `X-Request-Id` response header.                                                                                                                                | Unit tests for config parsing; integration tests for each error case; a test capturing log output and checking the request ID.                   |
| 0.3 Tenant isolation            | Prove that the database enforces tenant isolation.                                         | Bootstrap roles script, Drizzle setup, migrations for `tenants` and `users`, `app_current_tenant()`, RLS policies, `withTenantTx`.                                                                | With Al-Noor's context, `SELECT * FROM users` returns only Al-Noor rows. Without a context, the query fails. Inserting an Al-Rashid row in Al-Noor's context fails. After a transaction ends, the same pooled connection has no tenant context. The app connects as `watheeq_app`, which is not the owner and lacks `BYPASSRLS`.                                                                                                                                     | Integration tests for each criterion, including one forcing reuse of a single pooled connection; a test asserting the runtime role's attributes. |
| 0.4 Audit                       | Make audit entries impossible to lose or rewrite.                                          | `audit_log` migration, grants, RLS, `audit()` helper.                                                                                                                                             | A committed change leaves exactly one audit row with the correct actor, tenant, action, and request ID. A rolled-back change leaves none. `UPDATE` and `DELETE` on `audit_log` as `watheeq_app` fail. Al-Noor's context cannot read Al-Rashid's audit rows.                                                                                                                                                                                                          | Integration tests for each criterion.                                                                                                            |
| 0.5 Sessions and operator realm | Deliver the shared session machinery, proven on the simpler realm.                         | `operators`, `operator_sessions`, password hashing, token handling, cookies, CSRF, operator login/logout/session endpoints, `operator:create` CLI.                                                | Omar, created by the CLI, can log in and call `GET /operator/auth/session`. A wrong password and an unknown email give identical 401 responses. After logout, the old cookie is rejected. A revoked, expired, or idle-expired session is rejected. A deactivated operator's session is rejected on the next call. Logout without a CSRF token returns 403. The cookie has the required flags.                                                                        | Integration tests for each criterion; a CLI test against the test database.                                                                      |
| 0.6 Tenant realm                | Deliver tenant login on top of the shared machinery, with realm separation and throttling. | `user_sessions`, pre-context `SECURITY DEFINER` functions, tenant login/logout/session endpoints, per-account and per-IP login throttling for both realms, `TRUST_PROXY` handling.                | Sara can log in, call `GET /auth/session`, and log out. Every 0.5 session criterion also holds for tenant users. A tenant cookie on operator routes returns 401, and vice versa. A tenant session only ever sees its own tenant's data. After 5 failures for one account, login returns 429 for 15 minutes even with the right password. After 100 failures from one IP in 15 minutes, that IP gets 429. A spoofed `X-Forwarded-For` does not change the counted IP. | Integration tests for each criterion, reusing 0.5's session test cases for the tenant realm.                                                     |

## 8. Test Plan

All integration tests run against a real PostgreSQL instance, migrated from scratch, connected as `watheeq_app` exactly like production.
Unit tests cover pure logic only.

| Requirement | Test type                                                                                                                                                                              | Covered in step |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| R0.1        | Integration: DB up and DB unreachable.                                                                                                                                                 | 0.1             |
| R0.2        | Manual check: fresh clone in a clean directory.                                                                                                                                        | 0.1             |
| R0.3        | Unit: config schema. Integration: start the process with missing variables and assert exit code and message.                                                                           | 0.2             |
| R0.4, R0.6  | Integration: unknown route, malformed JSON, oversized body, wrong content type, thrown error.                                                                                          | 0.2             |
| R0.5        | Integration: header present, incoming valid ID echoed, invalid ID replaced, log line carries ID.                                                                                       | 0.2             |
| R0.7, R0.8  | Integration: two tenants seeded; queries with context, without context, and on a reused connection.                                                                                    | 0.3             |
| R0.9, R0.10 | Integration: commit, rollback, update, and delete attempts on `audit_log`.                                                                                                             | 0.4             |
| R0.11-R0.15 | Integration per realm: login success and failure, logout, revoked, expired, idle, deactivated, cross-realm cookies, CSRF.                                                              | 0.5, 0.6        |
| R0.16       | Integration: account threshold and cooldown, IP threshold and window reset, concurrent failures, success resets the account counter but not the IP counter, spoofed `X-Forwarded-For`. | 0.6             |
| R0.17       | Integration: CLI creates an operator who can then log in.                                                                                                                              | 0.5             |

Time-dependent cases (idle timeout, expiry, cooldown) are tested by setting timestamps in the database, not by waiting.

## 9. Open Questions

| #   | Question                                                        | Options                                                                                                                                   | Resolution                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | How does the test suite get a database on a fresh clone?        | (a) Testcontainers. (b) Docker Compose database started by hand.                                                                          | **Resolved 2026-10-17: (a) Testcontainers.**                                                                                                                                                                                   |
| Q2  | Node version, package manager, module system, and build tool.   | Owner chose tsup; tsup's README states it is no longer actively maintained and points to tsdown. Alternatives were plain `tsc` or tsdown. | **Resolved 2026-10-17:** Node 24 LTS, pnpm, ESM, `tsx` for development, **tsup** for builds, accepting the maintenance risk. Revisit (tsdown is the documented migration path) if tsup breaks on a Node or TypeScript upgrade. |
| Q3  | Lint and formatting tools.                                      | ESLint + Prettier, or Biome.                                                                                                              | **Resolved 2026-10-17: Biome.**                                                                                                                                                                                                |
| Q4  | PostgreSQL version.                                             | 17 or 18.                                                                                                                                 | **Resolved 2026-10-17: PostgreSQL 18.** Confirm the chosen KSA hosting provider offers 18 when hosting is decided.                                                                                                             |
| Q5  | Login throttling policy, and whether Redis is needed.           | (a) per-account lock only; (b) per-IP limit only; (c) both.                                                                               | **Resolved 2026-10-17: (c)** per-account lock (5 failures, 15 minutes) plus a generous per-IP limit (100 failures per 15 minutes), both in PostgreSQL. No Redis.                                                               |
| Q6  | Session lifetimes.                                              | Shorter or longer idle timeouts.                                                                                                          | **Resolved 2026-10-17:** tenant 2 h idle / 12 h absolute; operator 30 min idle / 8 h absolute; configurable.                                                                                                                   |
| Q7  | Where will the browser app be served from, relative to the API? | (a) same origin; (b) same site, different subdomains; (c) different sites.                                                                | **Resolved 2026-10-17: (a) same origin**, API under `/api` behind one reverse proxy, no CORS.                                                                                                                                  |
| Q8  | Is creating the first operator through a CLI acceptable?        | CLI, migration seed, or bootstrap endpoint.                                                                                               | **Resolved 2026-10-17: CLI**, `pnpm operator:create`, reading the password from an interactive prompt or an environment variable, never from command-line arguments (which end up in shell history).                           |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #     | Decision                                                                                                                           | Rationale                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| P0.1  | Runtime role `watheeq_app` is not the table owner, has no `BYPASSRLS`, and all tenant tables use `FORCE ROW LEVEL SECURITY`.       | RLS is otherwise silently skipped for owners and superusers.                                                           |
| P0.2  | Tenant context is a transaction-local setting read by `app_current_tenant()`, which raises when unset.                             | Makes a missing context an error rather than an empty or wrong result, independent of pooled connection history.       |
| P0.3  | Pre-context lookups (login by email, session by token) use two narrow `SECURITY DEFINER` functions.                                | Keeps all tenant-related tables under RLS while allowing the two unavoidable lookups.                                  |
| P0.4  | Separate `users`/`user_sessions` and `operators`/`operator_sessions` tables and separate cookies.                                  | Applies T6 to sessions; realm separation holds by construction.                                                        |
| P0.5  | Store only SHA-256 hashes of session and CSRF tokens.                                                                              | A database or backup leak does not yield usable sessions.                                                              |
| P0.6  | CSRF via per-session synchronizer token; login protected by JSON-only bodies and `SameSite=Lax`.                                   | Server sessions already exist, so the stronger synchronizer pattern costs nothing extra.                               |
| P0.7  | Audit privileges are `INSERT` and `SELECT` only; `audit()` accepts only a tenant transaction.                                      | Append-only is enforced by the database; same-transaction writes are enforced by the type system.                      |
| P0.8  | Database roles are created by a bootstrap script, not by migrations.                                                               | Managed PostgreSQL often restricts role creation; migrations stay runnable by the owner role.                          |
| P0.9  | Phase 0 creates minimal `tenants` and `users` tables, extended by Phases 1 and 2.                                                  | RLS and tenant login must be proven on real tables, not throwaway ones.                                                |
| P0.10 | Authentication is delivered in two steps: 0.5 (shared session machinery and operator realm) and 0.6 (tenant realm).                | Keeps each step reviewable; the simpler realm proves the shared machinery first.                                       |
| P0.11 | Logins and logouts are logged, not audited, in Phase 0.                                                                            | MVP audit scope (3.9) covers business actions; revisit if a security event log is required.                            |
| P0.12 | Error responses carry `code`, `requestId`, and optional `details`, with no `message` field.                                        | Clients localize text from codes (Arabic and English); responses never carry server wording that could leak internals. |
| P0.13 | Toolchain: Node 24 LTS, pnpm, ESM, `tsx`, tsup, Biome, Vitest, PostgreSQL 18, Testcontainers for tests.                            | Resolved Q1-Q4. tsup is unmaintained upstream; risk accepted.                                                          |
| P0.14 | Login throttling per account and per IP, both stored in PostgreSQL; no Redis.                                                      | Covers both single-account guessing and password spraying without adding a datastore.                                  |
| P0.15 | App and API on the same origin behind one reverse proxy; no CORS; client IP resolved through a configured `trust proxy` hop count. | Simplest cookie and CSRF setup; prevents both shared-proxy-IP lockouts and spoofed IPs.                                |
| P0.16 | The runtime role cannot insert or delete operators; the `operator:create` CLI connects as `watheeq_owner`. | A compromised application must not be able to mint operator accounts with access to every tenant. |

Promote these to `TECHNICAL_DECISIONS.md` when the phase is implemented.

## 11. Change Log

| Date       | Change                                                                                                        | Reason                  |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 2026-10-17 | Initial draft.                                                                                                | Phase 0 spec requested. |
| 2026-10-17 | Resolved Q1, Q3, Q4, Q8 and most of Q2; removed `message` from the error shape.                               | Owner review.           |
| 2026-10-17 | Resolved Q2, Q5, Q6, Q7; added per-IP throttling, `login_ip_throttle` table, and deployment topology section. | Owner review.           |
| 2026-10-17 | `users`: index on `tenant_id`; check constraint enforcing lowercased, trimmed email. | Found in Step 0.3 review; approved by owner. |
| 2026-10-17 | Added grants for `operators` and `operator_sessions`, and the CLI's connection role (P0.16). | Spec gap found while briefing Step 0.5; approved by owner. |
