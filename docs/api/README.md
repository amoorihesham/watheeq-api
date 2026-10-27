# Watheeq API: HTTP Contract

These files describe how the Watheeq API behaves over HTTP, once, for everyone who builds against it.
A frontend developer reads them once and then needs only the row of each endpoint they call.

## The files

| File | Owns |
| ---- | ---- |
| [conventions.md](conventions.md) | The success shape, lists and cursors, filters, request methods, value formats, uploads and downloads |
| [errors.md](errors.md) | The error shape, what each status means, every error code and every detail code, and what a client does with each |
| [auth.md](auth.md) | The cookies, login, refresh, logout, the access-token payload, password and verification links |
| [access.md](access.md) | Permission and scope refusals, the subscription states and what each blocks, who can see a request |

Each file states a rule once and has no exceptions to explain.
A rule is not repeated in another file or in an endpoint row; the row links to the file that owns it.

## Where the endpoints are

`docs/api/openapi.json` is the machine-readable reference.
It is generated from the endpoint declarations in the code (`src/modules/*/<module>.endpoints.ts`) and checked against them by a test, so it cannot drift.
For every endpoint it holds the method and path, the permission, the path, query, and body shapes, the success status and `data` shape, and the errors the endpoint can answer.

Outside production, the API serves a browsable reference at `/docs` and the document itself at `/openapi.json`.
Log in with `POST /auth/login` in the same browser, and try-it requests carry the login cookies, because `/docs` is on the API's own origin.
Production does not serve `/docs`.

A frontend can generate its request and response types from the document:

```
npx openapi-typescript docs/api/openapi.json -o api.d.ts
```

Every endpoint is also an index row in the `.API.md` file of the phase that designed it, in `docs/specs/phase-<N>-<name>/`.
`docs/specs/phase-8-api-contract/phase-8-api-contract.API.md` lists what the contract changed.
A contract test fails when a mounted route has no row, or a row has no route (Phase 8, R8.17).

## How to read an endpoint row

| Cell | Meaning | Example |
| ---- | ------- | ------- |
| Method | The HTTP method | `POST` |
| Path | The full mounted path, with `:name` for a path parameter and no query string | `/requests/:requestId/accept` |
| Who | The permission, party, or realm the caller needs (`access.md`) | `request.review`, in review |
| Purpose | One line on what the endpoint does; "(changed)" marks an endpoint another phase owns | `Accept with a handler and a workflow` |
| Spec refs | The requirement and decision IDs of that phase's spec | `R6.10, R6.11` |

A row does not hold the request, the response, or the errors: find them under the same method and path in `openapi.json`.
Below the table, a file may keep rules that no schema can state, such as why a route has no permission.
A parameter name in a path is free: `:id` and `:requestId` are the same position.
An error that any endpoint can return (`UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_FAILED`, `INTERNAL`) is in every operation of `openapi.json`; `errors.md` lists each code once with what a client does.

## The example tenant

Examples in these files use Al-Noor, a tenant with 128 active members.
Sara is its owner (Tenant Admin), Huda and Ahmed manage Legal Affairs, Faisal manages Contracts and handles requests, Nora is in Contracts, and Khalid in Procurement submits requests.
