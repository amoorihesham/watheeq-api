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
| `SMTP_HOST`, `SMTP_PORT` | none | Required. SMTP server for verification emails; locally Mailpit (`localhost`, `1025`). |
| `SMTP_USER`, `SMTP_PASSWORD` | none | Optional SMTP login; Mailpit needs none. |
| `SMTP_SECURE` | `false` | `true` for TLS from the first byte (port 465 style). |
| `EMAIL_FROM` | none | Required. Sender address, for example `Watheeq <no-reply@watheeq.sa>`. |
| `APP_BASE_URL` | none | Required. Web-app origin; verification links are `${APP_BASE_URL}/verify-email?token=...`. |
| `VERIFICATION_TOKEN_TTL_SECONDS` | `259200` | Verification link lifetime (72 hours). |
| `STORAGE_ENDPOINT` | none | Required. URL of the S3-compatible object store; locally SeaweedFS (`http://localhost:8333`). |
| `STORAGE_BUCKET` | none | Required. Private bucket for uploaded files; created beforehand (locally by `docker compose up`). |
| `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | none | Required. Credentials of the bucket. |
| `STORAGE_REGION` | `us-east-1` | Region the S3 client signs for; most S3-compatible servers ignore it. |
| `STORAGE_FORCE_PATH_STYLE` | `false` | `true` for servers addressed as `host/bucket/key` (local servers); `false` for virtual-hosted style. |

## HTTP contract

How the API behaves over HTTP is written once in `docs/api/`:

- `docs/api/conventions.md`: the success shape, lists and cursors, filters, request methods, value formats, uploads and downloads.
- `docs/api/errors.md`: the error shape, every error code and detail code.
- `docs/api/auth.md`: the cookies, login, refresh, logout, the access-token payload, password and verification links.
- `docs/api/access.md`: permissions, scopes, subscription states, and request visibility.

Each endpoint is a row in the `.API.md` file of the phase that designed it, in `docs/specs/`.
Logs are JSON on stdout; `password`, `cookie`, `set-cookie`, and `authorization` are redacted, and every log line of a request carries its `reqId`.
On `SIGTERM` or `SIGINT` the server stops accepting connections, lets in-flight requests finish (up to 10 seconds), closes the database pool, and exits.
Create an operator with `pnpm operator:create <email> "<full name>"`; tenant users are created through tenant creation and user management.

## Architecture in brief

- **Tenant isolation:** shared tables with a `tenant_id` column, filtered in application code.
  Every repository function that touches tenant data takes the tenant ID from the authenticated user and filters by it.
- **Accounts:** one `users` table; `role` is `operator` (platform operator, no tenant) or `user` (tenant user).
  A tenant user belongs to exactly one tenant through `tenant_members`.
- **Authentication:** a 30-minute JWT access token and a 7-day refresh token in `HttpOnly`, `Secure`, `SameSite=Lax` cookies. Refresh tokens are stored hashed, rotated on every refresh, and checked against the database, so a deactivated user loses access within 30 minutes (design in `docs/specs/phase-0-foundations/phase-0-foundations.md`).
- **Audit:** `writeAuditEntry(tx, entry)` from `src/audit/`, inside the same transaction as the change.
- **Layers:** routes → controller → service → repository. Each module's routes file composes its own layers, and `src/app.ts` mounts the routers (`docs/specs/phase-0.5-refactor/phase-0.5-refactor.md`).

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

## Local email (Mailpit)

`docker compose up -d --wait` also starts Mailpit, a local SMTP server.
Verification emails sent by the app appear in its inbox at <http://localhost:8025>.

## Local file storage (SeaweedFS)

`docker compose up -d --wait` also starts SeaweedFS, an S3-compatible server on <http://localhost:8333>, and creates the `watheeq-files` bucket.
The `.env.example` values point at it; tests start their own server through Testcontainers.

## Notes

- Tests need a running Docker daemon but nothing started by hand.
- The local database lives in a Docker volume on your machine only.
- The migration history was reset to a single baseline on 2026-10-21 (regenerated the same day to add `users.user_name`).
  A volume created before that still holds the old schema: run `docker compose down -v` once (this deletes local data), then `docker compose up -d --wait` and `pnpm db:migrate`.
