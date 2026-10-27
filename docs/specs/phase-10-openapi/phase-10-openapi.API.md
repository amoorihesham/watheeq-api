# Phase 10 API: OpenAPI Document and API Reference

The endpoints of [phase-10-openapi.md](phase-10-openapi.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

Both endpoints exist only when `NODE_ENV` is not `production`; in production they are 404 `NOT_FOUND` like any unknown route (R10.10).
They are not part of the generated document.

While this spec is a draft, the endpoints are listed below instead of in the template's table: the C5 contract test reads every `.API.md` table and fails on a row whose route is not mounted yet (4.7, Q15).
They become table rows (Realm `public`, Permission none) when step 10.4 mounts them.

- `GET /docs`: 200 the Scalar reference page (HTML) for `/openapi.json`.
- `GET /openapi.json`: 200 the OpenAPI 3.1 document, equal to the committed `docs/api/openapi.json` (R10.7).

Every other endpoint keeps its method, path, request, and responses unchanged (R10.11); only how it is declared and documented changes.

## Validation

No new detail codes.

## New error codes

None.
