# Phase 8 API: API Contract

The endpoints of [phase-8-api-contract.md](phase-8-api-contract.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

Every endpoint changes to the shapes of section 4.2: success bodies inside `data`, lists as `{data, page}`, errors with `details` always present.
This file lists only the endpoints whose contract changes beyond that; each phase's `.API.md` is rewritten to the new shapes by the step that migrates its module (Q20).

## Lists

Every list gains `cursor` and `limit` (1-100, default 25) and answers `{data: [item], page: {nextCursor, total}}` in the order of 4.2.3.

| Method | Path                | Who                            | Request (beyond `cursor`, `limit`)                                                                                       | Responses                                                                             |
| ------ | ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| GET    | `/operator/plans`   | `platform.plan.view`           | none                                                                                                                     | 200 a page of plans                                                                   |
| GET    | `/operator/tenants` | `platform.tenant.view`         | none                                                                                                                     | 200 a page of tenant details `{tenant, subscription, usage}` (Q18)                                 |
| GET    | `/users`            | `user.view`                    | `unitId` (ID, `none`, `all`), `managers`, `roleId` (ID, `all`), `status` (default `active`), `q`; `offset` is removed    | 200 a page of users                                                                   |
| GET    | `/roles`            | `role.view`                    | none                                                                                                                     | 200 a page of roles                                                                   |
| GET    | `/permissions`      | `role.view`                    | none                                                                                                                     | 200 a page of catalog entries `{key, scopes}`                                         |
| GET    | `/positions`        | `position.view`                | `unitId` (ID, `all`), `retired` (default `false`); `includeRetired` is removed                                           | 200 a page of positions                                                               |
| GET    | `/priorities`       | `priority.view`                | `retired` (default `false`); `includeRetired` is removed                                                                 | 200 a page of priorities                                                              |
| GET    | `/services`         | `service.view`                 | `retired` (default `false`); `includeRetired` is removed                                                                 | 200 a page of services                                                                |
| GET    | `/workflows`        | `workflow.view`                | `retired` (default `false`); `includeRetired` is removed                                                                 | 200 a page of workflow summaries                                                      |
| GET    | `/requests`         | anyone; rows by visibility     | `view`, `state` (a state, `all`), `serviceId` (ID, `all`); `offset` is removed; the ID order becomes descending           | 200 a page of request summaries                                                       |
| GET    | `/notifications`    | any user                       | `unread` (`true`, `false` = read only, `all` = default); `before` is removed                                             | 200 a page of notifications (`hasMore` is replaced by `page.nextCursor`)             |

## Other endpoints

| Method | Path                                         | Who                              | Request   | Responses                                                                                                                                  |
| ------ | -------------------------------------------- | -------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/health`                                    | anyone                           |           | 200 `{status: "ok", db: "up"}`; 503 `SERVICE_UNAVAILABLE`                                                                                  |
| POST   | `/auth/login`                                | anyone                           | unchanged | 200 the session, as `GET /auth/me`: `{user, subscription}` (Q17)                                                                          |
| POST   | `/auth/refresh`                              | refresh cookie                   | unchanged | 200 the session, as `GET /auth/me` (Q17)                                                                                                    |
| POST   | `/operator/tenants`                          | `platform.tenant.create`         | unchanged | 201 the tenant detail `{tenant, subscription, usage}` (no longer `admin`); 409 `TAKEN` at `slug` or `admin.email` (Q18)                                  |
| GET    | `/operator/tenants/:tenantId`                | `platform.tenant.view`           |           | 200 the tenant detail `{tenant, subscription, usage}`, unchanged (Q18)                                                          |
| PUT    | `/operator/tenants/:tenantId/subscription`   | `platform.subscription.update`   | unchanged | 200 the tenant detail `{tenant, subscription, usage}` (was `{subscription, usage}`) (Q18)                                                                                                                 |
| PUT    | `/priorities/order`                          | `priority.manage`                | unchanged | 204 (Q19)                                                                                                                                   |
| GET    | `/escalation`                                | `escalation.view`                |           | 200 `{configured, settings}`, `settings` `null` until saved                                                                                |
| GET    | `/calendar/days`                             | `calendar.view`                  | unchanged | 200 `{from, to, days}`; a day's `start`, `end`, and `season` are `null` when absent                                                        |
| GET    | `/requests/:requestId`                       | visibility                       |           | 200 the request; every answer has `files` (`null` for non-file fields); a removed file has `name`, `contentType`, `sizeBytes` as `null` |
| POST   | `/requests/:requestId/information-requests`  | handler or stage assignee        | unchanged | 200 the request (was 201: no new resource with its own URL)                                                                                 |

Unique-value conflicts on `POST` and `PATCH` of plans, tenants, org units, users, roles, positions, workflows, services, and priorities answer 409 `TAKEN` at the field.
`PUT /workflows/:workflowId` and `PUT /services/:serviceId/form` answer 409 `VERSION_CHANGED` at `baseVersion` and `baseRevision`.
`POST /roles`, `PATCH /roles/:roleId`, and `PUT /users/:userId/role` answer `PERMISSION_NOT_HELD` with each detail at the body entry that asked for the missing permission; refusals that no input caused (the route's own permission, deactivating a user whose role is above the actor's) have no details.

## Validation

| Detail code      | Path                 | When                                                                                       |
| ---------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `invalid_cursor` | `cursor`             | The cursor is broken, altered, or from another list or other filters.                     |
| `invalid_value`  | the filter           | A filter value the list does not accept (`unread=maybe`).                                  |
| `invalid_json`   | `""`                 | The body is not valid JSON (it had no details).                                            |
| `taken`          | the field            | With `TAKEN`.                                                                              |

## New error codes

| Code                  | Status | When                                                                                                                       |
| --------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `TAKEN`               | 409    | A unique value is already used; replaces `EMAIL_TAKEN`, `SLUG_TAKEN`, and the seven `*_NAME_TAKEN` codes.                  |
| `VERSION_CHANGED`     | 409    | The resource changed since the client read it; replaces `WORKFLOW_VERSION_CHANGED` and `SERVICE_FORM_CHANGED`.             |
| `SERVICE_UNAVAILABLE` | 503    | `/health` cannot reach the database.                                                                                       |
