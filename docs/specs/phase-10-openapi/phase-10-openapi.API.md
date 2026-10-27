# Phase 10 API: OpenAPI Document and API Reference

The endpoints of [phase-10-openapi.md](phase-10-openapi.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

These endpoints exist only when `NODE_ENV` is not `production`; in production they are 404 `NOT_FOUND` like any unknown route (R10.10).
They are not part of the generated document, since they describe it.

| Method | Path              | Who    | Purpose                                                                  | Spec refs     |
| ------ | ----------------- | ------ | ------------------------------------------------------------------------ | ------------- |
| GET    | `/docs`           | public | The Scalar reference page for `/openapi.json`, with try-it               | R10.10, P10.5 |
| GET    | `/docs/scalar.js` | public | The page's script, served from the package and not from a CDN            | R10.10, P10.8 |
| GET    | `/openapi.json`   | public | The OpenAPI 3.1 document, equal to the committed `docs/api/openapi.json` | R10.7, R10.10 |

Every other endpoint keeps its method, path, request, and responses unchanged (R10.11); only how it is declared and documented changes.
