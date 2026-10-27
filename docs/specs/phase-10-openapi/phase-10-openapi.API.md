# Phase 10 API: OpenAPI Document and API Reference

The endpoints of [phase-10-openapi.md](phase-10-openapi.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

Both endpoints exist only when `NODE_ENV` is not `production`; in production they are 404 `NOT_FOUND` like any unknown route (R10.10).
They are not part of the generated document.

| Method | Path                | Who    | Request | Responses                                                                          |
| ------ | ------------------- | ------ | ------- | ---------------------------------------------------------------------------------- |
| GET    | `/docs`             | public | none    | 200 the Scalar reference page (HTML) for `/openapi.json`                           |
| GET    | `/docs/scalar.js`   | public | none    | 200 the Scalar script the page loads, served from the package and not from a CDN   |
| GET    | `/openapi.json`     | public | none    | 200 the OpenAPI 3.1 document, equal to the committed `docs/api/openapi.json` (R10.7) |

Every other endpoint keeps its method, path, request, and responses unchanged (R10.11); only how it is declared and documented changes.

## Validation

No new detail codes.

## New error codes

None.
