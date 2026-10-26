# Phase 5 API: Legal Configuration

The endpoints of [phase-5-legal-configuration.md](phase-5-legal-configuration.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

Tenant routes run `authenticate()`, `requireRole('user')`, the subscription guard (T16), and `requireTenantPermission(...)`.
Writes are allowed in Active and Grace (configuration is not a submission, MVP 3.1), refused in Read-only.

| Method | Path                                 | Permission          | Request                                             | Responses                                                                                                     |
| ------ | ------------------------------------ | ------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/positions`                         | `position.view`     | `unitId?`, `includeRetired?`                        | 200 `{positions:[position]}`                                                                                  |
| GET    | `/positions/:id`                     | `position.view`     |                                                     | 200 `{position}`; 404                                                                                         |
| POST   | `/positions`                         | `position.manage`   | `{unitId, name}`                                    | 201 `{position}`; 400; 409 `POSITION_NAME_TAKEN`                                                              |
| PATCH  | `/positions/:id`                     | `position.manage`   | `{name}`                                            | 200; 400; 404; 409 `POSITION_NAME_TAKEN`, `RESOURCE_RETIRED`                                                  |
| PUT    | `/positions/:id/holders`             | `position.manage`   | `{userIds:[...]}`                                   | 200 `{position}`; 400 `not_unit_member`, `holds_other_position`, `user_inactive`; 404; 409 `RESOURCE_RETIRED` |
| POST   | `/positions/:id/retire`              | `position.manage`   |                                                     | 200; 404; 409 `POSITION_IN_USE`                                                                               |
| POST   | `/positions/:id/restore`             | `position.manage`   |                                                     | 200; 404; 409 `POSITION_NAME_TAKEN`, `POSITION_UNIT_GONE`                                                     |
| GET    | `/workflows`                         | `workflow.view`     | `includeRetired?`                                   | 200 `{workflows:[summary]}`                                                                                   |
| GET    | `/workflows/:id`                     | `workflow.view`     |                                                     | 200 `{workflow}` with the current version's stages; 404                                                       |
| GET    | `/workflows/:id/versions/:number`    | `workflow.view`     |                                                     | 200 `{version}`; 404                                                                                          |
| POST   | `/workflows`                         | `workflow.manage`   | `{name, stages:[stage]}`                            | 201 `{workflow}`; 400; 409 `WORKFLOW_NAME_TAKEN`                                                              |
| PUT    | `/workflows/:id`                     | `workflow.manage`   | `{name, baseVersion, stages:[stage]}`               | 200 `{workflow}`; 400; 404; 409 `WORKFLOW_NAME_TAKEN`, `WORKFLOW_VERSION_CHANGED`, `RESOURCE_RETIRED`         |
| POST   | `/workflows/:id/retire`              | `workflow.manage`   |                                                     | 200; 404; 409 `WORKFLOW_IN_USE`                                                                               |
| POST   | `/workflows/:id/restore`             | `workflow.manage`   |                                                     | 200; 404; 409 `WORKFLOW_NAME_TAKEN`, `WORKFLOW_POSITION_RETIRED`                                              |
| GET    | `/services`                          | `service.view`      | `includeRetired?`                                   | 200 `{services:[service]}`                                                                                    |
| GET    | `/services/:id`                      | `service.view`      |                                                     | 200; 404                                                                                                      |
| POST   | `/services`                          | `service.manage`    | `{name, description?, workflows:[{id, isDefault}]}` | 201; 400; 409 `SERVICE_NAME_TAKEN`                                                                            |
| PATCH  | `/services/:id`                      | `service.manage`    | any of the create fields                            | 200; 400; 404; 409 `SERVICE_NAME_TAKEN`, `RESOURCE_RETIRED`                                                   |
| POST   | `/services/:id/retire`, `/restore`   | `service.manage`    |                                                     | 200; 404; 409 `SERVICE_NAME_TAKEN` (restore), `SERVICE_WORKFLOW_RETIRED` (restore)                            |
| GET    | `/priorities`                        | `priority.view`     | `includeRetired?`                                   | 200 `{priorities:[priority]}` in display order                                                                |
| POST   | `/priorities`                        | `priority.manage`   | `{name, days}`                                      | 201; 400; 409 `PRIORITY_NAME_TAKEN`                                                                           |
| PATCH  | `/priorities/:id`                    | `priority.manage`   | `{name?, days?}`                                    | 200; 400; 404; 409 `PRIORITY_NAME_TAKEN`, `RESOURCE_RETIRED`                                                  |
| PUT    | `/priorities/order`                  | `priority.manage`   | `{ids:[...]}`                                       | 200 `{priorities}`; 400 `order_mismatch`                                                                      |
| POST   | `/priorities/:id/retire`, `/restore` | `priority.manage`   |                                                     | 200; 404; 409 `PRIORITY_NAME_TAKEN` (restore)                                                                 |
| GET    | `/escalation`                        | `escalation.view`   |                                                     | 200 `{configured, settings?}`                                                                                 |
| PUT    | `/escalation`                        | `escalation.manage` | `{r0, r1, r2}`                                      | 200 `{configured: true, settings}`; 400                                                                       |

Shapes:

- **Target:** `{position: <id>}` or `{builtin: "handler" | "requester" | "handler_unit_managers" | "handler_department_managers" | "requester_unit_managers" | "requester_department_managers"}`.
  Responses add the position's name.
- **Stage:** `{name, assignee: target, whenUnresolved: "escalate" | "skip" | "hold", handlerMayNarrow, handlerMayEscalate, excludeParties}`; every field required (Q10: the builder decides, no default).
- **Position:** `{id, unitId, name, retired, holders:[{userId, name}]}`.
- **Workflow:** `{id, name, retired, version: {number, createdAt, createdBy, stages}, versionCount}`.
- **Service:** `{id, name, description, retired, workflows:[{id, name, isDefault, retired}]}`.
- **Priority:** `{id, name, days, retired}`.
- **Escalation:** `{r0: {enabled, days, recipients:[target]}, r1: {enabled, percent, recipients}, r2: {enabled, recipients}}`, replaced as a whole.
  A rule has at most 20 recipients; a target listed twice in one rule is `duplicate_recipient` at the second entry; R0 refuses handler-side targets even while it is off, because an off rule keeps its recipients.
  Responses list built-in targets first, then positions by name; the audit stores the recipients sorted, in request shape, with the tenant ID as resource ID.

Lists are ordered by name (T20), except priorities (display order) and stages (ordinal).
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
