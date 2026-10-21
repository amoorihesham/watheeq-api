# Watheeq API

Multi-tenant backend for managing internal legal departments, legal services, and the legal request lifecycle.
Project documents live in `docs/`.
Start with `CLAUDE.md` and `docs/ROADMAP_AND_STATUS.md`.

## Requirements

- pnpm 12 and Docker.
- Node 24 LTS is pinned in `package.json` (`devEngines.runtime`), so `pnpm install` downloads it and pnpm runs scripts on it.

## Setup

```sh
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --wait
pnpm db:migrate
pnpm dev
```

`pnpm dev` and `pnpm db:migrate` load `.env` through Node's `--env-file-if-exists` flag.
`pnpm start` does not read `.env`: it uses the real process environment, as in production.

## Configuration

The app validates its environment at startup.
If a key is missing or invalid, it logs `Invalid configuration: KEY (reason)` and exits with code 1, naming keys and reasons only, never values.

| Key            | Default       | Meaning |
| -------------- | ------------- | ------- |
| `DATABASE_URL` | none          | Required. PostgreSQL connection URL, used by the app, migrations, and the CLI. |
| `PORT`         | `3000`        | HTTP port. |
| `NODE_ENV`     | `development` | `development`, `test`, or `production`. |
| `LOG_LEVEL`    | `info`        | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. |
| `JWT_SECRET`   | none          | Required, at least 32 characters. Signs access tokens (HS256). Generate one with `openssl rand -base64 48`. |
| `ACCESS_TOKEN_TTL_SECONDS`  | `1800`   | Access-token lifetime (minimum 60). |
| `REFRESH_TOKEN_TTL_SECONDS` | `604800` | Refresh-token lifetime (minimum 60). |

## HTTP behavior

- Every response has an `X-Request-Id` header.
  A client-sent `X-Request-Id` is reused only if it matches `^[A-Za-z0-9._-]{1,64}$`; otherwise a UUID is generated.
- Every log line of a request carries it as `reqId`.
- Errors use one JSON shape: `{"error":{"code","requestId","details?"}}`, with no human-readable message.
  `details` (a list of `{path, code}`) appears only for validation errors.
- Request bodies must be `application/json` and at most 100 KB (otherwise 415 or 413).
- Logs are JSON on stdout. `password`, `cookie`, `set-cookie`, and `authorization` are redacted.
- On `SIGTERM` or `SIGINT` the server stops accepting connections, lets in-flight requests finish (up to 10 seconds), closes the database pool, and exits.

## Authentication

| Endpoint             | Needs                 | Result |
| -------------------- | --------------------- | ------ |
| `POST /auth/login`   | `{email, password}`   | 200 `{user:{id, email, userName, role, tenant}}` and both cookies. 401 `INVALID_CREDENTIALS` for any failure. |
| `POST /auth/refresh` | `wq_refresh` cookie   | 200 `{user}` and new cookies; the old refresh token is revoked. 401 `UNAUTHENTICATED` (and both cookies cleared) if the token is unknown, revoked, or expired, or the user is inactive. |
| `POST /auth/logout`  | nothing               | 204; the refresh token is revoked and both cookies are cleared. |
| `GET /auth/me`       | `wq_access` cookie    | 200 `{user}`. 401 `UNAUTHENTICATED`. |

- `wq_access` holds a 30-minute JWT (`Path=/`); `wq_refresh` holds a 7-day random token (`Path=/auth`). Both are `HttpOnly`, `Secure`, `SameSite=Lax`.
  Browsers treat `http://localhost` as secure; `curl` also sends `Secure` cookies to `localhost`.
- Only the SHA-256 hash of a refresh token is stored.
- A deactivated user keeps a valid access token for at most 30 minutes; the next refresh fails.
- The access token's payload is `{sub, iss: "watheeq_api", iat, exp, username, email, role, tenant}`. `tenant` is `{id, roleId, roleName, permissions}` for a tenant user (until Phase 3: `roleId` null, `roleName` `admin` or `member`, `permissions` empty) and `null` for an operator.
- Protect a route with `authenticate(jwtSecret)` and, for operator routes, `requireRole("operator")`, both from `src/modules/auth/`.
- Create an operator with `pnpm operator:create <email> "<full name>"`. Tenant users are created in Phase 1 (tenant creation) and Phase 2 (user management).

## Operator API

Operator routes require an operator's access token and each declares a platform permission; tenant users get 403.

| Endpoint | Permission | Result |
| -------- | ---------- | ------ |
| `POST /operator/plans` | `platform.plan.create` | 201 `{plan}`; 409 `PLAN_NAME_TAKEN` for a name that exists in any case |
| `GET /operator/plans` | `platform.plan.view` | 200 `{plans}`, ordered by name |
| `GET /operator/plans/:planId` | `platform.plan.view` | 200 `{plan}`; 404 |
| `PATCH /operator/plans/:planId` | `platform.plan.update` | 200 `{plan}`; existing subscriptions keep their copied terms |

A plan is `{name, userLimit, graceDays, priceHalalas, paymentPeriod, discountPercent}`: the price is in halalas per payment period (`monthly` or `yearly`), and the discount is a percentage with up to two decimals.
Every plan write is audited as a platform-level entry. The full design is in `docs/specs/phase-1-platform-subscriptions.md`.

## Architecture in brief

- **Tenant isolation:** shared tables with a `tenant_id` column, filtered in application code.
  Every repository function that touches tenant data takes the tenant ID from the authenticated user and filters by it.
- **Accounts:** one `users` table; `role` is `operator` (platform operator, no tenant) or `user` (tenant user).
  A tenant user belongs to exactly one tenant through `tenant_members`.
- **Authentication:** a 30-minute JWT access token and a 7-day refresh token in `HttpOnly`, `Secure`, `SameSite=Lax` cookies. Refresh tokens are stored hashed, rotated on every refresh, and checked against the database, so a deactivated user loses access within 30 minutes (design in `docs/specs/phase-0-foundations.md`).
- **Audit:** `writeAuditEntry(tx, entry)` from `src/audit/`, inside the same transaction as the change.
- **Layers:** routes → controller → service → repository. Each module's routes file composes its own layers, and `src/app.ts` mounts the routers (`docs/specs/phase-0.5-refactor.md`).

Deliberately deferred for the MVP: Row-Level Security, login throttling, CSRF tokens, and database-enforced append-only audit (`docs/TECHNICAL_DECISIONS.md`, "Deferred hardening").

## Migrations

- Tables are defined in `src/db/schema/`.
  `pnpm db:generate` generates SQL migrations into `db/migrations/` with Drizzle Kit, and they are committed.
- `pnpm db:migrate` applies pending migrations; running it again does nothing.
  Migrations never run at application startup.

## Scripts

| Script             | What it does |
| ------------------ | ------------ |
| `pnpm dev`         | Runs the app with `tsx` in watch mode. |
| `pnpm build`       | Builds `dist/` with tsup. |
| `pnpm start`       | Runs the build output (`node dist/main.js`). |
| `pnpm test`        | Runs Vitest. Testcontainers starts PostgreSQL 18 by itself. |
| `pnpm typecheck`   | Runs `tsc --noEmit`. |
| `pnpm lint`        | Runs the Biome linter, failing on warnings. |
| `pnpm check`       | Runs Biome lint, format, and import checks without writing. |
| `pnpm format`      | Formats all files with Biome. |
| `pnpm db:generate` | Generates a migration from changes in `src/db/schema/`. |
| `pnpm db:migrate`  | Applies pending migrations. |
| `pnpm operator:create <email> "<full name>"` | Creates a platform operator (a `users` row with role `operator`). Reads the password from `OPERATOR_PASSWORD` or a hidden prompt, never from arguments. |

## Notes

- Tests need a running Docker daemon but nothing started by hand.
- The local database lives in a Docker volume on your machine only.
- The migration history was reset to a single baseline on 2026-10-21 (regenerated the same day to add `users.user_name`).
  A volume created before that still holds the old schema: run `docker compose down -v` once (this deletes local data), then `docker compose up -d --wait` and `pnpm db:migrate`.
