# Phase 9 Spec: Centralized Configuration

| Field                  | Value                                                                                                                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**             | In Implementation                                                                                                                                                                                                                                                                                               |
| **Approved by / date** | _Amr - 27/10/2026 - 15:28 pm_                                                                                                                                                                                                                                                                                   |
| **Depends on**         | Phase 0 (`phase-0-foundations.md`) for the config loader, 0.5 (`phase-0.5-refactor.md`) for the per-module file rules, Phase 7 (`phase-7-escalation-notifications.md`) for the jobs and `JOBS`, Phase 8 (`phase-8-api-contract.md`), which must be merged first because both phases touch every module's wiring |
| **Related decisions**  | Technical T12, T14, T19, T40, T47-T49; Phase 5.5 P5.5.9                                                                                                                                                                                                                                                         |

---

## 1. Objective

Make `src/config/` the one place that defines everything a deployment can change, and the one loader every entry point goes through.
Today the environment settings are already validated in one schema, but the two CLIs read `process.env` on their own, every module receives every setting (secrets included), and about thirteen operational values (job intervals, batch sizes, time budgets, timeouts) are spread over eight files as constants that no deployment can change.
The owner wants this centralized now, as a consistency step before the staging setup, not because of an incident.

## 2. Scope

**In scope:**

- One loader in `src/config/` that validates the environment and returns a grouped, typed `Config` (`server`, `database`, `auth`, `links`, `email`, `storage`, `jobs`).
- Every entry point uses it: the server, `pnpm db:migrate`, `pnpm operator:create`, and the test helpers.
- Each module and infrastructure folder receives only the groups it needs.
- The thirteen operational settings of 4.3 move into the central schema, keep today's values as defaults, and can be overridden by an environment variable within bounds.
- Cross-setting checks (a job's budget is shorter than its interval).
- `<feature>.config.ts` files are renamed to `<feature>.constants.ts`, so "config" means only `src/config/`.
- `.env.example` documents every setting, and a test keeps it in step with the schema.

**Out of scope (and where it is handled instead):**

- Changing a setting without a restart. Settings are read once at startup; a change needs a restart, not a rebuild (Q4).
- Secrets read from files (`JWT_SECRET_FILE=/run/secrets/jwt`) and secret managers: the staging phase (Q1).
- Making domain rules configurable (the 25 MB file limit, file kinds, retention days, the permission catalog): they are spec decisions and stay fixed in their modules (Q2).
- Per-tenant settings stored in the database: a product feature, not deployment configuration.
- Renaming any existing environment variable: existing `.env` files and deployments keep working unchanged.

## 3. Requirements

| ID    | Requirement                                                                                                                                                                                   | Example                                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R9.1  | Every entry point validates its settings through a parser in `src/config/`. In `src/`, `process.env` is read only in `main.ts` and `src/cli/*.ts`, and only as the argument of such a parser. | _`DATABASE_URL=mysql://u:p@host/db pnpm db:migrate` exits 1 with `Invalid configuration: DATABASE_URL (custom)` before it opens a connection, exactly as the server does._ |
| R9.2  | The loader returns a grouped, typed `Config` (4.2); the environment variable names do not change.                                                                                             | _A developer's existing `.env` from Phase 8 starts the server with no edit._                                                                                               |
| R9.3  | Each router, job factory, and infrastructure factory receives only the groups it uses; no module receives the whole `Config`.                                                                 | _`createWorkflowsRouter` takes `{ db, auth }`; it cannot reach `storage.secretKey`, and `tsc` fails if it tries._                                                          |
| R9.4  | The operational settings of 4.3 are read from the central config, default to today's values, and can be overridden by environment variable within the listed bounds.                          | _On staging, `JOB_FILES_SWEEP_INTERVAL_MS=60000` and a restart make the file sweep run every minute instead of every 15 minutes, with no code change._                     |
| R9.5  | A job's time budget must be shorter than its interval; a violation fails startup.                                                                                                             | _`JOB_REQUESTS_ESCALATIONS_BUDGET_MS=90000` with the default 60-second interval exits 1 naming `JOB_REQUESTS_ESCALATIONS_BUDGET_MS`._                                      |
| R9.6  | An invalid setting fails startup with the key and a reason code, never the value (as today, Phase 0).                                                                                         | _`JOB_AUTH_TOKEN_CLEANUP_BATCH_SIZE=0` exits 1 with `JOB_AUTH_TOKEN_CLEANUP_BATCH_SIZE (too_small)`._                                                                      |
| R9.7  | An environment variable starting with `JOB_` that the schema does not know is logged as a warning at startup, naming the key; startup continues.                                              | _A typo `JOB_FILE_SWEEP_INTERVAL_MS=60000` logs `unknown setting ignored: JOB_FILE_SWEEP_INTERVAL_MS`, so the operator sees why the sweep still runs every 15 minutes._    |
| R9.8  | The effective value of every operational setting is logged once at startup; no secret is ever logged.                                                                                         | _The `scheduler started` line lists each selected job with its interval, batch size, and budget._                                                                          |
| R9.9  | `.env.example` lists every key the schemas know: required ones set, optional overrides as commented lines whose value is the default. A test fails when the two disagree.                     | _Adding `JOB_FILES_SWEEP_BATCH_SIZE` to the schema without documenting it fails the test._                                                                                 |
| R9.10 | Domain rules stay in their modules, in `<feature>.constants.ts`; no file named `*.config.ts` remains under `src/modules/` or `src/storage/`, and no value changes.                            | _`MAX_FILE_BYTES` is still 25 MB, now imported from `files.constants.js`._                                                                                                 |
| R9.11 | With no override set, behavior is unchanged: no endpoint, response, job timing, or limit differs from Phase 8.                                                                                | _The full suite passes; the only test edits are imports, how tests build config, and arguments that used to fall back to a module default._                                |

## 4. Design

### 4.1 Data model

No changes.

### 4.2 Configuration shape and loading

`src/config/config.ts` keeps one zod schema over the flat environment variables (the names stay), then one transform builds the groups.
The group types are inferred from the schema; `SmtpSettingsType` and `StorageSettingsType` become the `email` and `storage` groups, so `smtpSettingsOf` and `storageSettingsOf` are removed.

```ts
// Shape only; names of the groups and fields are part of this spec.
type Config = {
  server: { env; port; logLevel; shutdownTimeoutMs };
  database: { url; timeoutMs };
  auth: { jwtSecret; accessTokenTtlSeconds; refreshTokenTtlSeconds };
  links: { appBaseUrl; invitationTtlSeconds; passwordResetTtlSeconds };
  email: { host; port; secure; user?; password?; from };
  storage: {
    endpoint;
    region;
    bucket;
    accessKey;
    secretKey;
    forcePathStyle;
    uploadQueueSize;
  };
  jobs: {
    enabled: JobsSettingType; // JOBS
    escalations: { intervalMs; budgetMs };
    subscriptionNotices: { intervalMs };
    fileSweep: { intervalMs; batchSize; budgetMs };
    tokenCleanup: { intervalMs; batchSize };
    notificationsCleanup: { intervalMs; batchSize };
  };
};
```

Mapping of today's environment variables:

| Group      | Field                                                                      | Environment variable                                                                                                           |
| ---------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `server`   | `env`, `port`, `logLevel`                                                  | `NODE_ENV`, `PORT`, `LOG_LEVEL`                                                                                                |
| `database` | `url`                                                                      | `DATABASE_URL`                                                                                                                 |
| `auth`     | `jwtSecret`, `accessTokenTtlSeconds`, `refreshTokenTtlSeconds`             | `JWT_SECRET`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS`                                                          |
| `links`    | `appBaseUrl`, `invitationTtlSeconds`, `passwordResetTtlSeconds`            | `APP_BASE_URL`, `VERIFICATION_TOKEN_TTL_SECONDS`, `PASSWORD_RESET_TTL_SECONDS`                                                 |
| `email`    | `host`, `port`, `secure`, `user`, `password`, `from`                       | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`                                            |
| `storage`  | `endpoint`, `region`, `bucket`, `accessKey`, `secretKey`, `forcePathStyle` | `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_FORCE_PATH_STYLE` |
| `jobs`     | `enabled`                                                                  | `JOBS`                                                                                                                         |

The operational settings of 4.3 fill the remaining fields.

`links` is its own group because both auth (password reset) and the invitation flows (tenants, users) build emailed links; it holds the web app's origin and the lifetimes of the links it sends.

Parsers:

- `parseConfig(env)` returns the whole `Config`, for the server and the test helpers. Its result and failure message keep today's form (`{ ok, config }` or `{ ok: false, message }`, keys and reason codes only).
- `parseCliConfig(env)` returns `{ database, operatorPassword? }`, for both CLIs. It shares the `DATABASE_URL` and `DATABASE_TIMEOUT_MS` field schemas with `parseConfig`, so the two cannot drift, and it does not require SMTP or storage settings to run a migration.
- An empty string is a value, not "unset": `PORT=` fails as today. A setting is left to its default only by leaving it out.

Settings are read once, when the process starts. The values are copied into the objects built at startup (the pool, the S3 client, the routers, the scheduler's timers), so a change takes effect on the next restart (Q4).

### 4.3 Operational settings

Each environment name of a job setting is `JOB_` plus the job's name in upper case with `.` turned into `_`, plus the setting, so the name can be derived from the `JOBS` names already in use (Q3).

| Environment variable                    | Config path                            | Default (today)   | Bounds                        | Today in                            |
| --------------------------------------- | -------------------------------------- | ----------------- | ----------------------------- | ----------------------------------- |
| `JOB_REQUESTS_ESCALATIONS_INTERVAL_MS`  | `jobs.escalations.intervalMs`          | 60,000 (1 min)    | 1,000 to 604,800,000 (7 days) | `requests.config.ts`                |
| `JOB_REQUESTS_ESCALATIONS_BUDGET_MS`    | `jobs.escalations.budgetMs`            | 50,000            | 1,000 to below its interval   | `requests.config.ts`                |
| `JOB_SUBSCRIPTIONS_NOTICES_INTERVAL_MS` | `jobs.subscriptionNotices.intervalMs`  | 3,600,000 (1 h)   | 1,000 to 604,800,000          | `subscriptions.config.ts`           |
| `JOB_FILES_SWEEP_INTERVAL_MS`           | `jobs.fileSweep.intervalMs`            | 900,000 (15 min)  | 1,000 to 604,800,000          | `files.config.ts`                   |
| `JOB_FILES_SWEEP_BATCH_SIZE`            | `jobs.fileSweep.batchSize`             | 100               | 1 to 10,000                   | `files.config.ts`                   |
| `JOB_FILES_SWEEP_BUDGET_MS`             | `jobs.fileSweep.budgetMs`              | 120,000 (2 min)   | 1,000 to below its interval   | `files.config.ts`                   |
| `JOB_AUTH_TOKEN_CLEANUP_INTERVAL_MS`    | `jobs.tokenCleanup.intervalMs`         | 86,400,000 (24 h) | 1,000 to 604,800,000          | `auth.config.ts`                    |
| `JOB_AUTH_TOKEN_CLEANUP_BATCH_SIZE`     | `jobs.tokenCleanup.batchSize`          | 1,000             | 1 to 10,000                   | `auth.config.ts`                    |
| `JOB_NOTIFICATIONS_CLEANUP_INTERVAL_MS` | `jobs.notificationsCleanup.intervalMs` | 86,400,000 (24 h) | 1,000 to 604,800,000          | `notifications.config.ts`           |
| `JOB_NOTIFICATIONS_CLEANUP_BATCH_SIZE`  | `jobs.notificationsCleanup.batchSize`  | 1,000             | 1 to 10,000                   | `notifications.config.ts`           |
| `DATABASE_TIMEOUT_MS`                   | `database.timeoutMs`                   | 2,000             | 100 to 60,000                 | `HEALTH_TIMEOUT_MS` in `db/pool.ts` |
| `SHUTDOWN_TIMEOUT_MS`                   | `server.shutdownTimeoutMs`             | 10,000            | 1,000 to 300,000              | `main.ts`                           |
| `STORAGE_UPLOAD_QUEUE_SIZE`             | `storage.uploadQueueSize`              | 2                 | 1 to 10                       | `storage.config.ts`                 |

- `DATABASE_TIMEOUT_MS` keeps today's double role: the pool's connection timeout and the `/health` check's timeout.
- The rule "budget below interval" (R9.5) keeps each run inside its own cycle. Example: with a 60-second escalation interval and a 90-second budget, one slow run could hold back R1 and R2 firings for a run and a half, and the escalation check would no longer be "every minute" in practice (Phase 7, 4.3).
- What stays a constant: values that are a fact of an external system (`MAX_KEYS_PER_DELETE`, `UPLOAD_PART_SIZE_BYTES`, the S3 limits) or a product rule with a spec ID (`PENDING_LIFETIME_HOURS`, `RETENTION_DAYS`, `ENDING_SOON_DAYS`, `STORAGE_WARNING_PERCENT`, `ABANDONED_AFTER_HOURS`, `OVERDUE_AFTER_HOURS`). Changing one of those is a product decision and goes through a spec.

### 4.4 Key flows

**Server startup (`main.ts`):**

1. `parseConfig(process.env)`; on failure, log the message at fatal and exit 1 (unchanged).
2. Warn about unknown `JOB_*` keys (R9.7).
3. Build the logger, the store, the jobs, the pool, and the app from their groups.
4. The `scheduler started` line logs each selected job's name and settings (R9.8).

**Wiring.** Each module still composes its own layers (T14); only the arguments change:

```ts
// Before (app.ts)
app.use("/users", createUsersRouter({ db, config, emailSender }));
// users.routes.ts reads config.JWT_SECRET, config.APP_BASE_URL, config.VERIFICATION_TOKEN_TTL_SECONDS

// After
app.use(
  "/users",
  createUsersRouter({
    db,
    auth: config.auth,
    links: config.links,
    emailSender,
  }),
);
```

```ts
// Before (jobs.ts): each job reads its module's constants
createFileSweepJob({ store: fileStore });
// After: each job receives its settings; the module keeps no default of its own
createFileSweepJob({ store: fileStore, settings: config.jobs.fileSweep });
```

Functions that took a defaulted `batchSize` or `budgetMs` (`checkEscalations`, the sweep, the two cleanups) now require them, so a default exists in exactly one place: the schema.
Tests pass explicit values or read them from `testConfig()`.

**CLIs.** `migrate.ts` and `create-operator.ts` call `parseCliConfig(process.env)` first and exit 1 with its message on failure; `create-operator` then checks its arguments as today.

### 4.5 Module structure

```
src/config/
  config.ts          the schema, parseConfig, parseCliConfig, the Config type
src/main.ts          parses, warns about unknown JOB_* keys, passes groups
src/app.ts           AppDeps.config stays; passes each router only its groups
src/jobs.ts          buildJobs({ fileStore, jobs: config.jobs })
src/cli/*.ts         parseCliConfig(process.env)
src/db/pool.ts       createPool(database, logger); HEALTH_TIMEOUT_MS removed
src/email/, src/storage/   settings typed by their config group; *SettingsOf removed
src/modules/<feature>/<feature>.constants.ts   renamed from <feature>.config.ts (19 files)
test/helpers/config.ts     testConfig still takes raw env overrides and returns the grouped Config
```

The Phase 0.5 per-module file rule changes from "Constants live only in `<feature>.config.ts`" to "Constants live only in `<feature>.constants.ts`; settings a deployment can change live only in `src/config/`".

## 5. Edge Cases and Failure Behavior

| Scenario                                                                                   | Expected behavior                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No override is set.                                                                        | Every value equals today's; behavior is identical to Phase 8 (R9.11).                                                                                  |
| `JOB_FILES_SWEEP_INTERVAL_MS=abc`.                                                         | Startup exits 1 naming `JOB_FILES_SWEEP_INTERVAL_MS (invalid_type)`; `abc` is not printed.                                                             |
| `JOB_FILES_SWEEP_BUDGET_MS=900000` with the default 15-minute interval (equal, not below). | Startup exits 1 naming `JOB_FILES_SWEEP_BUDGET_MS (custom)` (R9.5).                                                                                    |
| `JOB_FILES_SWEEP_INTERVAL_MS=60000` alone, budget left at its 2-minute default.            | Startup exits 1 naming the budget: the default no longer fits; the operator must lower the budget too. Documented next to both keys in `.env.example`. |
| A typo `JOB_FILE_SWEEP_INTERVAL_MS`.                                                       | Warning naming the key; the default applies; startup continues (R9.7).                                                                                 |
| A CI system sets `JOB_NAME` (Jenkins does).                                                | Warning only, never a failure, so the server still starts on such a host (Q5).                                                                         |
| `pnpm db:migrate` with only `DATABASE_URL` set.                                            | Runs; SMTP and storage settings are not required by `parseCliConfig`.                                                                                  |
| `pnpm operator:create` with no `DATABASE_URL`.                                             | Exits 1 with `Invalid configuration: DATABASE_URL (Required)` before printing usage.                                                                   |
| An override is changed on a running server.                                                | Nothing changes until the next restart; the graceful shutdown lets the request and job in progress finish.                                             |
| `SMTP_PASSWORD` or `STORAGE_SECRET_KEY` is malformed.                                      | The message names the key only, as today; the startup settings log never includes the `auth`, `email`, `storage` credentials, or `database.url`.       |

## 6. Security and Authorization

- **Least privilege between modules:** a module can no longer read a secret it does not use; the types enforce it (R9.3).
- **No secret in logs:** failure messages name keys only (unchanged); the startup log (R9.8) is limited to the job settings and other non-secret values.
- **The CLIs now validate** `DATABASE_URL` the same way the server does (R9.1).
- No endpoint, permission, tenant filter, or audit entry changes.
- Operational overrides are bounded, so a mistaken value cannot make a job spin (an interval of 0) or lock the database with a huge batch.

## 7. Implementation Steps

Two sub-agents, each in its own git worktree; the steps are split along their dependencies and built in the order below, with no review gate between steps; the whole spec is reviewed once at the end.

| Step                                | Objective                                         | Delivers                                                                                                                                                                                                                                | Acceptance criteria     | Verification                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.1 Rename constants files          | "config" means only `src/config/`.                | The 19 `*.config.ts` files under `src/modules/` and `src/storage/` renamed to `*.constants.ts`, every import updated, no value changed.                                                                                                 | R9.10                   | `tsc`, lint, full suite green; `find src -name '*.config.ts'` lists nothing outside `src/config/`.                                                                                           |
| 9.2 Grouped loader and wiring       | Modules receive only their groups.                | The grouped `Config` of 4.2 for today's variables; `main.ts`, `app.ts`, every routes file, `email/`, `storage/`, `db/pool.ts`, and `testConfig` on the groups; `smtpSettingsOf` and `storageSettingsOf` removed.                        | R9.2, R9.3, R9.6, R9.11 | `tsc`, lint, full suite green; `config.test.ts` covers each group's mapping; `grep -rn "config\.[A-Z_]" src` finds nothing.                                                                  |
| 9.3 Operational settings            | The knobs of 4.3 are central and overridable.     | The thirteen settings with defaults, bounds, and the budget rule; the job factories, `checkEscalations`, the sweep, and the cleanups take their settings with no module default; the unknown `JOB_*` warning; the startup settings log. | R9.4, R9.5, R9.7, R9.8  | Unit tests per setting (default, override, below and above bounds), the budget rule, the warning; a startup test with an override; a scheduler test that a job uses its configured interval. |
| 9.4 CLIs and documentation contract | Every entry point and the docs follow the loader. | `parseCliConfig` and both CLIs on it; `.env.example` with every key (overrides commented with their defaults); the source-scan test for R9.1; the `.env.example` contract test for R9.9; README's configuration paragraph.              | R9.1, R9.9              | CLI tests (a bad `DATABASE_URL`, migrate without SMTP settings); the two contract tests fail when an undocumented key or a stray `process.env` is added (checked by adding one).             |

Order: agent A builds 9.1 and merges it first (it is mechanical and touches imports everywhere), then 9.3 once 9.2 is merged.
Agent B builds 9.2 starting from 9.1, then 9.4 once 9.2 is merged; 9.3 and 9.4 run in parallel.

## 8. Test Plan

- **Unit (`test/config.test.ts`):** each group's mapping from today's variables (R9.2); each operational setting's default, a valid override, and both bounds (R9.4); budget equal to and above the interval (R9.5); messages name keys and never values, including for the new keys (R9.6); `parseCliConfig` with only `DATABASE_URL` and with a bad one (R9.1).
- **Startup (`test/startup.test.ts`, spawned process):** an override reaches the `scheduler started` log line (R9.8); an unknown `JOB_*` key is warned about and the server keeps starting (R9.7); a budget above its interval exits 1 (R9.5).
- **Scheduler:** a job built from settings with a short interval runs again after that interval (R9.4).
- **CLI (`test/create-operator.test.ts`, migrate):** a `mysql://` URL exits 1 with the config message; migrate runs with only `DATABASE_URL` (R9.1).
- **Contract tests:** no `process.env` in `src/` outside the parser calls of `main.ts` and `src/cli/` (R9.1); `.env.example` and the schema list the same keys, and every commented default equals the schema's default (R9.9).
- **Regression:** the full suite, with the only edits being imports, config building, and explicit job arguments (R9.10, R9.11).
- **End-to-end (review):** a running server on throwaway containers with `JOB_FILES_SWEEP_INTERVAL_MS=60000` and `JOB_FILES_SWEEP_BUDGET_MS=30000` sweeps an expired pending upload within about a minute; the same server without overrides behaves as Phase 8.

## 9. Open Questions

Q1, Q2, and Q4 are the pre-spec discussion (2026-10-27); Q3, Q5, and Q6 were raised by the draft. All are resolved.

| #   | Question                                                    | Options                                                                                                                                                                     | Resolution                                                                                                                                                       |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Do secrets read from files (`*_FILE`) belong in this phase? | (a) Yes, in the loader now. (b) Defer to the staging phase, where they are first needed.                                                                                    | **Resolved 2026-10-27: (b)**, `*_FILE` secrets are added in the staging phase; the grouped loader makes them a local change there (P9.6).                        |
| Q2  | Which values move to `src/config/`?                         | (a) Everything, including domain rules. (b) Environment and operational settings; domain rules stay in modules, renamed to `.constants.ts`. (c) As (b), without the rename. | **Resolved 2026-10-27: (b)**, `src/config/` holds what a deployment can change; domain rules stay with their modules in `<feature>.constants.ts` (P9.2, P9.3).   |
| Q3  | How are operational environment variables named?            | (a) `JOB_<JOB NAME>_<SETTING>`, derived from the job's `JOBS` name (`JOB_FILES_SWEEP_INTERVAL_MS`). (b) Short free names (`SWEEP_INTERVAL_MS`).                             | **Resolved 2026-10-27: (a)**, every name is `JOB_` plus the job's `JOBS` name in upper case plus the setting, so the shared prefix makes typos detectable (R9.7, P9.2). |
| Q4  | Do changed settings apply without a restart?                | (a) No, read once at startup. (b) Yes, re-read at use or watched.                                                                                                           | **Resolved 2026-10-27: (a)**, a change needs a restart, not a rebuild; live reload is out of scope (P9.5).                                                       |
| Q5  | What happens with an unknown `JOB_*` key?                   | (a) Warning, startup continues. (b) Startup fails. (c) Ignored silently.                                                                                                    | **Resolved 2026-10-27: (a)**, an unknown `JOB_*` key is logged as a warning and startup continues, so hosts that set their own `JOB_*` variables (Jenkins sets `JOB_NAME`) still start (P9.4).                          |
| Q6  | Are the bounds in 4.3 right?                                | (a) As listed. (b) Tighter per job (for example the escalation interval at most 10 minutes, to keep "every minute" close).                                                  | **Resolved 2026-10-27: (a)**, the uniform bounds of 4.3, which only stop clearly broken values; the product timings are the defaults (P9.2).                                    |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #    | Decision                                                                                                                                                                                                                               | Rationale                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P9.1 | One loader in `src/config/` returns a grouped `Config`; every entry point uses it, and modules receive only their groups. Environment variable names do not change.                                                                    | One place to see what a deployment can change, and one place to see what each module depends on; existing deployments keep working. |
| P9.2 | Operational settings (job intervals, batch sizes, budgets, the database and shutdown timeouts, the upload queue size) are central, default to today's values, and are overridable within bounds; a job's budget is below its interval. | Tuning on staging or production is a restart, not a code change; the defaults live in one place only.                               |
| P9.3 | Domain rules and external-system facts stay in their modules as `<feature>.constants.ts`.                                                                                                                                              | A product rule changes through a spec, not an environment variable; the rule stays next to the code and tests that own it.          |
| P9.4 | Unknown `JOB_*` keys are warned about, not fatal; the effective operational settings are logged at startup, secrets never.                                                                                                             | An operator sees a typo and the values in force without risking a secret in the logs.                                               |
| P9.5 | Settings are read once at startup; a change takes effect on restart.                                                                                                                                                                   | Standard for a stateless API; live reload would need every consumer to re-read, timers to be rebuilt, and instances to agree.       |
| P9.6 | Secrets from files and secret managers are deferred to the staging phase.                                                                                                                                                              | Keeps this phase to centralizing; the loader makes the addition local.                                                              |

Promote these to `TECHNICAL_DECISIONS.md` when the phase is implemented, and update T14 (`<feature>.constants.ts`) and the Phase 0.5 per-module file rules.

## 11. Change Log

| Date       | Change         | Reason                                           |
| ---------- | -------------- | ------------------------------------------------ |
| 2026-10-27 | Initial draft. | Pre-spec discussion with the owner (Q1, Q2, Q4). |
| 2026-10-27 | Q3, Q5, and Q6 resolved as proposed. | Owner approved the draft. |
