# Phase 5 API: Legal Configuration

The endpoints of [phase-5-legal-configuration.md](phase-5-legal-configuration.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

Tenant routes run `authenticate()`, `requireRole('user')`, the subscription guard (T16), and `requireTenantPermission(...)`.
Writes are allowed in Active and Grace (configuration is not a submission, MVP 3.1), refused in Read-only.

| Method | Path                              | Permission          | Request                                                                                          | Responses                                                                                                     |
| ------ | --------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/positions`                      | `position.view`     | `unitId` (an ID or `all`; default `all`), `retired` (`true`, `false`, or `all`; default `false`) | 200 a page of positions by name; 400 `invalid_value`, `invalid_cursor`                                        |
| GET    | `/positions/:id`                  | `position.view`     |                                                                                                  | 200 the position; 404                                                                                         |
| POST   | `/positions`                      | `position.manage`   | `{unitId, name}`                                                                                 | 201 the position; 400; 409 `TAKEN` at `name`                                                                  |
| PATCH  | `/positions/:id`                  | `position.manage`   | `{name}`                                                                                         | 200 the position; 400; 404; 409 `TAKEN` at `name`, `RESOURCE_RETIRED`                                         |
| PUT    | `/positions/:id/holders`          | `position.manage`   | `{userIds:[...]}`                                                                                | 200 the position; 400 `not_unit_member`, `holds_other_position`, `user_inactive`; 404; 409 `RESOURCE_RETIRED` |
| POST   | `/positions/:id/retire`           | `position.manage`   |                                                                                                  | 200 the position; 404; 409 `POSITION_IN_USE`                                                                  |
| POST   | `/positions/:id/restore`          | `position.manage`   |                                                                                                  | 200 the position; 404; 409 `TAKEN` at `name`, `POSITION_UNIT_GONE`                                            |
| GET    | `/workflows`                      | `workflow.view`     | `retired` (`true`, `false`, or `all`; default `false`)                                           | 200 a page of workflow summaries by name; 400 `invalid_value`, `invalid_cursor`                               |
| GET    | `/workflows/:id`                  | `workflow.view`     |                                                                                                  | 200 the workflow with the current version's stages; 404                                                       |
| GET    | `/workflows/:id/versions/:number` | `workflow.view`     |                                                                                                  | 200 the version; 404                                                                                          |
| POST   | `/workflows`                      | `workflow.manage`   | `{name, stages:[stage]}`                                                                         | 201 the workflow; 400; 409 `TAKEN` at `name`                                                                  |
| PUT    | `/workflows/:id`                  | `workflow.manage`   | `{name, baseVersion, stages:[stage]}`                                                            | 200 the workflow; 400; 404; 409 `TAKEN` at `name`, `VERSION_CHANGED` at `baseVersion`, `RESOURCE_RETIRED`     |
| POST   | `/workflows/:id/retire`           | `workflow.manage`   |                                                                                                  | 200 the workflow; 404; 409 `WORKFLOW_IN_USE`                                                                  |
| POST   | `/workflows/:id/restore`          | `workflow.manage`   |                                                                                                  | 200 the workflow; 404; 409 `TAKEN` at `name`, `WORKFLOW_POSITION_RETIRED`                                     |
| GET    | `/services`                       | `service.view`      | `retired` (`true`, `false`, or `all`; default `false`)                                           | 200 a page of services by name; 400 `invalid_value`, `invalid_cursor`                                         |
| GET    | `/services/:id`                   | `service.view`      |                                                                                                  | 200 the service; 404                                                                                          |
| POST   | `/services`                       | `service.manage`    | `{name, description?, workflows:[{id, isDefault}]}`                                              | 201 the service; 400; 409 `TAKEN` at `name`                                                                   |
| PATCH  | `/services/:id`                   | `service.manage`    | any of the create fields; `description: null` clears it                                          | 200 the service; 400; 404; 409 `TAKEN` at `name`, `RESOURCE_RETIRED`                                          |
| POST   | `/services/:id/retire`            | `service.manage`    |                                                                                                  | 200 the service; 404                                                                                          |
| POST   | `/services/:id/restore`           | `service.manage`    |                                                                                                  | 200 the service; 404; 409 `TAKEN` at `name`, `SERVICE_WORKFLOW_RETIRED`                                       |
| GET    | `/priorities`                     | `priority.view`     | `retired` (`true`, `false`, or `all`; default `false`)                                           | 200 a page of priorities in display order; 400 `invalid_value`, `invalid_cursor`                              |
| POST   | `/priorities`                     | `priority.manage`   | `{name, days}`                                                                                   | 201 the priority; 400; 409 `TAKEN` at `name`                                                                  |
| PATCH  | `/priorities/:id`                 | `priority.manage`   | `{name?, days?}`                                                                                 | 200 the priority; 400; 404; 409 `TAKEN` at `name`, `RESOURCE_RETIRED`                                         |
| PUT    | `/priorities/order`               | `priority.manage`   | `{ids:[...]}`                                                                                    | 204; 400 `order_mismatch`                                                                                     |
| POST   | `/priorities/:id/retire`          | `priority.manage`   |                                                                                                  | 200 the priority; 404                                                                                         |
| POST   | `/priorities/:id/restore`         | `priority.manage`   |                                                                                                  | 200 the priority; 404; 409 `TAKEN` at `name`                                                                  |
| GET    | `/escalation`                     | `escalation.view`   |                                                                                                  | 200 `{configured, settings}`, `settings` `null` until saved                                                   |
| PUT    | `/escalation`                     | `escalation.manage` | `{r0, r1, r2}`                                                                                   | 200 `{configured: true, settings}`, as `GET /escalation`; 400                                                 |

Shapes:

- **Target** (the request): `{position: <id>}` or `{builtin: "handler" | "requester" | "handler_unit_managers" | "handler_department_managers" | "requester_unit_managers" | "requester_department_managers"}`.
  In a response a target always has all three keys, `{position, name, builtin}`: a position target has `builtin` `null`, and a built-in target has `position` and `name` `null`.
- **Stage:** `{name, assignee: target, whenUnresolved: "escalate" | "skip" | "hold", handlerMayNarrow, handlerMayEscalate, excludeParties}`; every field required (Q10: the builder decides, no default).
- **Position:** `{id, unitId, name, retired, holders:[{userId, name}]}`.
- **Workflow:** `{id, name, retired, version: {number, createdAt, createdBy, stages}, versionCount}`; a list item has the version's header without `stages`.
- **Service:** `{id, name, description, retired, form, workflows:[{id, name, isDefault, retired}]}`; `description` is `null` when blank.
- **Priority:** `{id, name, days, retired}`.
- **Escalation settings:** `{r0: {enabled, days, recipients:[target]}, r1: {enabled, percent, recipients}, r2: {enabled, recipients}}`, replaced as a whole.
  A rule has at most 20 recipients; a target listed twice in one rule is `duplicate_recipient` at the second entry; R0 refuses handler-side targets even while it is off, because an off rule keeps its recipients.
  Responses list built-in targets first, then positions by name; the audit stores the recipients sorted, in request shape, with the tenant ID as resource ID.

Lists are ordered by name (T20) and then ID, except priorities (display order: active priorities by place, then retired ones by name) and stages (ordinal).
A list answers `{data, page: {nextCursor, total}}` and takes `cursor` and `limit` (`conventions.md`); `includeRetired` is replaced by `retired`.
`PUT /positions/:id/holders` replaces the holders: a user listed twice counts once, an empty list vacates the position, and each refused entry is reported at `userIds.<index>`.
The holder and unit foreign keys map to `not_unit_member` (path `userIds`) and `unknown_unit` (path `unitId`) (T22).
`resolveAssignees` and `nextLevel` return `{level, userIds}`, so a caller that climbs does not resolve again; the context's `handlerId` may be null, as before acceptance (R0).
`PUT /workflows/:id` with the same stages as the current version creates no version; with the same name too, it returns 200 with no audit entry.
`PUT /priorities/order` must list exactly the active priorities (`order_mismatch` otherwise); retiring removes a priority from the order, restoring appends it.

## New error codes

| HTTP | Code                                                                                      | When                                                               |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 409  | `POSITION_NAME_TAKEN`, `WORKFLOW_NAME_TAKEN`, `SERVICE_NAME_TAKEN`, `PRIORITY_NAME_TAKEN` | Unique names, ignoring case (mapped from the indexes, as T11).     |
| 409  | `RESOURCE_RETIRED`                                                                        | Editing a retired item.                                            |
| 409  | `POSITION_IN_USE`, `WORKFLOW_IN_USE`                                                      | Retiring an item active configuration depends on (R5.16).          |
| 409  | `POSITION_UNIT_GONE`                                                                      | Restoring a position whose unit was deleted.                       |
| 409  | `SERVICE_WORKFLOW_RETIRED`                                                                | Restoring a service whose allowed workflows include a retired one. |
| 409  | `WORKFLOW_VERSION_CHANGED`                                                                | `baseVersion` is not the current version.                          |
| 409 | `WORKFLOW_POSITION_RETIRED` | Restoring a workflow whose current version names a retired position; its positions are restored first. |

Validation detail codes: `duplicate_recipient`, `duplicate_workflow`, `unknown_position`, `position_retired`, `unknown_workflow`, `workflow_retired`, `not_unit_member`, `holds_other_position`, `user_inactive`, `duplicate_name` (stages), `too_many_stages`, `not_allowed` (narrow or exclude on Handler or Requester), `no_default`, `many_defaults`, `not_for_rule`, `no_recipients`, `order_mismatch`.
