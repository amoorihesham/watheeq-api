# Phase 0.5 Spec: Layered Architecture

| Field                  | Value                              |
| ---------------------- | ---------------------------------- |
| **Status**             | Implemented                        |
| **Approved by / date** | _Amr - 19/10/2026 - 18:06 pm_      |
| **Depends on**         | Phase 0 (`phase-0-foundations.md`) |
| **Related decisions**  | Technical T8, T9, T11, T14         |

---

## 1. Objective

Give every feature the same layered shape (routes → controller → service → repository), so a reader can predict where any piece of code lives and business rules have a home that is neither HTTP nor SQL.
Phase 1 adds the first business rules (subscriptions, user limits), and they need that home before they are written.

## 2. Scope

**In scope:**

- The layering convention and its dependency rules.
- Central Express middleware in `src/middleware/`.
- Repository helpers (`db/rows.ts`, `db/errors.ts`) and shared test helpers (`test/helpers/`).

**Out of scope:**

- Any behavior change. The convention applies to new code as it is written.

## 3. Requirements

| ID     | Requirement | Example |
| ------ | ----------- | ------- |
| R0.5.1 | Every module follows the layer responsibilities in 4.3. | _A reviewer looking for "is the account active?" during login finds it in the auth service, not in a controller or repository._ |
| R0.5.2 | Operations that must be atomic run in one transaction owned by the service. | _Phase 1's "check the user limit, insert the member, write the audit entry" runs on one `tx`._ |

## 4. Design

### 4.1 Data model

No changes.

### 4.2 API

See [phase-0.5-refactor.API.md](phase-0.5-refactor.API.md).

### 4.3 Layer responsibilities

| Layer      | Owns | Must not |
| ---------- | ---- | -------- |
| Routes     | Paths, HTTP methods, which middleware and controller handler apply | Contain logic |
| Controller | Reading the request (body, cookies, the authenticated user through `principalOf(req)`), calling one service function, writing the response (status, cookies, JSON) | Query the database, open transactions, contain business rules |
| Service    | Validating its input with the feature's zod schemas, business rules and flow, transaction boundaries (`withTx`), calling `writeAuditEntry()` | Read `req` or write `res` |
| Repository | Single queries against Drizzle, mapping rows, translating PostgreSQL errors | Open transactions, contain business rules |

- Each layer is a factory function closing over its dependencies, for example `createAuthService({ db, repo, settings })`. The module's `<feature>.routes.ts` composes them (repository, then service, then controller) and returns the router; `app.ts` only mounts each module's router. Example: `app.use("/auth", createAuthRouter({ db, config }))`.
- Repository functions take an executor (`Db | Tx`) as their first argument; the service decides whether a call runs inside a transaction.
- Services throw `AppError`; there is no separate domain error type.
- A layer that would only pass calls through is omitted: health is routes → controller → repository.

### 4.4 Module structure

```
src/
  app.ts                 shared middleware; mounts each module's router
  middleware/            shared Express middleware (request logger, not-found, error handler)
  db/                    pool, withTx, schema, migrations runner, rows.ts, errors.ts
  types/                 global type declarations, one file per augmented library (express.ts)
  modules/<feature>/
    <feature>.routes.ts    composes the module's layers and returns its router
    <feature>.controller.ts, .service.ts, .repository.ts
    <feature>.constants.ts every constant of the feature (cookie names, length limits, hashing parameters)
    <feature>.schemas.ts   every zod schema of the feature
    <feature>.types.ts     every type and interface of the feature, including `ReturnType` aliases of its factories
    shared/                helpers and feature-specific middleware
    index.ts               the feature's public exports
test/helpers/            pools, seeding, app building
```

#### Per-module file rules

These apply to every feature module, starting with `modules/auth/`, which is the reference example.

- **Constants** live only in `<feature>.constants.ts`, never inline in a layer. Settings a deployment can change live only in `src/config/`; `<feature>.constants.ts` holds fixed values. Example: `MIN_PASSWORD_LENGTH` and `ACCESS_COOKIE` in `auth.constants.ts`.
- **zod schemas** live only in `<feature>.schemas.ts`, and are shared by every caller that validates the same input. Example: `createOperatorSchema` is used by the service for both the CLI and, later, the API.
- **Global declarations** (`declare global`, module augmentation) live only in `src/types/`, one file per augmented library, never inside a module. Example: `src/types/express.ts` adds `req.auth: AuthUserType`, importing the type from the module that owns it. The files are `.ts`, not `.d.ts`, because `skipLibCheck` skips every `.d.ts` file, so a broken import there would silently turn the augmented property into `any`.
- **Type names** end in `Type`. HTTP bodies are `<Action>RequestType` and `<Action>ResponseType` (`LoginRequestType`, `LoginResponseType`, `MeResponseType`); everything else follows the same suffix (`AccountType`, `AuthSettingsType`, `AuthServiceType`). Infrastructure folders (`db`, `http`, `config`, `logging`) keep their existing names (`Db`, `Tx`, `Config`, `AppError`).
- **Types** live only in `<feature>.types.ts`: no inline object types in function signatures. Example: `insertUser(db, values: NewUser): Promise<UserSummary>`. Types inferred from a schema are declared there too (`CreateOperatorInput = z.infer<typeof createOperatorSchema>`).
- **Repositories return the executed query's result as is**, for example the `returning(...)` rows of an insert. They do no checks and no unwrapping: picking the row out, deciding that "no row" is an error, and any other interpretation belong to the service. Example: `insertUser` returns `UserSummary[]`, and `createOperator` takes the first row and fails if there is none.
- **Repositories never catch errors.** A failed query propagates unchanged to the central error handling:
  - The error handler turns known database errors into codes through `fromDatabaseError` in `src/http/errors.ts`, which maps unique-constraint names to codes (for example `users_email_unique` to `409 EMAIL_TAKEN`). A new unique rule adds one line there.
  - An unmapped database error becomes `500 INTERNAL`, never a leaked message.
  - Non-HTTP entry points (the CLI) call the same `fromDatabaseError`.
  - The one exception is a repository whose failure is the answer itself: `health.repository.ts` turns an unreachable database into `false`, because 503 is the endpoint's expected result, not an error.
- **Services validate with `validate(schema, input)`** and throw `AppError`; they catch only when a failure must be turned into a different business outcome.

Dependency rules:

- `routes → controller → service → repository`; no layer imports a layer above it.
- `modules/*` may import `db`, `http`, `logging`, `config`, `audit`, and `middleware`.
- Middleware that belongs to one feature (for example `authenticate` in `modules/auth/shared/`) lives in that feature and is exported from its `index.ts`.

## 5. Edge Cases and Failure Behavior

| Scenario | Expected behavior |
| -------- | ----------------- |
| A repository function is passed `db` where an atomic group needs `tx`. | Caught in review; the service owns every multi-statement write. |
| A failure halfway through a multi-step write. | The service's transaction rolls back every step. |

## 6. Security and Authorization

No trust boundary moves: validation stays in the controller, the first code that sees untrusted input.

## 7. Implementation Steps

Implemented 2026-10-19 on the Phase 0 code.
Modules added since follow the convention as they are written.

## 8. Test Plan

The integration suite of each feature; layering is checked in review.

## 9. Open Questions

None.

## 10. Decisions Made in This Spec

| #     | Decision | Rationale |
| ----- | -------- | --------- |
| 0.5-1 | Layering is routes → controller → service → repository, with the responsibilities in 4.3. | Owner's direction. |
| 0.5-2 | Services own transactions; repositories take an executor. | Needed to combine repository calls and audit in one transaction (T8). |
| 0.5-3 | Services throw `AppError`; no separate domain error type. | The status mapping is central (T11); a second type adds a translation layer with no benefit today. |
| 0.5-4 | Pass-through layers are omitted. | No empty files. |
| 0.5-5 | Each feature keeps its constants in `<feature>.constants.ts`, zod schemas in `<feature>.schemas.ts`, and types in `<feature>.types.ts`. | Owner's direction (2026-10-21): one predictable place for each kind of definition, so later phases follow the same shape. |
| 0.5-6 | Repositories return the query result as is, with no checks, and never catch errors; known database errors are translated centrally by `fromDatabaseError` (unique constraint name to error code), used by the error handler and the CLI. | Owner's direction (2026-10-21): error handling in one place; a repository stays a plain query. |
| 0.5-7 | Each module's routes file is its composition root; `app.ts` mounts routers and holds no module wiring. | Owner's direction: adding a module touches one line in `app.ts`. |
| 0.5-8 | Every module type ends in `Type`; request and response bodies are `<Action>RequestType` / `<Action>ResponseType`. | Owner's direction: a type is recognizable at a glance and HTTP contracts are easy to find. |
| 0.5-9 | Global type declarations live in `src/types/<library>.ts`, as type-checked `.ts` files. | Owner's direction: one place to find every change to a global type; `.ts` keeps them under `tsc`. |

Promoted to `TECHNICAL_DECISIONS.md` as T14.

## 11. Change Log

| Date       | Change | Reason |
| ---------- | ------ | ------ |
| 2026-10-17 | Initial draft. | Refactor before Phase 1. |
| 2026-10-19 | Implemented and promoted. | All steps verified. |
| 2026-10-21 | Rewritten to the convention alone; realm-specific details removed. | The auth realms it described were replaced in the MVP simplification. |
| 2026-10-21 | Added the per-module file rules (config, schemas, types) and the no-catch repository rule with central database error translation (0.5-5, 0.5-6); applied to `modules/auth/`. | Owner's direction, as the pattern for later phases. |
| 2026-10-21 | Repositories return the raw query result; result checks move to the service (0.5-6). | Owner's direction. |
| 2026-10-21 | Body validation moved from the controller to the service in the layer table, matching the per-module rules. | One schema serves every entry point (the CLI and the API). |
| 2026-10-21 | Each module's routes file composes its layers; every module type ends in `Type`, with `<Action>RequestType` / `<Action>ResponseType` for HTTP bodies (0.5-7, 0.5-8). | Owner's direction. |
| 2026-10-21 | Global declarations moved to `src/types/` (0.5-9). | Owner's direction. |
| 2026-10-27 | `<feature>.config.ts` renamed to `<feature>.constants.ts`; settings a deployment can change live only in `src/config/` (0.5-5). | Phase 9: "config" means only `src/config/`. |
