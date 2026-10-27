# Phase <N> API: <Phase Name>

The endpoints of [phase-<N>-<name>.md](phase-<N>-<name>.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

A phase's API file has two forms.
While the spec is `Draft` or `In Review`, no code exists, so `docs/api/openapi.json` cannot show the endpoints: use the Draft form, with full shapes.
When the spec reaches `Implemented`, the endpoint declarations in the code own the shapes, statuses, and per-endpoint errors, so trim the file to the Implemented form.
The route test (C5) reads only the tables of specs in `In Implementation` or `Implemented`, so a Draft table may list endpoints that are not mounted yet.

## Draft form

| Method | Path | Realm | Permission | Request | Responses |
| ------ | ---- | ----- | ---------- | ------- | --------- |

### Validation

Detail codes this phase's request bodies and queries add.

### New error codes

| Code | Status | When |
| ---- | ------ | ---- |

## Implemented form

This is the implemented form: an index of the endpoints.
Request and response shapes, statuses, and the errors of each endpoint are in `docs/api/openapi.json`.

| Method | Path | Who | Purpose | Spec refs |
| ------ | ---- | --- | ------- | --------- |

- **Who** is the permission, party, or realm, as `docs/api/access.md` names it (`request.review`, in review; the requester; public).
- **Purpose** is one short line. For an endpoint another phase owns, say what this phase changed, and start it with "(changed)".
- **Spec refs** are the requirement and decision IDs of this spec that the endpoint implements.
- Keep every Method and Path exactly as mounted, with `:name` for a path parameter.

### Rules a schema does not state

Keep only what a schema and the error list cannot say: why a route has no permission, visibility and ordering rules, behavior that spans endpoints.
Remove field lists, statuses, "New error codes", and anything the declaration in `<module>.endpoints.ts` already states.
