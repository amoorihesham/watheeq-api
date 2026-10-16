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
set -a; . ./.env; set +a
pnpm db:migrate
pnpm dev
```

The app does not load `.env` by itself yet, so export the variables in your shell as shown above.
`docker compose up` creates the database roles only when the volume is empty.
If you have an older volume without them, run `docker compose down -v` first (this deletes local data).

## Database roles and migrations

Two PostgreSQL roles are used, so the application cannot bypass Row-Level Security (RLS).

| Role            | Used by                 | Privileges                                                                            |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `watheeq_owner` | Migrations only         | Owns the schema, tables, functions, and policies.                                     |
| `watheeq_app`   | The running application | `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, owns nothing, only the grants migrations give. |

- `db/bootstrap/roles.sql` creates both roles. It is run once by a database administrator.
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

## Scripts

| Script            | What it does                                                   |
| ----------------- | -------------------------------------------------------------- |
| `pnpm dev`        | Runs the app with `tsx` in watch mode.                         |
| `pnpm build`      | Builds `dist/` with tsup.                                      |
| `pnpm start`      | Runs the build output (`node dist/main.js`).                   |
| `pnpm test`       | Runs Vitest. Testcontainers starts PostgreSQL 18 by itself.    |
| `pnpm typecheck`  | Runs `tsc --noEmit`.                                           |
| `pnpm lint`       | Runs the Biome linter, failing on warnings.                    |
| `pnpm check`      | Runs Biome lint, format, and import checks without writing.    |
| `pnpm format`     | Formats all files with Biome.                                  |
| `pnpm db:generate`| Generates a migration from changes in `src/db/schema/`.        |
| `pnpm db:migrate` | Applies migrations as `watheeq_owner` (`MIGRATION_DATABASE_URL`). |

## Notes

- Tests need a running Docker daemon but nothing started by hand.
- The local database lives in a Docker volume on your machine only.
