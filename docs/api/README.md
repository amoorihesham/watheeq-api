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

Every endpoint is a row in the `.API.md` file of the phase that designed it, in `docs/specs/phase-<N>-<name>/`.
`docs/specs/phase-8-api-contract/phase-8-api-contract.API.md` lists what the contract changed.
A contract test fails when a mounted route has no row, or a row has no route (Phase 8, R8.17).

## How to read an endpoint row

| Cell | Meaning | Example |
| ---- | ------- | ------- |
| Method | The HTTP method | `POST` |
| Path | The full mounted path, with `:name` for a path parameter and no query string | `/requests/:requestId/accept` |
| Who or Permission | The permission or party the caller needs (`access.md`) | `request.review`, in review |
| Request | The query parameters or the JSON body, `?` marking an optional field | `{handlerId, workflowId}` |
| Responses | The status and what `data` holds, then the errors the endpoint can add | `200 the request; 409 INVALID_REQUEST_STATE` |

The Responses cell describes `data`, never the wrapper (`conventions.md`).
A parameter name in a path is free: `:id` and `:requestId` are the same position.
An error that any endpoint can return (`UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_FAILED`, `INTERNAL`) is not repeated in each row; `errors.md` lists it once.

## The example tenant

Examples in these files use Al-Noor, a tenant with 128 active members.
Sara is its owner (Tenant Admin), Huda and Ahmed manage Legal Affairs, Faisal manages Contracts and handles requests, Nora is in Contracts, and Khalid in Procurement submits requests.
