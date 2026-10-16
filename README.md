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

The app does not load `.env` by itself yet.
Export the variables in your shell, or rely on the defaults in `src/main.ts`, which match `docker-compose.yml`.

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
