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
docker compose up -d db
pnpm dev
```

`pnpm dev` loads `.env` through Node's `--env-file-if-exists` flag, so no extra dependency is needed.
`pnpm start` does not read `.env`: it uses the real process environment, as in production.

## Configuration

The app validates its environment at startup.
If a key is missing or invalid, it logs `Invalid configuration: KEY (reason)` and exits with code 1.
The message names keys and reasons only, never values.

| Key            | Default       | Meaning                                                              |
| -------------- | ------------- | -------------------------------------------------------------------- |
| `DATABASE_URL` | none          | Required. PostgreSQL connection URL.                                 |
| `PORT`         | `3000`        | HTTP port.                                                           |
| `NODE_ENV`     | `development` | `development`, `test`, or `production`.                              |
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

## Notes

- Tests need a running Docker daemon but nothing started by hand.
- The local database lives in a Docker volume on your machine only.
