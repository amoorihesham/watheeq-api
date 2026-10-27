# Phase 10 Spec: OpenAPI Document and API Reference

| Field                  | Value                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**             | In Implementation                                                                                                                                                                                                                                                         |
| **Approved by / date** | _Amr - 27/10/2026 - 16:29 pm_                                                                                                                                                                                                                                             |
| **Depends on**         | Phase 0.5 (`phase-0.5-refactor.md`) for the layers and per-module files, Phase 8 (`phase-8-api-contract.md`) for the response, list, and error shapes and the contract tests, Phase 9 (`phase-9-config.md`), merged first because both phases touch every module's wiring |
| **Related decisions**  | Technical T14, T24, T25, T37, T52-T56; Phase 8 Q1 (reversed here)                                                                                                                                                                                                         |

---

## 1. Objective

Give the frontend a machine-readable, always-accurate description of every endpoint: an OpenAPI 3.1 document generated from the code, and a browsable reference page with "try it" on dev and staging.
Today the `.API.md` rows say "200 the request", and the shape of "the request" (about 40 fields with nested stages, assignees, deadline, and allowed actions) is only in `requests.responses.ts`.
The frontend starts now, so it needs field-level shapes and generated types from day one.

To make the document impossible to drift from the server, each endpoint is declared once as data (method, path, realm, permission, input schemas, response, errors), and the router, the input validation, the response, and the document are all built from that declaration.

This reverses Phase 8 Q1, which chose prose docs over "OpenAPI generated from code" (also the rejected alternative of T56).
Phase 8 made the shapes uniform and strict; that is what makes generating them cheap now.

## 2. Scope

**In scope:**

- One declaration per endpoint in a new `<module>.endpoints.ts` file, and one router builder that wires realm guards, permission, input validation, the handler, and the response from it.
- Request input (path parameters, query, JSON body) validated by the router builder; services receive typed, already-parsed input.
- Controllers return the value to send; the router builder sends it through `sendData`, `sendPage`, `sendNoContent`, or `sendDownload` with the declared status and schema.
- A generator that builds the OpenAPI 3.1 document from the declarations with Zod 4's own `z.toJSONSchema`, and `pnpm openapi`, which writes `docs/api/openapi.json`.
- Contract tests: the committed document is current, it is a valid OpenAPI 3.1 document, and every mounted route is a declared endpoint.
- A Scalar reference page at `/docs` and the document at `/openapi.json`, outside production only.
- The `.API.md` files of implemented phases (0-8) trimmed to an index; the API template, `docs/api/README.md`, and the spec lifecycle updated.

**Out of scope (and where it is handled instead):**

- Request and response examples in the document (Q9): try-it against dev or staging shows real data.
- Client code or type generation: the frontend runs `openapi-typescript` (or similar) on `openapi.json` in its own repository.
- Per-service form schemas: `answers` is described as an object keyed by field ID; the form itself is read from the catalog (Phase 5.5).
- A runtime check that a thrown error code is one the endpoint declares (Q6): declared codes are checked statically only.
- API versioning: there is one API version, as today.
- Serving the reference in production (Q4).
- Any change to a response, status, error code, detail code, or detail path: behavior is identical to Phase 9 (R10.11).

## 3. Requirements

| ID     | Requirement                                                                                                                                                                                                                                                                                                                                                                                       | Example                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R10.1  | Every route except `/docs` and `/openapi.json` is declared by `defineEndpoint` in its module's `<module>.endpoints.ts`, inside a `defineApi` group, and mounted only through `buildRouter`. No routes file calls `router.get/post/put/patch/delete` directly.                                                                                                                                     | _Adding `router.post("/:requestId/pin", ...)` to `requests.routes.ts` fails the route source test; adding it as a declaration puts it in the router and the document at once._                       |
| R10.2  | The set of mounted routes equals the set of declared endpoints (method and full path).                                                                                                                                                                                                                                                                                                            | _A group declared but not mounted in `app.ts`, or mounted at another prefix, fails the test._                                                                                                        |
| R10.3  | The router builder validates input in the order path parameters, query, body, with the declared schemas. A path parameter that fails its schema answers 404 `NOT_FOUND` (as today, "a non-UUID ID is answered like an unknown one"); a query or body that fails answers 400 `VALIDATION_FAILED` with the same `{path, code}` details as today (paths have no `query.` or `body.` prefix).         | _`POST /requests/not-a-uuid/accept` is 404; `POST /requests/<#42>/accept` with `{"handlerId": "x"}` is 400 with `{path: "handlerId", code: "invalid_format"}`, and the `workflowId` detail too._     |
| R10.4  | The handler receives the parsed values (`params`, `query`, `body`) with types inferred from the declared schemas; services take typed input and no longer call `validate()` on request input. Checks that need the database or the current state stay in services (answers against the service's form, workflow stage rules, calendar period rules).                                              | _`service.accept(tenantId, callerId, requestId, { handlerId, workflowId })` receives lower-cased UUIDs; whether Faisal is an active member is still checked by the service._                         |
| R10.5  | Realm guards (authentication, role, subscription guard), the tenant or platform permission, and "Active subscription required" are applied from the declaration, in today's order, before input validation.                                                                                                                                                                                       | _Khalid (no `request.review`) posting a malformed body to `/requests/<#42>/accept` still gets 403 `FORBIDDEN`, not 400, as today._                                                                   |
| R10.6  | A controller returns the value to send; the router builder sends it with the declared kind, status, and schema. The response check outside production (T55) is unchanged.                                                                                                                                                                                                                         | _`accept` returns the request; the builder sends `200 {data}` checked against `requestResponseSchema`; the controller cannot answer 201 or another schema._                                          |
| R10.7  | `pnpm openapi` writes `docs/api/openapi.json`, an OpenAPI 3.1 document built only from the declarations; the same input always gives byte-identical output. A test fails when the committed file differs from a fresh build, and when the document is not valid OpenAPI 3.1.                                                                                                                      | _A developer adds `comment` to `completeStageRequestSchema` and forgets `pnpm openapi`: the drift test fails and names the file._                                                                    |
| R10.8  | Each operation has its module's tag, a summary, the cookie security of its realm (none for public), `x-permission` when it declares one, its parameters, query, and body, the success response inside its wrapper (`{data}`, `{data, page}`, 204, or a download), and an error response per status listing its codes: the declared ones plus those its realm, permission, and inputs imply (4.5). | _`POST /requests/{requestId}/accept` lists 401 `UNAUTHENTICATED`; 403 `FORBIDDEN`, `SUBSCRIPTION_READ_ONLY`; 400 `VALIDATION_FAILED`; 404 `NOT_FOUND`; 409 `INVALID_REQUEST_STATE`; 500 `INTERNAL`._ |
| R10.9  | Declared error codes are typed as `ErrorCode`, so an unknown code does not compile; C4 already ties every `ErrorCode` to `docs/api/errors.md`.                                                                                                                                                                                                                                                    | _`errors: ["INVALID_STATE"]` fails `tsc`._                                                                                                                                                           |
| R10.10 | Outside production, `GET /docs` serves the Scalar reference of the document and `GET /openapi.json` serves the document; in production both are 404 `NOT_FOUND`. The page loads nothing from a third-party host.                                                                                                                                                                                  | _On a developer's machine, Nora's frontend colleague opens `http://localhost:<port>/docs`, calls `POST /auth/login` from the page, then `GET /requests` with the cookie the login set._              |
| R10.11 | No response, status, error code, detail, or header changes; the full suite passes. Test edits are limited to imports and tests that called a service with raw input.                                                                                                                                                                                                                              | _Every Phase 9 HTTP test passes unchanged._                                                                                                                                                          |
| R10.12 | The `.API.md` file of every implemented phase (0-9) lists each endpoint as Method, Path, Who, Purpose, Spec refs; request and response shapes, statuses, and per-endpoint error lists are removed, since `openapi.json` owns them. A phase in Draft still designs its endpoints with full shapes in `.API.md`.                                                                                    | _`phase-6-request-lifecycle.API.md` has `POST`, `/requests/:id/accept`, `request.review`, in review, "Accept with a handler and a workflow", R6.10._                                                 |

## 4. Design

### 4.1 Data model

No changes.

### 4.2 API

See [phase-10-openapi.API.md](phase-10-openapi.API.md).

### 4.3 Endpoint declarations

Each module gets `<module>.endpoints.ts` next to its `<module>.schemas.ts` and `<module>.responses.ts` (a new per-module file rule, amending T14).
It holds one `defineApi` group per router; `platform/plans` and `platform/tenants` have one each, and `roles` has two (`/roles`, `/permissions`).

```ts
// src/modules/requests/requests.endpoints.ts
const requestParams = z.strictObject({ requestId: idSchema });

export const requestsApi = defineApi({
  tag: "requests",
  prefix: "/requests",
  realm: "tenant",
  endpoints: {
    list: defineEndpoint({
      method: "get",
      path: "/",
      summary: "List the requests the caller can see",
      query: listRequestsQuerySchema,
      response: { kind: "page", schema: requestSummaryResponseSchema },
    }),
    accept: defineEndpoint({
      method: "post",
      path: "/:requestId/accept",
      summary: "Accept a request in review with a handler and a workflow",
      permission: { tenant: "request.review" },
      params: requestParams,
      body: acceptRequestSchema,
      response: { kind: "data", status: 200, schema: requestResponseSchema },
      errors: ["INVALID_REQUEST_STATE"],
    }),
    // ...
  },
});
```

Fields of an endpoint:

| Field                | Meaning                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `method`, `path`     | As mounted inside the group; `:name` for a path parameter.                                                                                                    |
| `summary`            | One line for the document. Longer behavior stays in the phase spec and `docs/api/`.                                                                           |
| `realm`              | Optional; overrides the group's realm (Q11).                                                                                                                  |
| `permission`         | Optional; `{ tenant: <key> }` or `{ platform: <key> }`, applied as `requireTenantPermission` or `requirePlatformPermission`. Party routes declare none (D31). |
| `activeSubscription` | Optional `true`; applies `requireActiveSubscription()` (only `POST /requests` today).                                                                         |
| `params`             | Required when `path` has a parameter; a strict object whose keys are exactly the path's parameter names.                                                      |
| `query`              | Optional; the list query schemas of Phase 8 or any other query schema.                                                                                        |
| `body`               | Optional; a strict object (T25), or `{ kind: "binary" }` for the raw upload of `POST /files`.                                                                 |
| `response`           | `{ kind: "data", status: 200 \| 201, schema }`, `{ kind: "page", schema }` (the item schema), `{ kind: "noContent" }`, or `{ kind: "download" }`.             |
| `errors`             | Optional; the `ErrorCode`s this endpoint adds beyond those of 4.5.                                                                                            |

Realms (each one is today's `router.use` chain, so nothing moves in the order of checks):

| Realm         | Chain                                                                    | Used by                                                                               |
| ------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `public`      | `noStore`                                                                | login, refresh, logout, verify, password reset; `/health` without `noStore`, as today |
| `session`     | `noStore`, `authenticate`                                                | `GET /auth/me`, `POST /auth/password`                                                 |
| `operator`    | `noStore`, `authenticate`, `requireRole("operator")`                     | `/operator/plans`, `/operator/tenants`                                                |
| `tenant`      | `noStore`, `authenticate`, `requireRole("user")`, `subscriptionGuard`    | every tenant module, `/files`                                                         |
| `tenantInbox` | `noStore`, `authenticate`, `requireRole("user")` (no subscription guard) | `/notifications`, which works in Read-only (Phase 7)                                  |

`buildRouter(api, handlers, { db, jwtSecret })` returns the Express router.
`handlers` is typed as one handler per endpoint key, so a missing, extra, or wrongly typed handler fails `tsc`.
Endpoints are mounted in the order they are declared, so `/catalog` stays before `/:requestId` (Express matches in order).

For each endpoint the builder mounts: the realm chain (once per router, as today), then the permission, then `requireActiveSubscription` if declared, then one step that validates `params`, `query`, and `body` (R10.3), calls the handler, and sends its result (R10.6).
The parsed input is passed to the handler as an argument, never written back to `req`: in Express 5 `req.query` is a getter and cannot be replaced.

```ts
// requests.controller.ts
accept: (async ({ params, body }, req) =>
  service.accept(tenantOf(req), callerOf(req), params.requestId, body, auditContextOf(req))
) satisfies HandlerOf<typeof requestsApi.endpoints.accept>,
```

A handler still receives `req` and `res`: auth sets cookies on `res`, and every handler reads the caller from `req`.
A download handler returns `{ file, body }`, and the builder calls `sendDownload`; the upload handler reads the raw body from `req`, as today.

`app.ts` mounts each router at its group's prefix (`app.use(requestsApi.prefix, createRequestsRouter(...))`), and `src/http/apis.ts` lists every group once for the generator; R10.2's test compares the mounted Express routes with that list, using the route walker the C5 test already has.

### 4.4 Validation moves out of services

Before: `service.accept(..., input: unknown)` starts with `validate(acceptRequestSchema, input)`, and `existingRequestId(id)` turns a malformed ID into 404.
After: the builder has already parsed both, so the service takes `AcceptRequestType` and a lower-cased ID, and `existingRequestId` and its kin (one per service, 15 today) are removed.

What stays in services: validation that needs the database or the resource's current state, built from the request's own data.
Examples: `validateAnswers` against the service's current form revision (Phase 5.5), `definitionProblems` for a calendar period, workflow stage rules.
Inline schemas a service builds for one path or query value (`effectiveFromOf`, `yearOf` in the calendar service) become part of the endpoint's declared `params` or `query`.

The `operator:create` CLI calls `validate(createOperatorRequestSchema, input)` itself before `createOperator`, since the CLI is its own trust boundary.

### 4.5 The generated document

`buildOpenApi(apis)` in `src/http/openapi.ts` turns the groups into one OpenAPI 3.1 document; `src/cli/openapi.ts` (`pnpm openapi`) writes it to `docs/api/openapi.json` as `JSON.stringify(document, null, 2)` plus a final newline, and the file is excluded from Biome so the formatter does not rewrite it.

- **Schemas:** `z.toJSONSchema` with `io: "input"` for params, query, and body (defaults and transforms seen as a client sends them), and `io: "output"` for responses. OpenAPI 3.1 uses JSON Schema 2020-12, so no conversion library is needed.
- **Dates:** response fields typed `z.date()` are serialized by JSON as ISO strings; the generator maps them to `{type: "string", format: "date-time"}` through `toJSONSchema`'s `unrepresentable` handler. A pre-draft check on 2026-10-27 converted all 108 request and response schemas of the modules this way, with no other unrepresentable type.
- **`idFilter`:** its schema is `z.unknown().default("all").transform(...)`, which converts with no type; it gets a `.meta()` describing "a UUID, `all`, or `none`" (found by the same check, for the user, position, and request lists).
- **Components:** the shared wrappers (`Page`, `Error`, `ErrorDetail`) and every top-level request and response schema are components, named by a `.meta({ id })` on the exported schema (Q13); nested shapes used in more than one place (the subscription view) get an `id` too. Ids are unique, which a test checks.
- **Paths:** `:requestId` becomes `{requestId}`; the group's prefix is joined to the endpoint's path.
- **Security:** a cookie scheme for the access cookie; every non-public operation requires it.
- **Errors:** responses grouped by status, each listing its codes in the description and using the shared `Error` schema. Codes implied by the declaration are added by the generator, so endpoints do not repeat them:

| Implied by                                                 | Codes                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| Any endpoint                                               | 500 `INTERNAL`                                        |
| A non-public realm                                         | 401 `UNAUTHENTICATED`                                 |
| Realm `operator`, `tenant`, `tenantInbox`, or a permission | 403 `FORBIDDEN`                                       |
| Realm `tenant` and a method other than GET                 | 403 `SUBSCRIPTION_READ_ONLY`                          |
| `activeSubscription`                                       | 403 `SUBSCRIPTION_NOT_ACTIVE`                         |
| `params`                                                   | 404 `NOT_FOUND`                                       |
| `query` or `body`                                          | 400 `VALIDATION_FAILED`                               |
| A JSON `body`                                              | 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE` |

- **Text:** `info.description` links to `docs/api/conventions.md`, `errors.md`, `auth.md`, and `access.md` for the rules a schema cannot state (cursors, filters, Read-only); no rule is copied into the document.
- **Order:** paths, components, and codes are emitted in a fixed order, so the drift test compares bytes.

### 4.6 The reference page

`createDocsRouter(document)` serves `GET /openapi.json` (the document built at startup, the same build the drift test proves equals the committed file) and `GET /docs` (Scalar via `@scalar/express-api-reference`, pointed at `/openapi.json`).
`buildApp` mounts it only when `server.env` is not `production`, before the 404 handler.
The page is on the API's own origin, so try-it sends the login cookies with no CORS or token setup.
The page must load its script from the package, not a CDN (R10.10); if the package cannot serve its bundle locally, step 10.4 serves the `@scalar/api-reference` standalone bundle from `node_modules` at `/docs/scalar.js` and records it as a proposal.

### 4.7 `.API.md` after this phase

| Phase state      | `.API.md` holds                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft, In Review | The endpoint design, with request and response shapes and errors, as today: no code exists yet, so `openapi.json` cannot show it.                                                                        |
| Implemented      | An index: Method, Path, Who, Purpose, Spec refs, plus the phase's behavior notes (rules no schema states, such as Phase 5.5's answer rules). Shapes, statuses, and per-endpoint error lists are removed. |

`templates/SPEC_API_TEMPLATE.md` gets both forms, and step 6 of the lifecycle in `CLAUDE.md` adds "trim the `.API.md` to its implemented form".
The C5 test keeps reading the Method and Path columns, but only of phases whose spec status is `In Implementation` or `Implemented` (Q15).
Today it reads every `.API.md`, so a Draft spec that designs a new endpoint in its table fails the suite until the route exists; this draft hit it with its own two rows.
Each trimmed row's errors are carried into its endpoint's `errors` before the row is trimmed, so nothing documented is lost.

### 4.8 Module structure

```
src/http/endpoint.ts            defineEndpoint, defineApi, realms, buildRouter, HandlerOf
src/http/openapi.ts             buildOpenApi
src/http/apis.ts                every group, for the generator and the route test
src/http/docs.ts                createDocsRouter (outside production)
src/cli/openapi.ts              pnpm openapi
src/modules/<module>/<module>.endpoints.ts      new, one per module (two groups in roles, one per platform router)
src/modules/<module>/<module>.routes.ts         builds its layers, returns buildRouter(...)
src/modules/<module>/<module>.controller.ts     handlers take parsed input and return the value
src/modules/<module>/<module>.service.ts        typed input; request-input validate() and existing*Id removed
src/cli/create-operator.ts                      validates its input itself
docs/api/openapi.json                           generated, committed
test/contract/openapi.contract.test.ts          drift, validity, unique ids, routes equal declarations
```

## 5. Edge Cases and Failure Behavior

| Scenario                                                                                 | Expected behavior                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A schema changes and `pnpm openapi` is not run.                                          | The drift test fails, naming `docs/api/openapi.json` (R10.7).                                                                                         |
| Both implementation agents regenerate `openapi.json` and their merges conflict.          | The conflict is resolved by running `pnpm openapi` on the merged code, never by hand.                                                                 |
| `POST /requests/NOT-A-UUID/accept` by Huda.                                              | 404 `NOT_FOUND`, as today (R10.3).                                                                                                                    |
| `POST /requests/<#42>/accept` with an upper-case UUID in the path.                       | Accepted; the handler sees the lower-cased ID (T37).                                                                                                  |
| Khalid, without `request.review`, posts an invalid body to `/requests/<#42>/accept`.     | 403 `FORBIDDEN`: the permission runs before validation, as today (R10.5).                                                                             |
| A Read-only tenant's user posts anything to a `tenant` route.                            | 403 `SUBSCRIPTION_READ_ONLY` from the guard, before validation, as today.                                                                             |
| Both a bad path ID and a bad body.                                                       | 404 `NOT_FOUND` only: params are checked first. Today the order varies by service; a test that expected 400 here is updated and listed in the report. |
| `GET /requests/catalog` declared after `GET /requests/:requestId`.                       | `catalog` would be read as an ID; the declaration order is the mount order, and the existing catalog test catches it.                                 |
| An endpoint declares `params` whose keys differ from the path's `:names`.                | `buildRouter` throws at startup, naming the endpoint; the test suite fails.                                                                           |
| A schema the generator cannot convert is added (for example `z.bigint()` in a response). | `pnpm openapi` and the drift test fail, naming the schema path, instead of writing a partial document.                                                |
| `NODE_ENV=production`.                                                                   | `/docs` and `/openapi.json` are 404 `NOT_FOUND` (R10.10).                                                                                             |
| A controller tries to answer with `res.json` or a status of its own.                     | C1 still fails it; with returned values the only way to answer is the declared one (R10.6).                                                           |
| An endpoint throws an error code it does not declare.                                    | Nothing fails at runtime (Q6); the document under-reports that code. The review checks declarations against the services.                             |

## 6. Security and Authorization

- **Trust boundary:** untrusted input is parsed once, by the router builder, before any controller or service runs; services no longer receive `unknown`.
  A service called from elsewhere (a job, the CLI) receives values its caller already checked.
- **Guard order is unchanged:** realm, then permission, then active subscription, then validation, so a caller without access learns nothing from validation errors (R10.5).
- **No API map in production:** `/docs` and `/openapi.json` exist only outside production. The document reveals routes and permission keys, not data; staging, where it is served, is not public.
- **The document is built only from declarations**, never from runtime data, so it cannot contain a secret or a tenant's data.
- No permission, tenant filter, or audit entry changes.

## 7. Implementation Steps

Two sub-agents, each in its own git worktree; the steps are split along their dependencies and built in the order below, with no review gate between steps; the whole spec is reviewed once at the end.

| Step                                      | Objective                                                        | Delivers                                                                                                                                                                                                                                                                                                                                                                                  | Acceptance criteria                     | Verification                                                                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10.1 Foundation on auth and health        | The pattern exists and works end to end on the reference module. | `endpoint.ts` (realms, `defineEndpoint`, `defineApi`, `buildRouter`, `HandlerOf`), `openapi.ts`, `apis.ts`, `pnpm openapi`; auth and health declared, their services on typed input, `create-operator` validating itself; the contract test file (drift, validity, unique ids, routes equal declarations, no direct `router.<method>(` in routes files) running over the declared groups. | R10.1-R10.9 for auth and health; R10.11 | `tsc`, lint, full suite green; the drift test fails after changing `loginRequestSchema` without regenerating (checked once); `openapi.json` has the auth operations with cookie security and their errors. |
| 10.2 Configuration modules                | Every configuration module is declared.                          | org, users, roles and permissions, calendar, positions, workflows, services, priorities, escalation, subscriptions, platform plans and tenants; errors carried from their `.API.md` rows into `errors`; `idFilter` meta.                                                                                                                                                                  | R10.1-R10.6, R10.9, R10.11              | Full suite green; the routes-equal-declarations test passes for these prefixes; no `validate(` on request input left in their services (grep).                                                             |
| 10.3 Requests, files, notifications       | The request lifecycle and its file routes are declared.          | requests (incl. the five stage actions, each its own declaration), files (the binary upload and the downloads), notifications (`tenantInbox`).                                                                                                                                                                                                                                            | R10.1-R10.6, R10.9, R10.11              | Full suite green; the upload and download tests pass unchanged; notifications still answer in Read-only.                                                                                                   |
| 10.4 Complete document and reference page | The whole API is in the document and browsable.                  | Every group in `apis.ts`; the route test with no exclusions; `createDocsRouter`; the final `openapi.json`; the docs pages' rows in this phase's `.API.md`.                                                                                                                                                                                                                                | R10.2, R10.7, R10.8, R10.10             | The route test passes with every group; a test that `/docs` and `/openapi.json` are 200 outside production and 404 in production; manual check that the page loads with no third-party request.            |
| 10.5 Documentation                        | The docs follow the new ownership.                               | C5 reading only implemented phases' tables (Q15); trimmed `.API.md` for phases 0-9; both forms in `SPEC_API_TEMPLATE.md`; `docs/api/README.md` (where the shapes are now, how to open `/docs`, how to generate types); the lifecycle line in `CLAUDE.md`; the Phase 0.5 per-module file rules name `<module>.endpoints.ts`.                                                               | R10.12                                  | The C5 test still passes on the trimmed tables; review of each trimmed file against its endpoint declarations.                                                                                             |

Order: agent A builds 10.1 and merges it first, then 10.3, then 10.4 once 10.2 is merged.
Agent B builds 10.2 from 10.1, then 10.5 once 10.2 and 10.3 are merged, so the Purpose cells describe the final declarations.

## 8. Test Plan

- **Contract (`test/contract/openapi.contract.test.ts`):** the committed document equals a fresh build (R10.7); it is valid OpenAPI 3.1 (Q12); component ids are unique (4.5); every mounted route is declared and every declaration is mounted (R10.2); no routes file calls `router.<method>(` (R10.1).
- **Router builder (`test/endpoint.test.ts`, on a small test group):** a bad path parameter is 404 and a bad body is 400 with today's detail paths (R10.3); the handler gets lower-cased IDs and query defaults (R10.4); permission runs before validation (R10.5); the declared status and schema are used, and a mismatching value fails the response check outside production (R10.6); a `params` schema that does not match the path throws at build time.
- **Generator (`test/openapi.test.ts`):** an operation of each realm has the right security and implied errors (R10.8); dates are `date-time` strings; an `idFilter` query parameter has a type; a download and the binary upload are described; the build is deterministic (two builds compare equal).
- **Docs pages:** `/docs` and `/openapi.json` outside production and 404 in production (R10.10).
- **Regression:** the full suite with no change to an HTTP test's expectations except the listed "bad ID and bad body" ordering cases (R10.11).
- **End-to-end (review):** a running server with throwaway containers; open `/docs`, log in from the page as a seeded tenant admin, call `GET /requests` and `POST /requests/{id}/accept` from try-it; generate TypeScript types from `openapi.json` with `openapi-typescript` and check they compile and match `requestResponseSchema`'s fields.

## 9. Open Questions

Q1-Q9 are the pre-spec discussion (2026-10-27); Q10-Q15 were raised by the draft. All are resolved.

| #   | Question                                                                             | Options                                                                                                                                                                   | Resolution                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Do we reverse Phase 8 Q1 and generate OpenAPI from code?                             | (a) Yes, for shapes; `docs/api/` keeps the behavior rules. (b) No, keep prose docs only.                                                                                  | **Resolved 2026-10-27: (a)**, an OpenAPI document generated from code owns the endpoint shapes; `docs/api/*.md` keeps owning the rules (P10.1).                                                                                                                                             |
| Q2  | Where is request input validated?                                                    | (a) By the router builder from the endpoint declaration; services take typed input. (b) In services, with declarations only naming the schemas.                           | **Resolved 2026-10-27: (a)**, the router builder validates from the declaration, so the document and the validation cannot drift; the CLI validates its own input (P10.2).                                                                                                                  |
| Q3  | Which viewer renders the document?                                                   | (a) Scalar. (b) Swagger UI. (c) Redoc.                                                                                                                                    | **Resolved 2026-10-27: (a)**, Scalar, for readable large schemas, search, and try-it (P10.5).                                                                                                                                                                                               |
| Q4  | Where is the viewer served?                                                          | (a) `/docs` outside production. (b) Everywhere. (c) Nowhere, file only.                                                                                                   | **Resolved 2026-10-27: (a)**, dev and staging only, on the API's origin so try-it uses the cookies; production does not publish the API map (P10.5).                                                                                                                                        |
| Q5  | What does an implemented phase's `.API.md` hold?                                     | (a) An index: Method, Path, Who, Purpose, Spec refs. (b) Full cells kept. (c) Deleted.                                                                                    | **Resolved 2026-10-27: (a)**, an index once implemented, full shapes while in Draft; phases 0-9 are trimmed in this phase (P10.6).                                                                                                                                                          |
| Q6  | Are per-endpoint error codes declared in code?                                       | (a) Declared, checked statically. (b) Declared and checked at runtime. (c) Only the generic error shape.                                                                  | **Resolved 2026-10-27: (a)**, declared per endpoint and typed as `ErrorCode`; no runtime check (P10.3).                                                                                                                                                                                     |
| Q7  | How is `openapi.json` produced?                                                      | (a) Committed, with a drift test. (b) Built at runtime only. (c) Both.                                                                                                    | **Resolved 2026-10-27: (a)**, `pnpm openapi` writes the committed file and a test fails when it is stale; the server serves the same build outside production (P10.4).                                                                                                                      |
| Q8  | When is this phase implemented?                                                      | (a) After Phase 9, before staging. (b) After staging. (c) Before Phase 9.                                                                                                 | **Resolved 2026-10-27: (a)**, after Phase 9 (now implemented) and before the staging phase, which will host `/docs`.                                                                                                                                                                        |
| Q9  | Does the document carry examples?                                                    | (a) No. (b) Hand-written examples through `.meta()`.                                                                                                                      | **Resolved 2026-10-27: (a)**, no examples; try-it shows real data and nothing extra needs keeping in step.                                                                                                                                                                                  |
| Q10 | How does a handler answer?                                                           | (a) It returns the value; the builder sends it with the declared kind, status, and schema. (b) It calls `sendData` itself with the declared schema.                       | **Resolved 2026-10-27: (a)**, a handler returns the value and the builder sends it with the declared kind, status, and schema, so it cannot send another than the document shows; C1 keeps forbidding direct writes (R10.6, P10.7).                                                         |
| Q11 | Where is the realm declared?                                                         | (a) On the group, with an optional per-endpoint override (only auth uses it). (b) Required on every endpoint.                                                             | **Resolved 2026-10-27: (a)**, the realm is declared once per group, with an optional per-endpoint override that only auth's `me` and `password` use (`session`) (P10.7).                                                                                                                    |
| Q12 | What checks that the document is valid OpenAPI 3.1?                                  | (a) `@scalar/openapi-parser` in the contract test (dev dependency). (b) `@redocly/cli lint` as a script. (c) No check.                                                    | **Resolved 2026-10-27: (a)**, `@scalar/openapi-parser` validates the generated document inside the contract test, as a dev dependency (P10.4).                                                                                                                                              |
| Q13 | How are components named?                                                            | (a) `.meta({ id: "Request" })` on each exported top-level schema and on nested shapes reused across responses. (b) Generated from the endpoint key (`AcceptRequestBody`). | **Resolved 2026-10-27: (a)**, components are named by `.meta({ id })` on each exported top-level schema and on nested shapes reused across responses (`Request`, `RequestSummary`) (P10.7).                                                                                                 |
| Q14 | Do trimmed `.API.md` files keep their "New error codes" sections and behavior notes? | (a) Keep behavior notes and the error-code sections as the design record. (b) Keep behavior notes; remove error-code sections (`errors.md` owns codes).                   | **Resolved 2026-10-27: (b)**, trimmed files keep their behavior notes and drop their error-code sections: `docs/api/errors.md` owns every code and `openapi.json` owns which endpoint returns it (P10.6).                                                                                   |
| Q15 | Which `.API.md` tables does the C5 route test read?                                  | (a) Only those of phases whose spec status is `In Implementation` or `Implemented`. (b) All, as today; draft endpoints are written as lists until mounted.                | **Resolved 2026-10-27: (a)**, C5 reads only the tables of phases whose spec status is `In Implementation` or `Implemented`, so a Draft spec can design endpoints in the template's table (4.7); the change is made in step 10.5, and this draft lists its two endpoints until then (P10.6). |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #     | Decision                                                                                                                                                                                                                                       | Rationale                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P10.1 | An OpenAPI 3.1 document generated from the code owns the endpoint shapes, statuses, and per-endpoint errors; `docs/api/*.md` owns the rules; the phase specs own the design. Reverses Phase 8 Q1.                                              | The frontend gets exact shapes and generated types, and none of it can drift from the server.                      |
| P10.2 | Every endpoint is declared once as data in `<module>.endpoints.ts`; the router, input validation, response, and document are built from it; services take typed input.                                                                         | One source of truth: a declared schema is the one enforced and the one documented.                                 |
| P10.3 | Per-endpoint error codes are declared and typed; codes implied by the realm, permission, and inputs are added by the generator.                                                                                                                | Endpoints list only what is theirs; the generic codes are correct everywhere without repetition.                   |
| P10.4 | `docs/api/openapi.json` is committed and regenerated by `pnpm openapi`; a test fails when it is stale or invalid.                                                                                                                              | The frontend can pin a version and see contract changes in a diff.                                                 |
| P10.5 | Scalar serves the document at `/docs` outside production, from the API's origin, with no third-party request.                                                                                                                                  | Try-it works with the session cookies; production does not publish the API map.                                    |
| P10.6 | An implemented phase's `.API.md` is an index (Method, Path, Who, Purpose, Spec refs, behavior notes, no error-code section); full shapes only while the spec is in Draft; C5 reads only the tables of phases in implementation or implemented. | Each fact has one owner; the spec still designs endpoints before code exists, without failing the suite.           |
| P10.7 | Handlers return the value to send; the realm is declared per group with a per-endpoint override; components are named by `.meta({ id })` on the schemas.                                                                                       | The builder is the only way to answer, one realm line per router as today, and the document reads in domain names. |

Promote these to `TECHNICAL_DECISIONS.md` when the phase is implemented: a new T-entry for P10.1-P10.5 and P10.7, T14 amended for `<module>.endpoints.ts` and validation in the router builder, and T56's rejected alternative updated.

## 11. Change Log

| Date       | Change                        | Reason                                      |
| ---------- | ----------------------------- | ------------------------------------------- |
| 2026-10-27 | Initial draft.                | Pre-spec discussion with the owner (Q1-Q9). |
| 2026-10-27 | Q10-Q15 resolved as proposed. | Owner accepted the proposed answers.        |
