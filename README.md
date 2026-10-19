# Watheeq API

Multi-tenant backend for managing internal legal departments, legal services, and the legal request lifecycle.
Project documents live in `docs/`.
Start with `CLAUDE.md` and `docs/ROADMAP_AND_STATUS.md`.

## Requirements

- pnpm 12 and Docker.
- Node 24 LTS is pinned in `package.json` (`devEngines.runtime`), so `pnpm install` downloads it and pnpm runs scripts on it.
  A different Node on your `PATH` does not affect the scripts.

## Setup

```sh
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --wait
pnpm db:migrate
pnpm dev
```

`pnpm dev` and `pnpm db:migrate` load `.env` through Node's `--env-file-if-exists` flag, so no extra dependency is needed.
`pnpm start` does not read `.env`: it uses the real process environment, as in production.

## Configuration

The app validates its environment at startup.
If a key is missing or invalid, it logs `Invalid configuration: KEY (reason)` and exits with code 1.
The message names keys and reasons only, never values.

| Key            | Default       | Meaning                                                              |
| -------------- | ------------- | -------------------------------------------------------------------- |
| `DATABASE_URL` | none          | Required. PostgreSQL connection URL, as `watheeq_app`.               |
| `PORT`         | `3000`        | HTTP port.                                                           |
| `NODE_ENV`     | `development` | `development`, `test`, or `production`.                              |
| `OPERATOR_SESSION_IDLE_SECONDS` | `1800` | Operator session idle timeout (minimum 60). |
| `OPERATOR_SESSION_ABSOLUTE_SECONDS` | `28800` | Operator session absolute lifetime (minimum 60). |
| `TENANT_SESSION_IDLE_SECONDS` | `7200` | Tenant session idle timeout (minimum 60). |
| `TENANT_SESSION_ABSOLUTE_SECONDS` | `43200` | Tenant session absolute lifetime (minimum 60). |
| `LOGIN_ACCOUNT_MAX_FAILURES` | `5` | Consecutive wrong passwords that lock an account. |
| `LOGIN_ACCOUNT_LOCK_SECONDS` | `900` | How long a locked account is refused. |
| `LOGIN_IP_MAX_FAILURES` | `100` | Failed logins per client IP and window before that IP is blocked. |
| `LOGIN_IP_WINDOW_SECONDS` | `900` | Length of the per-IP window. |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of the app (see "Client IP and throttling"). |
| `LOG_LEVEL`    | `info`        | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`.     |

## HTTP behavior

- Every response has an `X-Request-Id` header.
  A client-sent `X-Request-Id` is reused only if it matches `^[A-Za-z0-9._-]{1,64}$`, otherwise a UUID is generated.
- Every log line of a request carries it as `reqId`.
- Errors use one JSON shape: `{"error":{"code","requestId","details?"}}`.
  There is no human-readable message. Clients map `code` to text.
  `details` (a list of `{path, code}`) appears only for validation errors.
- Request bodies must be `application/json` and at most 100 KB (otherwise 415 or 413).
- Logs are JSON on stdout. `password`, `cookie`, `set-cookie`, `x-csrf-token`, and `authorization` are redacted.
- On `SIGTERM` or `SIGINT` the server stops accepting connections, lets in-flight requests finish (up to 10 seconds), closes the database pool, and exits.

## Operator authentication

Platform operators log in through their own realm, separate from tenant users.

| Endpoint                      | Auth           | Result                                                                                          |
| ----------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `POST /operator/auth/login`   | none           | 200 `{operator:{id,email}, csrfToken}` and a cookie. 401 `INVALID_CREDENTIALS` for any failure. |
| `GET /operator/auth/session`  | session        | 200 `{operator, csrfToken}`. 401 `UNAUTHENTICATED`.                                             |
| `POST /operator/auth/logout`  | session + CSRF | 204 and the cookie is cleared. 403 `CSRF_FAILED` without a valid `X-CSRF-Token` header.         |

- The session cookie is `__Host-wq_operator` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`).
  Browsers treat `http://localhost` as a secure context, but `curl` needs the cookie sent by hand over plain HTTP.
- Only the SHA-256 hash of the session token is stored.
- The CSRF token is HMAC-SHA256 of the session token, so nothing is stored for it and it stays the same for the whole session.
  `GET /operator/auth/session` returns the same token as login, so every tab and every reload uses one token.
- A session is rejected when it is revoked, past its absolute lifetime, idle for too long, or its operator is deactivated.
- Passwords are hashed with argon2id (19 MiB, 2 iterations, 1 lane) through `@node-rs/argon2`.
- Logins and logouts go to the application log, never with passwords, cookies, or tokens.

Create the first operator with the CLI, which connects as `watheeq_owner` through `MIGRATION_DATABASE_URL`:

```sh
pnpm operator:create omar@watheeq.sa          # prompts for the password without echo
OPERATOR_PASSWORD=... pnpm operator:create omar@watheeq.sa
```

The password is never read from command-line arguments, because those end up in shell history.
It must be 12 to 256 characters.
The application role `watheeq_app` can read and update operators but cannot insert or delete them, so a compromised application cannot create operators.

## Tenant authentication

Tenant users (for example Sara at Al-Noor) log in through the tenant realm, which works like the operator realm.

| Endpoint              | Auth           | Result                                                                                                  |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`    | none           | 200 `{user:{id,email,tenantId}, csrfToken}` and a cookie. 401 `INVALID_CREDENTIALS`. 429 `TOO_MANY_ATTEMPTS`. |
| `GET /auth/session`   | session        | 200 `{user, csrfToken}`. 401 `UNAUTHENTICATED`.                                                         |
| `POST /auth/logout`   | session + CSRF | 204 and the cookie is cleared. 403 `CSRF_FAILED` without a valid `X-CSRF-Token` header.                 |

- The session cookie is `__Host-wq_session`, with the same flags as the operator cookie.
  Each realm reads only its own cookie and its own session table (`user_sessions` or `operator_sessions`), so a session never works in the other realm.
- A user's session belongs to the user's tenant, and everything after the first lookup runs in that tenant's `withTenantTx`.
- Login must find the user by email, and a request must find its session by token, before the tenant is known.
  Both go through two `SECURITY DEFINER` functions, `auth_find_user_for_login` and `auth_resolve_user_session`.
  They are owned by the `watheeq_auth` role, which is the only RLS bypass in the system (see below).
- There is no tenant or user creation API yet (Phase 1 and 2).
  To log in locally, insert them as the database superuser, because forced RLS also applies to `watheeq_owner`:

```sh
docker compose exec db psql -U watheeq -d watheeq <<'SQL'
BEGIN;
WITH t AS (INSERT INTO tenants (name) VALUES ('Al-Noor') RETURNING id)
SELECT set_config('app.tenant_id', id::text, true) FROM t;
INSERT INTO users (tenant_id, email, password_hash)
VALUES (current_setting('app.tenant_id')::uuid, 'sara@alnoor.test', '<argon2id hash>');
COMMIT;
SQL
```

  Create the hash with `node -e "import('@node-rs/argon2').then(a => a.hash('the password', {memoryCost:19456,timeCost:2,parallelism:1})).then(console.log)"`.

## Login throttling

Both realms share the same rules, in PostgreSQL:

- **Per account:** 5 consecutive wrong passwords lock the account for 15 minutes.
  While locked, login returns 429 `TOO_MANY_ATTEMPTS` without checking the password.
  A successful login resets the count.
- **Per IP:** 100 failed logins within a 15-minute window block that IP with 429 for every email.
  A window older than 15 minutes counts as zero.
  Every 401 counts, and a successful login does not reset the IP counter.
  An IPv6 client is counted by its `/64` network, because one customer usually holds a whole `/64` and could otherwise rotate addresses.
  Sessions still store the full address.
- Counters are single atomic `UPDATE` or upsert statements, so concurrent attempts lose no increments.

### Client IP and `TRUST_PROXY`

The IP counter uses Express's `req.ip`.
`TRUST_PROXY` is the number of reverse proxies in front of the app (Express `trust proxy` set to a number).
With `0`, `X-Forwarded-For` is ignored and the socket address is used.
With `N`, the address is read from the `X-Forwarded-For` entries added by the N proxy hops nearest to the app, so entries a client supplies itself are never counted.
Set it to exactly the number of proxies you run: too low counts the proxy's address (all users share one counter), and too high lets a client choose its own address.

## Local database

`docker compose up` creates the database roles only when the volume is empty.
If you have an older volume without them, run `docker compose down -v` first (this deletes local data).

## Database roles and migrations

Three PostgreSQL roles are used, so the application cannot bypass Row-Level Security (RLS).

| Role            | Used by                 | Privileges                                                                            |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `watheeq_owner` | Migrations only         | Owns the schema, tables, functions, and policies.                                     |
| `watheeq_app`   | The running application | `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, owns nothing, only the grants migrations give. |
| `watheeq_auth`  | The two lookup functions only | `NOLOGIN`, `BYPASSRLS`, owns `auth_find_user_for_login` and `auth_resolve_user_session`, and has `SELECT` on `users` and `user_sessions` only. `watheeq_app` is not a member and cannot become it. |

- `db/bootstrap/roles.sql` creates the three roles and makes `watheeq_owner` a member of `watheeq_auth`, so migrations can assign function ownership.
  Creating a `BYPASSRLS` role needs an administrator, which is why this is not a migration.
  It is run once by a database administrator.
  Docker Compose runs it through `/docker-entrypoint-initdb.d`, and the test setup runs it as the container superuser.
  Its passwords are for local development only.
- `DATABASE_URL` is the runtime connection (`watheeq_app`).
  `MIGRATION_DATABASE_URL` is the migration connection (`watheeq_owner`).
- Migrations live in `db/migrations/` and are never run at application startup.
  The table definitions in `src/db/schema/` generate the table migrations with `pnpm db:generate`.
  The function, RLS, policy, and grant migrations are written by hand, and policies are not declared in the Drizzle schema.
  To add a hand-written migration, run `pnpm exec drizzle-kit generate --custom --name <name>` and fill in the SQL.
- `pnpm db:migrate` applies pending migrations, and running it again does nothing.
- Tenant data is reached only through `withTenantTx(db, tenantId, fn)` in `src/db/tenant-tx.ts`.
  It sets a transaction-local tenant context that the RLS policies read through `app_current_tenant()`.
  Querying a tenant table without a context fails with `tenant context is not set`.

## Audit

- Business changes are recorded with `audit(tx, ctx, entry)` from `src/audit/`, inside the same `withTenantTx` transaction as the change.
  The entry commits or rolls back together with the change.
- `audit` accepts only a transaction (`Tx`), so calling it with the top-level `db` is a compile error.
- `ctx` is `{ actor: { type, id }, requestId }`.
  The tenant is never passed: the database fills it from the transaction's tenant context.
- `audit_log` is append-only: `watheeq_app` has `INSERT` and `SELECT` only, and RLS limits both to the current tenant.
  `UPDATE` and `DELETE` fail with `permission denied`.
- A migration that adds a foreign key to `tenants` on a new table must declare it inline in `CREATE TABLE`.
  A separate `ALTER TABLE ... ADD CONSTRAINT` makes the owner read `tenants`, which has forced RLS, and fails with `tenant context is not set`.

## Scripts

| Script             | What it does                                                      |
| ------------------ | ----------------------------------------------------------------- |
| `pnpm dev`         | Runs the app with `tsx` in watch mode.                            |
| `pnpm build`       | Builds `dist/` with tsup.                                         |
| `pnpm start`       | Runs the build output (`node dist/main.js`).                      |
| `pnpm test`        | Runs Vitest. Testcontainers starts PostgreSQL 18 by itself.       |
| `pnpm e2e`         | Runs the real server and CLI against a throwaway PostgreSQL 18 container and compares the normalized exchanges, database state, and logs with `scripts/e2e/expected-transcript.txt`. Needs Docker and Python 3. `pnpm e2e --update` rewrites the expected transcript after an intended behavior change. |
| `pnpm typecheck`   | Runs `tsc --noEmit`.                                              |
| `pnpm lint`        | Runs the Biome linter, failing on warnings.                       |
| `pnpm check`       | Runs Biome lint, format, and import checks without writing.       |
| `pnpm format`      | Formats all files with Biome.                                     |
| `pnpm db:generate` | Generates a migration from changes in `src/db/schema/`.           |
| `pnpm db:migrate`  | Applies migrations as `watheeq_owner` (`MIGRATION_DATABASE_URL`). |
| `pnpm operator:create <email>` | Creates a platform operator as `watheeq_owner`.      |

## Notes

- Tests need a running Docker daemon but nothing started by hand.
- The local database lives in a Docker volume on your machine only.
