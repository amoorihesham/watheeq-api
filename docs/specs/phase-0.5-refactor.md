# Phase 0.5 Spec: Layered Architecture Refactor

| Field                  | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| **Status**             | In Implementation                                              |
| **Approved by / date** | _Amr - 19/10/2026 - 18:06 pm_                                  |
| **Depends on**         | Phase 0 (`phase-0-foundations.md`)                             |
| **Related decisions**  | Technical T3, T8, T9, T15, T21; Phase 0 module structure (4.4) |

---

## 1. Objective

Restructure the Phase 0 code into a layered, feature-module layout (routes → controller → service → repository) without changing any observable behavior.
It is needed now because Phase 1 adds the first business rules (subscriptions, user limits) and the first non-auth routes, and they need a clear home before they are written.

## 2. Scope

**In scope:**

- A layering convention: routes → controller → service → repository, with clear responsibilities per layer.
- Moving the auth realms (operator, tenant) and health to that convention.
- Moving duplicated auth code (login body schema, `no-store`, fixation-safe session swap, `/session` handling, `requireAuth`) into `modules/auth/shared/`.
- A central `src/middleware/` folder for all Express middleware, with each realm's auth middleware built once in `app.ts`.
- A typed accessor for the authenticated principal, replacing the per-file `requireAuth` helpers.
- Small database helpers used by repositories (raw-row timestamps, unique-violation detection).
- Shared test helpers (pools, seeding, app building, realm login).

**Out of scope (and where it is handled instead):**

- Any behavior change, bug fix, or new feature: recorded as a follow-up, never folded in.
- Database schema, migrations, grants, RLS policies, and database roles: unchanged.
- How operator (platform-level) actions are audited, and whether audit context is built per request: Phase 1.
- How tenants are created given the runtime role's read-only access to `tenants`: Phase 1.
- New error codes, new routes, new configuration keys, new dependencies: none.

## 3. Requirements

| ID     | Requirement                                                                                                                              | Example                                                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0.5.1 | Every HTTP endpoint keeps its path, status codes, response body, and headers (`Set-Cookie` flags, `Cache-Control`, `X-Request-Id`).      | _Sara posts a wrong password to `/auth/login` before and after the refactor and receives the identical 401 `INVALID_CREDENTIALS` response and headers._ |
| R0.5.2 | Every database operation keeps its SQL semantics and transaction boundaries. Operations that were atomic stay atomic in one transaction. | _A successful login still resets the failure count, revokes the presented session, and inserts the new session in one transaction in Sara's tenant._    |
| R0.5.3 | Log lines keep their level, message, and fields.                                                                                         | _A failed operator login still logs `operator login failed` at `warn` with `reason` and `subjectId`._                                                   |
| R0.5.4 | The test suite keeps the same test names and the same assertions. Only imports and setup code move into shared helpers.                  | _`tenant-auth.test.ts` lists the same tests before and after, and no `expect(...)` line changes._                                                       |
| R0.5.5 | Every module follows the layering rules in 4.4, so a reader can predict where any piece of code lives.                                   | _A reviewer looking for the "account locked" check finds it in the auth service layer, not in a controller or repository._                              |
| R0.5.6 | `pnpm operator:create` keeps its behavior, messages, and exit codes.                                                                     | _Creating a duplicate operator still prints "An operator with email ... already exists." and exits non-zero._                                           |

## 4. Design

### 4.1 Data model

No changes.

### 4.2 API

No changes. Every route in Phase 0 section 4.2 behaves exactly as before.

### 4.3 Key flows and state transitions

#### Layer responsibilities

| Layer      | Owns                                                                                                                                                       | Must not                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Routes     | Paths, HTTP methods, which middleware and controller handler apply                                                                                         | Contain logic                                                 |
| Controller | Reading the request (body validation with zod, cookies, client IP, user agent), calling one service function, writing the response (status, cookies, JSON) | Query the database, open transactions, contain business rules |
| Service    | Business rules and flow, transaction boundaries (`withTenantTx`, `db.transaction`), calling `audit()`                                                      | Read `req` or write `res`                                     |
| Repository | Single queries against Drizzle, mapping raw rows, translating PostgreSQL errors                                                                            | Open transactions, contain business rules                     |

Services throw `AppError` (decision 10.3).
The controller layer passes a `Logger` (the request's child logger) into services that log, so services never see `req`.

#### Transaction ownership (decided in open question 1)

Repository functions take an executor (`Db | Tx`) as their first argument, and the service decides whether a call runs inside a transaction.

_Before:_ `replaceSession` in `tenant-store.ts` opens its own `withTenantTx` and runs three statements inside it.
_After:_ the tenant auth service opens `withTenantTx` and calls three repository functions with the same `tx`.

Why this matters for Phase 1 (illustration only, not a Phase 1 design): adding a user to Al-Noor will probably need "check the plan limit, insert the user, write the audit entry" in one transaction (T8).
That is only possible if the service owns the transaction and passes `tx` to each repository call and to `audit(tx, ...)`, which already accepts only a `Tx` (T15).

#### Example: tenant login after the refactor

1. **Routes:** `POST /auth/login` → `tenantAuthController.login`.
2. **Controller:** validates the body, reads the client IP, user agent, and presented cookie, and calls `tenantAuthService.login(...)` with the request logger.
3. **Service:** runs `checkCredentials` (shared), generates the token, and in one `withTenantTx` calls the repository to reset the failure count, revoke the presented session, and insert the new session. It returns the user, the session token, and the CSRF token.
4. **Controller:** sets the cookie, logs `tenant user logged in`, and responds with the same JSON as today.

### 4.4 Module structure

```
src/
  main.ts                    unchanged
  app.ts                     composition root: builds repositories → services → middleware → controllers → routes
  config/                    unchanged
  logging/                   logger.ts
  http/                      errors.ts (AppError), validate.ts: non-middleware HTTP helpers
  middleware/                every Express middleware
    request-logger.ts        pino-http with request ID generation (was logging/http-logger.ts + http/request-id.ts)
    json-body.ts
    no-store.ts              Cache-Control: no-store (was duplicated in both auth routers)
    not-found.ts
    error-handler.ts
    session-auth.ts          the shared sessionAuth steps
    require-operator.ts      built once in app.ts; also exports the typed principal accessor
    require-user.ts          same, for the tenant realm
  db/
    pool.ts, tenant-tx.ts, migrate.ts, schema/   unchanged
    executor.ts              type Executor = Db | Tx
    rows.ts                  raw-row timestamp helper (epoch milliseconds → Date)
    errors.ts                isUniqueViolation(err)
  audit/                     unchanged
  modules/
    auth/
      shared/                utils: tokens, passwords, cookies, csrf, client-ip, ip-throttle, account-throttle,
                             credential check, login body schema, session-swap helper
      operator/
        operator-auth.routes.ts
        operator-auth.controller.ts
        operator-auth.service.ts      includes createOperator (used by the CLI)
        operator.repository.ts
      tenant/
        tenant-auth.routes.ts
        tenant-auth.controller.ts
        tenant-auth.service.ts
        tenant.repository.ts
    health/
      health.routes.ts
      health.controller.ts
      health.repository.ts            no service layer (open question 3)
  cli/                       calls the operator service; argument parsing and output unchanged
test/
  helpers/
    config.ts, log-capture.ts   unchanged
    db.ts                    app/admin/owner pools, seedTenant, seedUser, rejectionText
    app.ts                   buildTestApp(overrides)
    auth.ts                  login(realm, ...), authed(realm, token), sessionRow(realm, token)
```

Dependency rules:

- `routes → controller → service → repository`; no layer imports a layer above it.
- `middleware/require-*.ts` depends on the realm's service (to resolve and touch sessions), never on a repository.
- `modules/*` may import `db`, `http`, `logging`, `config`, `audit`, and `middleware`; `modules/auth/shared` is imported only by the auth realms and auth middleware.

## 5. Edge Cases and Failure Behavior

| Scenario                                                                               | Expected behavior                                                                                                                                               |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A login fails halfway through the session swap (for example the insert fails)          | The whole swap rolls back exactly as today, because the service runs all three repository calls on one `tx`. Covered by existing tests.                         |
| A repository function is called with `db` where the old code used a transaction        | Prevented by review against the "Before" transaction list captured in step 0.5.1; each atomic group in Phase 0 is listed and checked in the step that moves it. |
| A file move silently drops a middleware (for example `no-store` on `/operator/auth/*`) | Caught by the existing header assertions and by the E2E baseline comparison.                                                                                    |
| Concurrent requests touching one session                                               | Unchanged: the conditional `last_seen_at` update is moved as is.                                                                                                |

## 6. Security and Authorization

No trust boundary moves.
Validation stays at the controller, the first code that sees untrusted input.
Realm separation (T6, T16) is preserved: each realm keeps its own cookie, middleware, and repository, and the shared code takes the realm's cookie name and lookup as parameters, as `sessionAuth` does today.
The pre-tenant `SECURITY DEFINER` lookups (T13) are called only from the tenant repository, unchanged.

## 7. Implementation Steps

Steps run in order, one at a time, with a review stop after each.

| Step  | Objective                                         | Delivers                                                                                                                                                                                                                                                                                                                  | Acceptance criteria                                                                                              | Verification                                                                                                        |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 0.5.1 | Safety net and shared test helpers                | `test/helpers/{db,app,auth}.ts`; test files use them. A baseline: `vitest list` output, an E2E transcript (curl against `pnpm dev` with Docker Compose: login, session, logout, wrong password, CSRF failure, for both realms, with status codes, headers, and bodies), and the list of atomic database groups in Phase 0 | No production code changed. Same test names. No assertion line changed. All tests pass                           | `vitest list` diff is empty; `git diff` on `src/` is empty; review of assertion lines; full suite green             |
| 0.5.2 | Central middleware and module layout              | `src/middleware/`, `src/modules/`, `db/executor.ts`; `no-store` extracted; auth middleware built once in `app.ts` and passed to routers                                                                                                                                                                                   | R0.5.1, R0.5.3, R0.5.4 hold. Files moved with `git mv` so history follows                                        | Full suite green; E2E transcript identical to baseline (except request IDs and tokens); lint, typecheck, build pass |
| 0.5.3 | Operator realm layered                            | Operator routes, controller, service, repository; CLI calls the service; `isUniqueViolation`; typed principal accessor for operators                                                                                                                                                                                      | R0.5.1-R0.5.6 for the operator realm. Operator atomic groups from the baseline list stay in one transaction      | Same as 0.5.2, plus the CLI tests in `operator-auth.test.ts`                                                        |
| 0.5.4 | Tenant realm layered and auth duplication removed | Tenant routes, controller, service, repository; `db/rows.ts`; duplicated auth code moved to `modules/auth/shared/`; typed principal accessor for users                                                                                                                                                                    | R0.5.1-R0.5.5 for the tenant realm. No code block duplicated between the two realms beyond realm-specific wiring | Same as 0.5.2; side-by-side review of the two realms                                                                |
| 0.5.5 | Health module and close-out                       | Health on the convention; the layering convention recorded as T23 in `TECHNICAL_DECISIONS.md`; roadmap updated                                                                                                                                                                                                            | All requirements hold on a fresh database                                                                        | Fresh-container full suite; E2E transcript identical to baseline; lint, typecheck, build pass                       |

## 8. Test Plan

- **Existing integration suite (real PostgreSQL):** the main proof for R0.5.1-R0.5.4 and R0.5.6. It runs unchanged in assertions after every step.
- **Test inventory:** `vitest list` before and after every step, to prove no test was lost or renamed (R0.5.4).
- **E2E transcript:** the baseline from step 0.5.1, replayed after steps 0.5.2-0.5.5 against a running server, compared on status codes, header names and flags, and body shapes (R0.5.1).
- **Review:** layering rules (R0.5.5) and the atomic-group list (R0.5.2) are checked by reading the diff in each step.

## 9. Open Questions

| #   | Question                                    | Options                                                                                                                                                                                                                                                                                                                   | Resolution                                                   |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Who owns transaction boundaries?            | (a) Service opens transactions; repositories take an executor (recommended: required for audit in the same transaction, T8). (b) Repository opens its own transactions (simpler per call, but services cannot combine calls with `audit()`).                                                                              | (a) Service owns transactions.                               |
| 2   | How are layers written?                     | (a) Factory functions closing over dependencies, e.g. `createTenantAuthService({ repo, throttle, lifetimes })` (recommended: matches the existing router factories; one composition point in `app.ts`). (b) Classes with constructor injection. (c) Plain functions that take `db` on every call, as the stores do today. | (a) Factory functions.                                       |
| 3   | Must trivial modules have every layer?      | (a) A layer may be omitted only when it would be a pure pass-through; health becomes routes → controller → repository (recommended: no empty files). (b) Every module has all four layers for uniformity.                                                                                                                 | (a) Pass-through layers are omitted.                         |
| 4   | Where do feature modules live?              | (a) `src/modules/<feature>/`, separate from infrastructure (`db`, `http`, `middleware`, `logging`) (recommended). (b) Keep features at `src/<feature>/` beside infrastructure, as today.                                                                                                                                  | (a) `src/modules/<feature>/`.                                |
| 5   | How much request-context work belongs here? | (a) Only the typed principal accessor (recommended: pure refactor). (b) Also build an `AuditContext` per request (depends on the Phase 1 operator-audit decision, so deferred).                                                                                                                                           | (a) Typed accessor only; `AuditContext` deferred to Phase 1. |
| 6   | Phase name and number                       | `Phase 0.5`, file `phase-0.5-refactor.md` (proposed).                                                                                                                                                                                                                                                                     | Phase 0.5.                                                   |

## 10. Decisions Made in This Spec

| #     | Decision                                                                                              | Rationale                                                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.5-1 | Layering is routes → controller → service → repository, with the responsibilities in 4.3              | Owner's direction; gives business rules a home that is neither HTTP nor SQL                                                                      |
| 0.5-2 | Duplicated auth code goes to `modules/auth/shared/`; all middleware goes to `src/middleware/`         | Owner's direction                                                                                                                                |
| 0.5-3 | Services throw `AppError`; there is no separate domain error type                                     | `AppError` holds only a code, and the status mapping is central (T21); a second error type would add a translation layer with no current benefit |
| 0.5-4 | The refactor is strictly behavior-preserving; anything that changes behavior becomes a follow-up item | Lets the existing suite prove correctness without changing assertions                                                                            |
| 0.5-5 | Phase 1 decisions (operator audit, tenant creation) are not designed here                             | Owner's direction; avoids designing for guessed needs                                                                                            |

Promote these to `TECHNICAL_DECISIONS.md` when the phase is implemented.

## 11. Change Log

| Date       | Change                                                   | Reason                                |
| ---------- | -------------------------------------------------------- | ------------------------------------- |
| 2026-10-17 | Initial draft                                            | Refactor before Phase 1, as requested |
| 2026-10-19 | Open questions 1-6 resolved with the recommended options | Owner accepted the draft              |
