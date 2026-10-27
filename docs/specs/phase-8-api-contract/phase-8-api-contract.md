# Phase 8 Spec: API Contract

| Field                  | Value                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**             | Implemented                                                                                                                                                            |
| **Approved by / date** | _Amr - 26/10/2026 - 19:23 pm_ |
| **Depends on**         | Every implemented phase: Phase 0 (`phase-0-foundations.md`) and 0.5 (`phase-0.5-refactor.md`) for the HTTP layer, and Phases 1-7 for the endpoints whose shapes change |
| **Related decisions**  | Technical T2, T7, T11, T14, T16, T18, T20, T25, T29, T37, T39, T45, T50; Phase 7 P7.8 and its `unread=false` close-out rule (reversed here)                            |

---

## 1. Objective

Make the HTTP API one uniform contract that the web app can be built against: every endpoint answers in the same success, list, and error shapes, takes filters and values in the same forms, and the rules are written once in `docs/api/`.
It is needed now because the MVP phases are implemented and the frontend starts next; today each module answers in its own shape (`{priority}`, `{subscription, usage}`, three paging styles), and nothing checks that a new endpoint follows any rule.
The checks built here make a deviation fail a test instead of reaching the frontend.

## 2. Scope

**In scope:**

- One success shape, `{data}`, with lists as `{data, page}` and 204 when nothing is left to show (Q2-Q4).
- Cursor paging with a total on every list endpoint, one fixed order per list (Q5-Q8).
- One filter rule for every list (Q12).
- One error shape with `details` always present, `path` only meaning a place in the input, merged code families, and no unmapped errors (Q9-Q11).
- The request-side rules written down and applied: methods, `null` in `PATCH`, value formats, text trimming, and the upload and download transport (Q13-Q14).
- The helpers that make the rules hold by construction, and the tests that catch drift (Q15).
- The `docs/api/` files, the README sections they replace, and every phase's `.API.md` updated to the new shapes (Q1, Q16, Q20).

**Out of scope (and where it is handled instead):**

- A local staging setup that runs the API next to other local projects: a later phase (its ports collide with the `c360-*` containers on the development machine).
- Client-chosen sorting (`sort=` by column): deferred until a screen needs it (Q7).
- Making `total` opt-in when counting becomes slow: deferred hardening with a trigger (Q8).
- A machine-readable contract (OpenAPI) or per-endpoint reference pages: the owner chose HTTP-behavior docs plus the phase `.API.md` files (Q1).
- New endpoints or business behavior: none; only shapes, filters, paging, and errors change.

## 3. Requirements

Example tenant **Al-Noor**, as in the Phase 6 and 7 specs: Sara is the owner (Tenant Admin), Huda and Ahmed manage Legal Affairs, Faisal manages Contracts and handles requests, Nora is in Contracts, and Khalid in Procurement submits requests.
Al-Noor has 128 active members, 6 priorities (one retired), 60 requests in review, and Faisal has 40 notifications.

| ID    | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Example                                                                                                                                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R8.1  | Every successful response with a body is `{"data": ...}`: an object for one item or a composite view, an array for a list. Nothing else sits at the top level except `page` on a list.                                                                                                                                                                                                                                                                                                                  | _`GET /priorities/<urgent>` used to be `{priority: {...}}`; it is `{data: {id, name, days, retired}}`. `GET /subscription` is `{data: {subscription, usage}}`. `GET /health` is `{data: {status: "ok", db: "up"}}`._                                                                                                    |
| R8.2  | A write returns the resource it changed, inside `data`, in exactly the shape its read returns: the item's own `GET`, or its entry in the list or composite view that shows it.                                                                                                                                                                                                                                                                                                                          | _Huda accepts #42: the response's `data` equals `GET /requests/<#42>`'s `data`. Sara creates a holiday: `data` equals that period's entry in `GET /calendar`. `POST /auth/login` returns what `GET /auth/me` returns (Q17)._                                                                                            |
| R8.3  | 201 means a new resource with its own URL was created; 204 means nothing is left to show (deletes, logout, password calls, resends, marking read) and has no body; every other success is 200.                                                                                                                                                                                                                                                                                                          | _Faisal asks Khalid a question on #42: 200 with the request (it was 201). Sara deletes the Litigation section: 204._                                                                                                                                                                                                    |
| R8.4  | Every field of a response is always present; an empty value is `null`, never a missing key. Variants of one shape carry the same keys.                                                                                                                                                                                                                                                                                                                                                                  | _`GET /escalation` before settings exist was `{configured: false}`; it is `{data: {configured: false, settings: null}}`. A removed file in an answer is `{id, removed: true, name: null, contentType: null, sizeBytes: null}`. A day off in `GET /calendar/days` has `start: null, end: null, season: null`._           |
| R8.5  | Every list endpoint (4.2.3) is paged: `?cursor=&limit=` in, `{data: [...], page: {nextCursor, total}}` out. `limit` defaults to 25 and is at most 100; `nextCursor` is `null` on the last page. Collections inside one resource (a request's files, a workflow's stages, the org tree, `GET /calendar`'s periods) stay arrays inside it.                                                                                                                                                                | _Sara opens the users list: 25 members, `page: {nextCursor: "eyJr...", total: 128}`; "Load more" sends the cursor and gets the next 25. Al-Noor's 6 priorities come in one page with `nextCursor: null`._                                                                                                               |
| R8.6  | Each list has one fixed order, declared with its sort keys in its `.API.md`, ending with the ID as tie-breaker, all keys in the same direction. A page continues strictly after the last item of the previous page, so items added, removed, or tied never cause a repeat or a skip.                                                                                                                                                                                                                    | _Three notifications written by one transaction share a `created_at`; the first page ends between them; the second page starts with the next one by ID, and none is skipped. A new request submitted while Faisal reads page 1 of the review queue does not push a seen request onto page 2._                           |
| R8.7  | A cursor is opaque. It carries the last item's sort values and a fingerprint of the list and its filters (after defaults). A cursor used with other filters, another list, or altered or broken is refused with 400 `VALIDATION_FAILED`, detail `{path: "cursor", code: "invalid_cursor"}`. `limit` may change between pages.                                                                                                                                                                           | _Faisal is on page 2 of `view=review_queue` and the app sends the same cursor with `view=handling`: 400 `invalid_cursor`, so the app restarts the tab instead of silently missing the requests he handles._                                                                                                             |
| R8.8  | `total` is the number of items matching the request's filters (not the items left), computed in the same database snapshot as the page.                                                                                                                                                                                                                                                                                                                                                                 | _Page 1 and page 3 of the users list both say 128. Sara invites a new member between Faisal's page 1 and page 2: page 2 says 129. A member invited between the page query and the count of one call can never make that call's page and total disagree._                                                                |
| R8.9  | Every list filter follows one rule: `field=value` keeps the items whose field has that value; every filter also accepts `all` (no filter on that field); a filter left out takes the list's documented default; `none` asks for items where the field is empty. `q` (text search) and `view` (a named list relative to the caller) are the only parameters that are not field filters. An unaccepted value is 400 with `{path: <filter>, code: "invalid_value"}`; unknown parameters are ignored (T25). | _`GET /notifications?unread=false` returns only read notifications (it returned everything). `GET /priorities` shows the 5 active priorities; `?retired=all` shows all 6; `?retired=true` only the retired one. `GET /users?unitId=none` lists Sara and Lina._                                                          |
| R8.10 | Every error is `{"error": {"code", "requestId", "details"}}` with no message: `details` is always an array, each detail is exactly `{path, code}`, and nothing else is added. `path` is a place in the request input (`name`, `stages.2.position`, `cursor`), or `""` when the problem is the whole body or no field.                                                                                                                                                                                   | _Invalid JSON: `{error: {code: "VALIDATION_FAILED", requestId, details: [{path: "", code: "invalid_json"}]}}` (it had no `details`). An unknown route: `details: []`._                                                                                                                                                  |
| R8.11 | Every error caused by one input field has a detail with that field's path. Unique-value conflicts are one code, `TAKEN` (409), and version conflicts one code, `VERSION_CHANGED` (409). A refusal under the subset rule points at the entry the actor sent; a refusal of the route's own permission has no details.                                                                                                                                                                                     | _Sara creates a priority named "Urgent", which exists: 409 `TAKEN`, `[{path: "name", code: "taken"}]` (it was `PRIORITY_NAME_TAKEN`). Huda saves a role with a permission she holds only at department scope as the fourth entry: 403 `PERMISSION_NOT_HELD`, `[{path: "permissions.3", code: "permission_not_held"}]`._ |
| R8.12 | Each status has one meaning (4.2.5). 500 `INTERNAL` is only for server faults: every client error raised by Express or the body parser maps to a documented code, and `/health` with the database down is 503 `SERVICE_UNAVAILABLE`.                                                                                                                                                                                                                                                                    | _`GET /users/%zz` is 404 `NOT_FOUND` (fixed before this phase, commit `12b6e83`). The database stops: `/health` is 503 with the error shape._                                                                                                                                                                           |
| R8.13 | The request-side rules hold on every endpoint: the method table of 4.2.6; in `PATCH`, a field left out is unchanged and `null` clears it; the value formats of 4.2.7; text trimmed, a blank optional text stored as `null`, a blank required text refused as `too_small`.                                                                                                                                                                                                                               | _`PATCH /users/<huda> {unitId: null}` moves Huda directly under the organization. A role description of `"   "` is stored as `null`._                                                                                                                                                                                   |
| R8.14 | Uploads send the file's raw bytes with its name in the query string and answer 201 `{data: file}`; downloads answer the raw bytes as an attachment. These two are the only bodies that are not JSON.                                                                                                                                                                                                                                                                                                    | _Khalid's browser sends `fetch("/files?name=contract.pdf", {method: "POST", body: file})` and gets `{data: {id, name, ...}}`._                                                                                                                                                                                          |
| R8.15 | Responses can only be written through the response helpers; a direct `res.json` or `res.send` in a controller fails a test.                                                                                                                                                                                                                                                                                                                                                                             | _A new `GET /holidays/export` written with `res.json({holidays})` fails the contract test before review._                                                                                                                                                                                                               |
| R8.16 | Outside production, every response is checked against its endpoint's response schema before it is sent; a mismatch, a missing field, or an extra field is a server error naming the field. In production the check is skipped.                                                                                                                                                                                                                                                                          | _A change adds `retiredAt` to the priority object but not to its schema: the first priority test fails and names `retiredAt`. A repository that starts returning `passwordHash` with a user fails every users test._                                                                                                    |
| R8.17 | Every error code and detail code the server can return is listed in `docs/api/errors.md`, and every code listed there exists; every mounted route appears in a phase `.API.md` table, and every route in those tables exists. Tests check both directions.                                                                                                                                                                                                                                              | _A new `HOLIDAY_LOCKED` code without an `errors.md` row fails a test; so does a route without an `.API.md` row, or an `.API.md` row for a route that was removed._                                                                                                                                                      |
| R8.18 | `docs/api/` describes the HTTP behavior once (4.2.8); the README keeps setup and points there; every phase's `.API.md` describes its endpoints' `data` under the new rules.                                                                                                                                                                                                                                                                                                                             | _A frontend developer reads `conventions.md` and `errors.md` once, then only the `.API.md` row of each endpoint they call._                                                                                                                                                                                             |

## 4. Design

### 4.1 Data model

No tables change.
Indexes that already serve each list's order are reused; one is added where an order had none: `requests_submitted_idx` on `(tenant_id, submitted_at desc, id desc)` for `GET /requests` (migration `0023`).
The other lists are small per tenant or operator-wide, and notifications already had an index matching its order.

### 4.2 API

The endpoint-level changes are listed in [phase-8-api-contract.API.md](phase-8-api-contract.API.md).
This section is the design of the rules themselves, which `docs/api/` will state for clients.

#### 4.2.1 Success responses

| Case                            | Status | Body                                     |
| ------------------------------- | ------ | ---------------------------------------- |
| One item or a composite view    | 200    | `{"data": {...}}`                        |
| A new resource with its own URL | 201    | `{"data": {...}}`, the created item      |
| A list                          | 200    | `{"data": [...], "page": {...}}` (4.2.3) |
| Nothing left to show            | 204    | none                                     |

Why `data` instead of bare objects: a bare array leaves no place for `page`, and adding a wrapper later breaks every client.
Why not named keys (`{priority}`): the client would need a different key for each endpoint.

"The shape its read returns" (R8.2) is decided per resource:

| Write                                                              | Returns the shape of                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Any write on an item with its own `GET`                            | that `GET`                                                                 |
| `PUT /calendar/hours/:effectiveFrom`                               | an entry of `GET /calendar`'s `hours`                                      |
| Period and override writes                                         | an entry of `GET /calendar`'s `periods`                                    |
| `PUT /escalation`                                                  | `GET /escalation`                                                          |
| `POST /auth/login`, `POST /auth/refresh`                           | `GET /auth/me` (`{user, subscription}`) (Q17)                              |
| `POST /operator/tenants`, `PUT /operator/tenants/:id/subscription` | `GET /operator/tenants/:id`: `{tenant, subscription, usage}` in full (Q18) |
| `PUT /priorities/order`                                            | 204 (Q19)                                                                  |

A value computed when it is read, such as the elapsed and awaiting times of an open request's SLA (D39), is as of each answer, so the read after a write can show a later value; every other field is equal.

#### 4.2.2 Response schemas

Each endpoint's response gets a zod schema, written in a new `<feature>.responses.ts` per module (Q21), and the response types become `z.output` of those schemas, replacing the hand-written interfaces.
Response schemas are strict objects with no optional keys: a nullable key is `.nullable()`, never `.optional()`, which is how R8.4 is enforced (a test fails on `.optional()`, `.nullish()`, `.partial()`, or plain `z.object` in a `*.responses.ts` file, as T25's test does for request bodies; `.nullish()` and `.partial()` were added during implementation because they create optional keys too).
Timestamps are validated as `Date` before serialization; `JSON.stringify` writes them as ISO 8601 UTC with milliseconds (4.2.7).

Shapes that used to differ by variant now carry the same keys (R8.4):

| Shape                                   | Every variant is                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Form field (services, catalog, answers) | `{id, type, label, helpText, required, min, max, integer, options, maxFiles}`, `null` for settings the type has none of (Q22)                          |
| Weekday of a week shape                 | `{mode, start, end}`, `mode` `default`, `off`, or `custom`; `start` and `end` are `null` unless `custom` (Q23)                                          |
| Assignee target (stages, recipients)    | `{position, name, builtin}`, `null` where it does not apply                                                                                             |
| Calendar period                         | every key of every kind and recurrence, `null` (or `[]` for `overrides`) where it does not apply                                                       |

The form save and the hours and season saves accept the same shapes, so a client sends back what it read: a setting of another type may be `null` and is dropped, and a non-null one is `unknown_field`; a `custom` day needs `start` and `end` (`required`), and another mode refuses them (`not_allowed`).
The database keeps its stored shapes (a field with its own settings, a day as `"default"`, `"off"`, or a span); `fieldView` and `weekView` convert at the response.

The helpers in `src/http/respond.ts` are the only way to write a JSON body (R8.15):

```ts
sendData(res, status: 200 | 201, schema, value)   // { data: value }
sendPage(res, itemSchema, page)                    // { data: page.items, page: { nextCursor, total } }
sendNoContent(res)                                 // 204
```

Outside production (`NODE_ENV` is `development` or `test`), `sendData` and `sendPage` parse the value with the schema first and throw on a mismatch, so the error handler answers 500 and logs the zod issues with their paths (R8.16).
Whether the check runs is one process-wide setting in `src/http/checks.ts`, on by default and set once by `buildApp` from `NODE_ENV`, so unit tests that never build the app are checked too and nothing outside `src/config` reads the environment; `validate()`'s detail-code check uses the same setting.
Its limit: a process that built two apps with different `NODE_ENV` would follow the last one.
In production the value is sent as it is: a contract mismatch never turns a working call into a 500.
Why check while sending rather than in a separate contract test: the existing tests (1,225) call every endpoint in many states, so every one of them becomes a contract check without writing new tests.

#### 4.2.3 Lists and cursors

**The list endpoints and their orders** (each `.API.md` declares the same):

| Endpoint                | Order (sort keys, then ID)                         | Filters (default)                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /operator/plans`   | name (T20)                                         | none                                                                                                                                                                                                 |
| `GET /operator/tenants` | name                                               | none                                                                                                                                                                                                 |
| `GET /users`            | user name                                          | `unitId` (an ID, `none`, `all`; `all`), `managers` (`true`, `false`, `all`; `all`), `roleId` (an ID, `all`; `all`), `status` (`invited`, `active`, `inactive`, `all`; `active`), `q` (name or email) |
| `GET /roles`            | name                                               | none                                                                                                                                                                                                 |
| `GET /permissions`      | catalog order (the key is the sort key and unique) | none                                                                                                                                                                                                 |
| `GET /positions`        | name                                               | `unitId` (an ID, `all`; `all`), `retired` (`true`, `false`, `all`; `false`)                                                                                                                          |
| `GET /priorities`       | display order                                      | `retired` (`false`)                                                                                                                                                                                  |
| `GET /services`         | name                                               | `retired` (`false`)                                                                                                                                                                                  |
| `GET /workflows`        | name                                               | `retired` (`false`)                                                                                                                                                                                  |
| `GET /requests`         | submitted, newest first                            | `view` (`waiting_on_me`, `handling`, `requested`, `review_queue`; absent: every request the caller sees), `state` (a state, `all`; `all`), `serviceId` (an ID, `all`; `all`)                         |
| `GET /notifications`    | created, newest first                              | `unread` (`all`)                                                                                                                                                                                     |

"Name" is `lower(name) COLLATE "und-x-icu"` (T20). "Newest first" is descending, with the ID descending too: `GET /requests` today sorts the ID ascending, which a row comparison cannot continue from, so it changes.

**The cursor.** `base64url(JSON.stringify({v: 1, after: [<sort values>, <id>], fp: <fingerprint>}))`.

- The sort values are taken in their exact database form, read as text: a `timestamptz` keeps its microseconds (`2026-10-20 09:00:00.123456+00`), never passing through a JavaScript `Date`, which keeps milliseconds only and would skip a row whose time differs in the fourth decimal (section 5).
- The next page adds `(k1, ..., id) < ($1, ..., $n)` for a descending order, `>` for an ascending one, with the same expressions as the `ORDER BY` (including `COLLATE`), then `LIMIT limit + 1`; the extra row only says whether a next page exists and is not returned.
- `nextCursor` is built from the last returned item, or `null` when the extra row did not come.
- Why values and not the last ID (as `before` does today): a row deleted between pages would leave an ID with no position, and a value comparison needs no lookup.

**The fingerprint.** The first 16 hex characters of SHA-256 over the canonical JSON of `{list: "<endpoint name>", filters: <validated filters with defaults>}` (keys sorted).
`cursor` and `limit` are not filters; `q` and `view` are.
A cursor whose `v`, shape, value types, or fingerprint does not match is `invalid_cursor` (R8.7).
The cursor is not signed: editing it can only move the starting point within rows the caller may see, because visibility is decided in SQL on every call (T29, T45).

**The total.** A second query with the same `WHERE` (filters, tenant, visibility) and no cursor condition or limit: `select count(*)`.
Both queries run in one `READ ONLY` transaction at `REPEATABLE READ`, so they read the same snapshot (R8.8).
Today `GET /users` and `GET /requests` run the two queries in parallel on separate pool connections, which can disagree by the rows committed between them.

**`listPage`** (`src/http/list.ts`) is the one implementation: it takes the list name, the validated query, the sort-key expressions, a function that builds the `WHERE` from the filters, and a function that selects the page rows; it decodes and checks the cursor, opens the snapshot, runs both queries, and returns `{items, nextCursor, total}` for `sendPage`.
Every list endpoint uses it, so no list pages differently.
`GET /permissions` lists the code-held catalog, not a table, so `listInMemory` pages it with the same cursor, fingerprint, and `total` rules; a cursor naming a key a deploy removed is `invalid_cursor`.
The uniform `limit` lowers `GET /users` from 50 by default and 200 at most to 25 and 100.

#### 4.2.4 Filters

`src/http/filters.ts` gives the pieces every list query schema is built from:

```ts
booleanFilter(defaultValue: "true" | "false" | "all")          // "true" | "false" | "all"
valueFilter(values, defaultValue)                              // one of values, or "all"
idFilter({ none: boolean })                                    // a lower-cased UUID (T37), "all", or "none" when allowed
pageQuery                                                      // cursor, limit (1-100, default 25)
```

A list's query schema is `z.object({...filters, ...pageQuery})`, lenient as T25 keeps queries.
The defaults live in these schemas, so the fingerprint, the `.API.md`, and the query always agree.
`q` on `GET /users` is an `optionalText`, so a blank search means no search (it was 400 `too_small`).

What changes for clients: `includeRetired=true` becomes `retired=all`, `includeRetired=false` becomes the default `retired=false`, `retired=true` is new; `unread=false` means read only (Phase 7 made it mean no filter); `offset` and `before` are gone.

#### 4.2.5 Errors

```json
{
  "error": {
    "code": "TAKEN",
    "requestId": "4f1c...",
    "details": [{ "path": "name", "code": "taken" }]
  }
}
```

| Status        | Meaning                                                 | Codes                                                                                                               |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 400           | The input is wrong                                      | `VALIDATION_FAILED`, `VERIFICATION_INVALID`                                                                         |
| 401           | Not logged in, or the session expired                   | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`                                                                            |
| 403           | Logged in, but not allowed                              | `FORBIDDEN`, `PERMISSION_NOT_HELD`, `SELF_CHANGE_FORBIDDEN`, `SUBSCRIPTION_READ_ONLY`, `SUBSCRIPTION_NOT_ACTIVE`    |
| 404           | Does not exist, or the caller may not see it (T45)      | `NOT_FOUND`                                                                                                         |
| 409           | The input is valid but conflicts with the current state | `TAKEN`, `VERSION_CHANGED`, and the state codes (`INVALID_REQUEST_STATE`, `ROLE_IN_USE`, `USER_LIMIT_REACHED`, ...) |
| 411, 413, 415 | Transport                                               | `LENGTH_REQUIRED`, `PAYLOAD_TOO_LARGE`, `FILE_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `FILE_TYPE_NOT_ALLOWED`         |
| 500           | A server fault                                          | `INTERNAL`                                                                                                          |
| 503           | A dependency is down                                    | `SERVICE_UNAVAILABLE` (`/health` only)                                                                              |

**Merged codes:** `EMAIL_TAKEN`, `SLUG_TAKEN`, `PLAN_NAME_TAKEN`, `UNIT_NAME_TAKEN`, `ROLE_NAME_TAKEN`, `POSITION_NAME_TAKEN`, `WORKFLOW_NAME_TAKEN`, `SERVICE_NAME_TAKEN`, `PRIORITY_NAME_TAKEN` become `TAKEN`, with a detail at the field (`email`, `slug`, `name`, `admin.email`); `WORKFLOW_VERSION_CHANGED` and `SERVICE_FORM_CHANGED` become `VERSION_CHANGED`, with a `version_changed` detail at `baseVersion` or `baseRevision`.
The unique-constraint map (`CODE_BY_UNIQUE_CONSTRAINT`) maps each constraint to `TAKEN` and the field path, so the translation stays central.
A conflict found by a service before the write (a rename to a taken name) raises the same code and path.

**Detail codes.** One registry, `DETAIL_CODES` in `src/http/errors.ts`, lists every detail code: the zod issue codes `validate()` can report (`invalid_type`, `too_small`, `too_big`, `invalid_format`, `invalid_value`, `not_multiple_of`, `invalid_union`, `invalid_key`, `invalid_element`), `unknown_field`, `no_fields`, `invalid_json`, `invalid_cursor`, `taken`, `permission_not_held`, `version_changed` (the detail of `VERSION_CHANGED`), and the custom codes the modules use; 86 entries in all, many of them set by helper functions (answer checking, files, requests) rather than written as literals.
`ErrorDetail.code` is typed as that union, so a literal detail code outside the registry fails to compile; a refine's `params.code` is untyped, so `validate()` checks it against the registry outside production and throws on an unknown one.
`detailsOf` keeps zod's own code for built-in issues; zod's `custom` code never reaches a client (a refine without a named code is a server bug, caught by the same check).

**`PERMISSION_NOT_HELD`:** the `scope` key is removed. Under the subset rule, the detail's `path` is the entry of the request body that asked for the permission (`permissions.3`); the route's own permission, which no input asked for, gives `details: []`.
Why: the client knows what it sent at that path, and a field-free refusal needs no detail to be worded ("you cannot do this").

**No unmapped errors:** the error handler already maps Express and body-parser client errors (fixed before this phase); the remaining change is `invalid_json` as the detail of a body that is not JSON, and `/health`'s 503.

#### 4.2.6 Request methods

| Method                      | Use                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `POST /things`              | create                                                                                          |
| `PATCH /things/:id`         | change some fields: only the fields sent change; at least one (`no_fields`); `null` clears      |
| `PUT /things/:id/part`      | replace one whole part (a form, the priority order, a role assignment, the escalation settings) |
| `POST /things/:id/<action>` | a business action (`accept`, `retire`, `close-no-response`)                                     |
| `DELETE /things/:id`        | remove                                                                                          |

The routes already follow it.
A calendar period has no field that can be empty: every field its kind uses is required and the definition is checked whole after a `PATCH`, so a `null` there is refused (`invalid_type`), as the rule allows only for a field that can be empty.

#### 4.2.7 Value formats

| Kind         | Format                                                                         |
| ------------ | ------------------------------------------------------------------------------ |
| ID           | UUID, lower-case in responses, any case accepted (T37)                         |
| Moment       | ISO 8601 UTC with milliseconds, `2026-10-26T06:30:00.000Z`                     |
| Calendar day | `YYYY-MM-DD`, a day in Riyadh                                                  |
| Time of day  | `HH:MM`, 24-hour, Riyadh                                                       |
| Money        | integer halalas, the key ending in `Halalas` (T18)                             |
| Duration     | a number with its unit in the key (`breachDays`)                               |
| Keys         | camelCase                                                                      |
| Text input   | trimmed; a blank optional text is `null`; a blank required text is `too_small` |

Each module step checks its request schemas and responses against this table and fixes deviations; one shared `optionalText(max)` schema piece applies the blank-to-`null` rule: a service's description, a form field's help text, a stage completion's comment, a stage refresh's reason, and the users search `q`.

#### 4.2.8 `docs/api/`

| File             | Owns                                                                                                   | Enforced by                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `README.md`      | The index: what each file owns, how to read a phase `.API.md` row                                      | -                                            |
| `conventions.md` | Success shape, lists and cursors, filters, request methods, value formats, uploads and downloads       | `respond.ts`, `list.ts`, `filters.ts`        |
| `errors.md`      | Error shape, status meanings, every top-level code and every detail code, what a client does with each | `errors.ts`, `error-handler.ts`, the C4 test |
| `auth.md`        | The cookies, login, refresh, logout, the access-token payload, password and verification links         | `modules/auth/`                              |
| `access.md`      | Permission and scope refusals, the subscription states and what each blocks (T16), request visibility  | `tenant-access/`, the subscription guard     |

Each file states rules once, with no exceptions to explain; endpoint details stay in the phase `.API.md` files (Q1).
The README's "HTTP behavior", "Authentication", "Operator API", and "Tenant API" sections become a short pointer to `docs/api/`, keeping setup, configuration, and scripts, and two operational notes: log redaction with graceful shutdown, and `pnpm operator:create`.
`CLAUDE.md`'s document table gains `docs/api/`.

**The `.API.md` table format** (for the C5 test): one route per row; the first two cells are the method and the full mounted path in backticks; path parameters may be named freely (`:id` matches `:requestId`); no query string in the path cell.
Each module step rewrites its phases' rows to this format and to the new shapes: the Responses cell describes `data` (for example "200 the request"; "200 a page of notifications"), never the wrapper (Q20).

### 4.3 Key flows

#### A list call

`GET /users?status=active&cursor=eyJ2Ijox...&limit=25` by Sara:

1. The controller passes `req.query` to the service; the service validates it with the list's query schema (defaults applied: `unitId=all`, `managers=all`, `roleId=all`).
2. `listPage` decodes the cursor; it checks `v`, the shape, and the fingerprint of `{list: "users", filters: {managers: "all", q: null, roleId: "all", status: "active", unitId: "all"}}`.
3. It opens a read-only `REPEATABLE READ` transaction and runs the page query (with `(lower(user_name) COLLATE "und-x-icu", id) > ($name, $id)` and `limit 26`) and the count query.
4. It returns 25 items, `nextCursor` from the 25th, and `total: 128`; the controller calls `sendPage`.

#### A write

`POST /requests/<#42>/accept` by Huda: the service runs the action as today (T46), then reads the request with the same function as `GET /requests/:id`, and the controller calls `sendData(res, 200, requestSchema, request)`.

#### An error

The service throws `new AppError("TAKEN", [{path: "name", code: "taken"}])`, or the unique constraint is translated centrally; the error handler writes `{error: {code, requestId, details}}`, with `details: []` when the error has none.

### 4.4 Module structure

```
src/
  http/
    respond.ts                 new: sendData, sendPage, sendNoContent, the response check outside production
    list.ts                    new: listPage, the cursor, the fingerprint, the snapshot
    filters.ts                 new: booleanFilter, valueFilter, idFilter, pageQuery, optionalText
    errors.ts                  (changed) TAKEN, VERSION_CHANGED, SERVICE_UNAVAILABLE; DETAIL_CODES; the constraint map gains paths
    validate.ts                (changed) the detail-code check; invalid_json
  middleware/error-handler.ts  (changed) details always an array
  modules/<feature>/
    <feature>.responses.ts     new in each module: the response schemas (Q21)
    <feature>.types.ts         (changed) response types from the schemas
    <feature>.controller.ts    (changed) only the respond helpers
    <feature>.schemas.ts       (changed) list query schemas from the filter pieces
    <feature>.repository.ts    (changed) lists through listPage
test/
  contract/                    new: C1 (no direct res.json), response-schema strictness, C4 (codes <-> errors.md), C5 (routes <-> .API.md)
docs/api/                      new: README.md, conventions.md, errors.md, auth.md, access.md
docs/specs/*/*.API.md          (changed) the table format and the new shapes
README.md, CLAUDE.md           (changed) pointers to docs/api/
```

## 5. Edge Cases and Failure Behavior

| Scenario                                                                                              | Expected behavior                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two notifications at `09:00:00.123400` and `09:00:00.123456`; the first page ends with the later one. | The cursor carries `.123456` exactly; the next page starts with `.123400`. Through a JavaScript `Date` both would read `.123` and `.123400` would be skipped. |
| Three rows share a sort value and the page ends between them.                                         | The ID tie-breaker continues after the last row; none repeats or is skipped.                                                                                  |
| The last item of a page is deleted before the next call.                                              | The cursor compares values, so the next page starts after where it was.                                                                                       |
| Sara renames a member while Faisal pages the users list.                                              | The member may appear on two pages or none (true of any paging on live data); the cursor stays valid.                                                         |
| Huda reorders priorities while Sara pages them.                                                       | As a rename: the cursor stays valid, items may move. (Al-Noor's priorities fit one page.)                                                                     |
| A users cursor sent to `GET /requests`.                                                               | `invalid_cursor`: the fingerprint includes the list name.                                                                                                     |
| A cursor with the same filters in another order, or with a default spelled out (`retired=false`).     | Accepted: the fingerprint is computed from the validated filters with defaults, keys sorted.                                                                  |
| A cursor edited to start elsewhere.                                                                   | A valid page from that position, of rows the caller may see; or `invalid_cursor` if broken.                                                                   |
| A `GET /permissions` cursor whose key a deploy removed from the catalog.                              | `invalid_cursor`; the client restarts the list.                                                                                                               |
| A member is invited between the page query and the count of one call.                                 | Both read one snapshot; they agree. The next call shows the new total.                                                                                        |
| `limit=0`, `limit=101`, `limit=abc`.                                                                  | 400 `too_small`, `too_big`, `invalid_type` at `limit`.                                                                                                        |
| An empty list.                                                                                        | `{data: [], page: {nextCursor: null, total: 0}}`.                                                                                                             |
| `unread=maybe`.                                                                                       | 400 `invalid_value` at `unread`.                                                                                                                              |
| `utm_source=x` on a list.                                                                             | Ignored (T25), and not part of the fingerprint.                                                                                                               |
| A controller returns a value its schema does not allow, in development or a test.                     | 500 `INTERNAL`; the log names the zod issues; the test fails.                                                                                                 |
| The same in production.                                                                               | Sent as it is (the check is skipped).                                                                                                                         |
| A refine names a detail code missing from `DETAIL_CODES`.                                             | Outside production, `validate()` throws: a test fails naming the code.                                                                                        |
| Two invitations race for the same email.                                                              | The loser gets 409 `TAKEN` at `email` from the central constraint map, as today with `EMAIL_TAKEN`.                                                           |
| A body that is not JSON.                                                                              | 400 `VALIDATION_FAILED`, `[{path: "", code: "invalid_json"}]`.                                                                                                |
| The database is down.                                                                                 | `/health` 503 `SERVICE_UNAVAILABLE` with `details: []`.                                                                                                       |
| A route exists in Express but in no `.API.md`, or the other way round.                                | The C5 test fails naming it.                                                                                                                                  |

## 6. Security and Authorization

- **No new trust:** the cursor is not trusted for anything but a starting position; tenant, visibility, and filters are applied in SQL on every call (T2, T29, T45).
- **No leaks:** strict response schemas make an extra field (a hash, an internal flag) fail every test that returns it.
- **Errors reveal nothing new:** `details` carries only input paths and codes; `PERMISSION_NOT_HELD` loses its `scope`, which only described the actor's own missing grant.
- **No authorization change:** permissions, the subscription guard, and visibility are untouched; only the shapes of their answers change.
- **Audit:** unchanged; no audited action changes.

## 7. Implementation Steps

Two sub-agents, each in its own git worktree; the steps are split along their dependencies and built in the order below, with no review gate between steps; the whole spec is reviewed once at the end.

| Step                        | Objective                                             | Delivers                                                                                                                                                                                                                                                           | Acceptance criteria                                                                 | Verification                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1 Contract foundations    | The helpers and the error changes exist.              | `respond.ts`, `list.ts`, `filters.ts`; the error changes of 4.2.5 (`details` always, `TAKEN` and `VERSION_CHANGED` with paths, `DETAIL_CODES`, `invalid_json`, `SERVICE_UNAVAILABLE`, `PERMISSION_NOT_HELD` paths); `/health` on the helpers.                      | R8.7, R8.8, R8.10-R8.12                                                             | Unit and integration tests of `listPage` on a test table: microsecond ties, ID ties, deletion between pages, fingerprint mismatch and edits, empty lists, snapshot (a row inserted between the two queries through a test hook). Mutation checks: reading sort values through `Date`, dropping the tie-breaker, the fingerprint check, or the transaction each fail a test. Error-handler tests for every row of 4.2.5. |
| 8.2 Docs and contract tests | The rules are written, and drift fails a test.        | `docs/api/` (4.2.8); every existing `.API.md` table rewritten to the table format (shapes still old); the C1 test, the response-schema strictness test, the C4 test, and the C5 test; README and `CLAUDE.md` pointers.                                             | R8.15, R8.17, R8.18 (docs)                                                          | The C4 and C5 tests pass on the merged result and fail when a code or a route is removed from the docs (mutation). The C1 test fails on a controller with `res.json` added. Until 8.3 and 8.4 finish, C1 and the strictness test skip the modules not yet migrated through one shared list, which 8.4 empties.                                                                                                          |
| 8.3 Migrate group 1         | Platform and people endpoints follow the contract.    | auth, health, platform (plans, tenants returning the full detail), subscriptions, org, users, roles and permissions, files, notifications: response schemas, the helpers, cursor lists, filters, value and text rules, their `.API.md` rows in the new shapes.     | R8.1-R8.6, R8.9, R8.13, R8.14, R8.16 for these modules                              | Each module's tests updated to the new shapes and passing with the response check on; new tests for each list's order, filters and defaults, and `invalid_cursor`; `unread=false`; login equals me; tenant create equals get.                                                                                                                                                                                           |
| 8.4 Migrate group 2         | Legal configuration and requests follow the contract. | calendar, positions, workflows, services, priorities, escalation, requests: as 8.3, including `GET /requests`' ID order, `askInformation` as 200, `retired` filters, the reorder as 204, and the calendar and answer shapes of R8.4. Empties the skip list of 8.2. | R8.1-R8.6, R8.9, R8.13, R8.16 for these modules; R8.15 and R8.17 for the whole repo | As 8.3; the skip list is empty and the C1, strictness, C4, and C5 tests pass on every module. End-to-end check of the whole phase against a running server: a list paged to its end with `total`, a filter change with an old cursor, a write equal to its read, `TAKEN`, invalid JSON, `/health`.                                                                                                                      |

Order: agent A builds 8.1, then 8.3 once 8.1 and 8.2 are merged.
C1 and the strictness test skipped the modules not yet migrated through one shared list; once every module was migrated, the list was removed, so the tests cover every module with no way to exempt one.
Agent B builds 8.2 in parallel with 8.1, then 8.4 once both are merged.

## 8. Test Plan

Integration tests against real PostgreSQL and the S3-compatible server, with Al-Noor and Al-Rashid as today.
The response check is on in every test (R8.16), so the whole suite checks every response it receives.

| Requirement  | Test                                                                                                                                           | Step     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R8.1-R8.4    | Every existing endpoint test asserts the new body; write-equals-read tests for each row of 4.2.1; S4 shapes for escalation, calendar, answers. | 8.3, 8.4 |
| R8.5-R8.8    | `listPage` unit and integration tests (8.1); per list: order, page size, `nextCursor` at the end, `total` with filters.                        | all      |
| R8.9         | Per list: each filter's values, `all`, defaults, `none`, `invalid_value`.                                                                      | 8.3, 8.4 |
| R8.10-R8.12  | Error-handler tests; `TAKEN` and `VERSION_CHANGED` paths in each module; `PERMISSION_NOT_HELD` with and without a path; `/health`.             | 8.1-8.4  |
| R8.13, R8.14 | `PATCH` with `null`; blank texts; upload and download.                                                                                         | 8.3, 8.4 |
| R8.15-R8.17  | The contract tests and their mutation checks.                                                                                                  | 8.2      |

## 9. Open Questions

Q1-Q16 are the pre-spec discussion (2026-10-26); Q17-Q21 were raised by the draft and Q22-Q24 by the review. All are resolved.

| #   | Question                                                                                                                                                                                                                            | Options                                                                                                                                                                                                                        | Resolution                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | What do the API docs contain, and where do endpoints live?                                                                                                                                                                          | (a) Per-endpoint reference docs. (b) OpenAPI generated from code. (c) `docs/api/` for HTTP behavior only, and each phase's endpoints in its own `.API.md`.                                                                     | **Resolved 2026-10-26: (c)**, `docs/api/` describes the HTTP behavior once, with no exceptions; endpoints live in each phase folder's `.API.md` (P8.1). The specs were reorganized into folders in commit `cf2a177`.                              |
| Q2  | What is the success body?                                                                                                                                                                                                           | (a) `{data}` everywhere. (b) Bare objects and arrays. (c) Named keys as today.                                                                                                                                                 | **Resolved 2026-10-26: (a)**, every success body is `{data}` (P8.2).                                                                                                                                                                              |
| Q3  | What does a write return?                                                                                                                                                                                                           | (a) The changed resource in its read's shape, inside `data`. (b) Only what changed. (c) Nothing.                                                                                                                               | **Resolved 2026-10-26: (a)**, the full changed resource, as its read returns it, inside `data` (P8.2).                                                                                                                                            |
| Q4  | What do 201, 204, empty values, and `/health` mean?                                                                                                                                                                                 | 201 only for a new resource with its own URL; 204 only when nothing is left to show; fields always present with `null`; `/health` on the same rules.                                                                           | **Resolved 2026-10-26: as proposed**, 201 for new resources with their own URL, 204 for deletes, logout, password calls, resends, and marking read, keys always present with `null` when empty, and `/health` following the same rules (P8.2).    |
| Q5  | Which lists are paged, and how?                                                                                                                                                                                                     | (a) Every list, by cursor. (b) Only growing lists. (c) Offsets.                                                                                                                                                                | **Resolved 2026-10-26: (a)**, every list endpoint is paged by cursor, `{data, page: {nextCursor, total}}`, 25 by default and 100 at most (P8.3).                                                                                                  |
| Q6  | Is a cursor tied to its filters?                                                                                                                                                                                                    | (a) A fingerprint of the filters, 400 `invalid_cursor` on a mismatch, no signature. (b) No check. (c) The cursor carries the filters and overrides the query.                                                                  | **Resolved 2026-10-26: (a)**, the cursor carries a fingerprint of its list and filters; a mismatch or a broken cursor is `invalid_cursor`; it is not signed (P8.3).                                                                               |
| Q7  | Who sorts lists?                                                                                                                                                                                                                    | (a) The server, by each endpoint's declared keys only. (b) The client may re-sort loaded lists. (c) Client-chosen `sort`.                                                                                                      | **Resolved 2026-10-26: (a)**, server-side sorting only, by keys each `.API.md` declares, with the ID as tie-breaker; client-chosen sorting is deferred (P8.3).                                                                                    |
| Q8  | Is there a total, and how is it computed?                                                                                                                                                                                           | (a) On every list page, matching the filters, from a count in the page's snapshot. (b) No total.                                                                                                                               | **Resolved 2026-10-26: (a)**, every list returns `total` matching the requested filters, counted in the same snapshot as the page (P8.3).                                                                                                         |
| Q9  | What is the error shape?                                                                                                                                                                                                            | (a) `{code, requestId, details}`, `details` always an array of `{path, code}`, no message, no params. (b) With `params` for limits and values.                                                                                 | **Resolved 2026-10-26: (a)**, no `params` anywhere and no message; the frontend renders messages from the codes and takes limits from the docs (P8.4).                                                                                            |
| Q10 | What does each status mean, and what may `path` hold?                                                                                                                                                                               | The status table of 4.2.5; `path` only a place in the input, `""` otherwise; a path on every field-caused error.                                                                                                               | **Resolved 2026-10-26: as proposed**, one meaning per status, `path` only an input location, and every field-caused error pointing at its field (P8.4).                                                                                           |
| Q11 | Are code families that differ only by resource merged?                                                                                                                                                                              | (a) `TAKEN` and `VERSION_CHANGED`, the field in the detail. (b) Keep per-resource codes.                                                                                                                                       | **Resolved 2026-10-26: (a)**, nine `*_TAKEN` codes become `TAKEN` and two version codes become `VERSION_CHANGED`; codes that need their own wording stay (P8.4).                                                                                  |
| Q12 | How do list filters work?                                                                                                                                                                                                           | (a) One rule: `field=value`, `all`, documented defaults, `none`; `q` and `view` apart. (b) Per-list conventions as today.                                                                                                      | **Resolved 2026-10-26: (a)**, one rule for every filter; `includeRetired` becomes `retired`, and `unread=false` means read only (P8.5).                                                                                                           |
| Q13 | Which request methods, `PATCH` semantics, value formats, and text rules apply?                                                                                                                                                      | The tables of 4.2.6 and 4.2.7.                                                                                                                                                                                                 | **Resolved 2026-10-26: as proposed**, the method table, absent unchanged and `null` clears in `PATCH`, the value formats, and trimmed text with blank optional as `null` (P8.6).                                                                  |
| Q14 | Do uploads stay raw bytes?                                                                                                                                                                                                          | (a) Raw bytes with the name in the query (T39). (b) `multipart/form-data`.                                                                                                                                                     | **Resolved 2026-10-26: (a)**, raw-byte uploads stay, answering `{data: file}` (P8.6).                                                                                                                                                             |
| Q15 | How are the rules enforced?                                                                                                                                                                                                         | C1 responses only through helpers; C2 response schemas checked outside production; C3 one list helper; C4 codes against `errors.md`; C5 routes against `.API.md`.                                                              | **Resolved 2026-10-26: all five**, with the response check on in test and development only (P8.7).                                                                                                                                                |
| Q16 | How is `docs/api/` split?                                                                                                                                                                                                           | `README.md`, `conventions.md`, `errors.md`, `auth.md`, `access.md`.                                                                                                                                                            | **Resolved 2026-10-26: those five files** (P8.1).                                                                                                                                                                                                 |
| Q17 | What do `POST /auth/login` and `POST /auth/refresh` return? Today `{user}`, while `GET /auth/me` returns `{user, subscription}`.                                                                                                    | (a) The same as `GET /auth/me`, so the app keeps one session object and learns the subscription state at login. (b) `{user}` only.                                                                                             | **Resolved 2026-10-26: (a)**, login and refresh return the session as `GET /auth/me` does, `{user, subscription}`, inside `data` (P8.2).                                                                                                          |
| Q18 | What do `POST /operator/tenants` and `PUT /operator/tenants/:id/subscription` return? Today `{tenant, subscription, admin}` and `{subscription, usage}`, while `GET /operator/tenants/:id` returns `{tenant, subscription, usage}`. | (a) All three return the tenant detail, which gains `owner: {id, email, userName, emailVerified}`. (b) Keep `admin` only on create. (c) All three return the tenant detail `{tenant, subscription, usage}` in full, unchanged. | **Resolved 2026-10-26: (c)**, the tenant detail in full: create, read, list items, and the subscription change all return `{tenant, subscription, usage}` with every field; create no longer returns `admin`, and no `owner` key is added (P8.2). |
| Q19 | What does `PUT /priorities/order` return? It changes the order of the whole list, whose read is now paged.                                                                                                                          | (a) 204: the client knows the order it sent. (b) The first page of `GET /priorities`.                                                                                                                                          | **Resolved 2026-10-26: (a)**, `PUT /priorities/order` answers 204 (P8.2).                                                                                                                                                                         |
| Q20 | Do the phase `.API.md` files show the new shapes?                                                                                                                                                                                   | (a) Yes: each module step rewrites its rows, the Responses cell describing `data`, never the wrapper. (b) Leave them as the historical design and describe changes only in Phase 8's `.API.md`.                                | **Resolved 2026-10-26: (a)**, each module step rewrites its phases' `.API.md` rows to the new shapes, the Responses cell describing `data` (P8.1).                                                                                                |
| Q21 | Where do response schemas live?                                                                                                                                                                                                     | (a) A new `<feature>.responses.ts` per module, amending T14's file rules. (b) In `<feature>.schemas.ts` with the request schemas.                                                                                              | **Resolved 2026-10-26: (a)**, response schemas live in a new `<feature>.responses.ts` per module, amending T14 (P8.7).                                                                                                                            |
| Q22 | (Raised in review) Form fields differ in keys by type (`min`, `max`, `integer` for numbers, `options` for choices, `maxFiles` for files). Keep the per-type shapes or flatten them? | (a) Every field answers every setting, `null` where the type has none, and the save accepts that shape back. (b) Keep a union by `type`. | **Resolved 2026-10-27: (a)**, one field shape with every setting, accepted back by the form save (P8.2). |
| Q23 | (Raised in review) A weekday is `"default"`, `"off"`, or `{start, end}`, a value that is sometimes text and sometimes an object. Keep it or flatten it? | (a) `{mode, start, end}` in requests and responses. (b) Keep the union. | **Resolved 2026-10-27: (a)**, every weekday is `{mode, start, end}` with `start` and `end` `null` unless `custom` (P8.2). |
| Q24 | (Raised in review) `PATCH /calendar/periods/:id` does not clear a field with `null`. Is that an exception to the `PATCH` rule? | (a) No: every field a period's kind uses is required, so nothing can be cleared and `null` is refused; documented in the Phase 4 `.API.md`. (b) Accept `null` to remove a field. | **Resolved 2026-10-27: (a)**, kept and documented as an application of the rule (P8.6). |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #    | Decision                                                                                                                                                                                                                                | Rationale                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P8.1 | `docs/api/` owns the HTTP behavior, in five files, stating each rule once; each phase's `.API.md` owns its endpoints.                                                                                                                   | Owner decisions (Q1, Q16): the frontend reads the rules once and the endpoints where they were designed; no document repeats another.                    |
| P8.2 | Every success body is `{data}`; a write returns the changed resource as its read does; 201 for a new resource with its own URL, 204 when nothing is left to show, 200 otherwise; keys always present, `null` when empty.                | Owner decisions (Q2-Q4): one unwrapping for every call, no refetch after a write, no optional keys in the client's types.                                |
| P8.3 | Every list is paged by an opaque cursor carrying exact sort values and a fingerprint of the list and filters; one server-side order per list with the ID as tie-breaker; `total` from a count in the page's `REPEATABLE READ` snapshot. | Owner decisions (Q5-Q8): no repeats or skips on live data, a filter change cannot silently return a wrong page, and the page and its total always agree. |
| P8.4 | Errors are `{code, requestId, details}` with `details` always an array of `{path, code}`; no message or params; `path` only an input location; `TAKEN` and `VERSION_CHANGED`; every client error mapped; one registry of detail codes.  | Owner decisions (Q9-Q11): the client words every message from codes (T11), marks fields generically, and never meets an undocumented code.               |
| P8.5 | One filter rule: `field=value`, `all`, documented defaults, `none`; `q` and `view` documented per list.                                                                                                                                 | Owner decision (Q12): one filter control works on every list; reverses Phase 7's `unread=false` close-out rule.                                          |
| P8.6 | The request methods, `PATCH` semantics, value formats, text rules, and the raw-byte upload and download transport of 4.2.6, 4.2.7, and R8.14.                                                                                           | Owner decisions (Q13, Q14): written down as they mostly already are, so they stay that way.                                                              |
| P8.7 | Responses are written only through `respond.ts`, checked against strict response schemas outside production; lists only through `listPage`; tests tie error codes to `errors.md` and routes to `.API.md` in both directions.            | Owner decision (Q15): every rule is enforced by construction or by a failing test, so "no exceptions" survives new endpoints.                            |

Promoted on 2026-10-27: P8.2, P8.3, P8.5, and P8.7 to `TECHNICAL_DECISIONS.md` as T52-T56 (P8.7 as T55 and T56), P8.4 as a rewrite of T11, T14 amended for `<feature>.responses.ts` (Q21), T27, T35, and T38 updated to the new error codes, the opt-in total added to "Deferred hardening", and client-chosen sorting to "Deferred technical decisions"; P8.1 to `CLAUDE.md`'s document table. Decisions not promoted are detail that stays authoritative here.

The plan, as drafted: P8.2-P8.5 and P8.7 to `TECHNICAL_DECISIONS.md` as new entries, with T11 rewritten to the new error shape and T14 amended for `<feature>.responses.ts` (Q21); P8.1 to `CLAUDE.md`'s document table; to "Deferred hardening": an opt-in `total` when counting a list becomes slow; to "Deferred technical decisions": client-chosen sorting when a screen needs it.
No MVP product decision changes.

## 11. Change Log

| Date       | Change                                                                                                                                                                                                                                                            | Reason                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 2026-10-26 | Initial draft from the owner's answers to the pre-spec discussion (Q1-Q16), with Q17-Q21 open.                                                                                                                                                                    | MVP phases implemented; the frontend needs one contract. |
| 2026-10-26 | Resolved Q17-Q21: login and refresh as `/auth/me`; tenant writes return the full `{tenant, subscription, usage}` with no `owner` key; the priority order as 204; phase `.API.md` files rewritten to the new shapes; response schemas in `<feature>.responses.ts`. | Owner answering round.                                   |
| 2026-10-26 | Approved by the owner; status set to `In Implementation`. | Implementation starts. |
| 2026-10-27 | Implemented and verified: 8.1 then 8.3 by one agent, 8.2 then 8.4 by the other; migration `0023`; the full suite (58 files, 1,315 tests) with every response checked against its schema, mutation checks re-run in review (snapshot isolation, fingerprint), and end-to-end runs against a running server (45 and 11 checks, including working hours). Approved by the owner and folded in: `version_changed` (4.2.5), the 86-entry detail registry (4.2.5), the process-wide check setting (4.2.2), `GET /permissions` paged in memory and the uniform `limit` for users (4.2.3), the stricter schema test (4.2.2), a blank `q` as no search and the optional texts as `null` (4.2.4, 4.2.7), `requests_submitted_idx` (4.1), the flattened assignee targets and periods (4.2.2), and the README notes kept (4.2.8). Raised in review and resolved: one form-field shape (Q22), weekdays as `{mode, start, end}` (Q23), the period `PATCH` (Q24). Also found in review and fixed: the plan and tenant paging tests assumed no other test file adds rows mid-walk, and the write-equals-read request test compared live SLA times, which grow during working hours. | Phase 8 implemented. |
| 2026-10-27 | Status set to `Implemented`; decisions promoted (T52-T56, T11 rewritten). | Phase 8 complete. |
