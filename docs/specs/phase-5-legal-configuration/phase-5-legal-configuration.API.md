# Phase 5 API: Legal Configuration

The endpoints of [phase-5-legal-configuration.md](phase-5-legal-configuration.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.
This is the implemented form: an index of the endpoints.
Request and response shapes, statuses, and the errors of each endpoint are in `docs/api/openapi.json`.

Tenant routes run `authenticate()`, `requireRole('user')`, the subscription guard (T16), and `requireTenantPermission(...)`.
Writes are allowed in Active and Grace (configuration is not a submission, MVP 3.1), refused in Read-only.

| Method | Path                              | Who                 | Purpose                                                                       | Spec refs              |
| ------ | --------------------------------- | ------------------- | ----------------------------------------------------------------------------- | ---------------------- |
| GET    | `/positions`                      | `position.view`     | List positions by name, by unit and retired state                             | R5.1, R5.17            |
| GET    | `/positions/:id`                  | `position.view`     | One position with its holders                                                 | R5.1                   |
| POST   | `/positions`                      | `position.manage`   | Create a position in a department or section                                  | R5.1                   |
| PATCH  | `/positions/:id`                  | `position.manage`   | Rename a position                                                             | R5.1                   |
| PUT    | `/positions/:id/holders`          | `position.manage`   | Replace the holders with active members of the position's unit                | R5.2, R5.3             |
| POST   | `/positions/:id/retire`           | `position.manage`   | Retire a position nothing active depends on                                   | R5.15, R5.16           |
| POST   | `/positions/:id/restore`          | `position.manage`   | Restore a retired position                                                    | R5.15                  |
| GET    | `/workflows`                      | `workflow.view`     | List workflows by name                                                        | R5.8, R5.17            |
| GET    | `/workflows/:id`                  | `workflow.view`     | One workflow with its current version's stages                                | R5.8                   |
| GET    | `/workflows/:id/versions/:number` | `workflow.view`     | One earlier or current version                                                | R5.9                   |
| POST   | `/workflows`                      | `workflow.manage`   | Create a linear workflow of 1 to 20 stages                                    | R5.8, R5.10            |
| PUT    | `/workflows/:id`                  | `workflow.manage`   | Rename it or save changed stages as the next version                          | R5.9, R5.10            |
| POST   | `/workflows/:id/retire`           | `workflow.manage`   | Retire a workflow no active service allows                                    | R5.15, R5.16           |
| POST   | `/workflows/:id/restore`          | `workflow.manage`   | Restore a retired workflow                                                    | R5.15                  |
| GET    | `/services`                       | `service.view`      | List services by name                                                         | R5.11, R5.17           |
| GET    | `/services/:id`                   | `service.view`      | One service with its allowed workflows and request form (Phase 5.5)           | R5.11                  |
| POST   | `/services`                       | `service.manage`    | Create a service with its allowed workflows and a default                     | R5.11                  |
| PATCH  | `/services/:id`                   | `service.manage`    | Edit a service; `description: null` clears it                                 | R5.11                  |
| POST   | `/services/:id/retire`            | `service.manage`    | Retire a service                                                              | R5.15                  |
| POST   | `/services/:id/restore`           | `service.manage`    | Restore a retired service whose allowed workflows are active                  | R5.15                  |
| GET    | `/priorities`                     | `priority.view`     | List priorities in display order                                              | R5.12, R5.17           |
| POST   | `/priorities`                     | `priority.manage`   | Create a priority with a deadline in working days                             | R5.12                  |
| PATCH  | `/priorities/:id`                 | `priority.manage`   | Rename a priority or change its days                                          | R5.12                  |
| PUT    | `/priorities/order`               | `priority.manage`   | Set the display order of the active priorities                                | R5.12                  |
| POST   | `/priorities/:id/retire`          | `priority.manage`   | Retire a priority                                                             | R5.15                  |
| POST   | `/priorities/:id/restore`         | `priority.manage`   | Restore a retired priority                                                    | R5.15                  |
| GET    | `/escalation`                     | `escalation.view`   | The escalation settings; `settings` is `null` until saved                     | R5.13, R5.14           |
| PUT    | `/escalation`                     | `escalation.manage` | Replace the settings of rules R0, R1, and R2 as a whole                       | R5.13, R5.14           |

## Rules a schema does not state

- Lists are ordered by name (T20) and then ID, except priorities (display order: active priorities by place, then retired ones by name) and stages (ordinal).
- A target is `{position}` or `{builtin}`; in a response it always has all three keys `{position, name, builtin}`.
- A stage has no default for `whenUnresolved` and the other flags: the builder decides (Q10).
- `PUT /positions/:id/holders` replaces the holders: a user listed twice counts once, an empty list vacates the position, and each refused entry is reported at `userIds.<index>`.
  The holder and unit foreign keys map to `not_unit_member` (path `userIds`) and `unknown_unit` (path `unitId`) (T22).
- `PUT /workflows/:id` with the same stages as the current version creates no version; with the same name too, it returns 200 with no audit entry.
  A stale `baseVersion` is 409 `VERSION_CHANGED`.
- A retire is refused while active configuration depends on the item (R5.16), and a restore while what it depends on is retired (a service whose workflow is retired, a workflow whose position is retired, a position whose unit was deleted).
- `PUT /priorities/order` must list exactly the active priorities (`order_mismatch` otherwise); retiring removes a priority from the order, restoring appends it.
- An escalation rule has at most 20 recipients; a target listed twice in one rule is `duplicate_recipient` at the second entry; R0 refuses handler-side targets even while it is off, because an off rule keeps its recipients.
  Responses list built-in targets first, then positions by name; the audit stores the recipients sorted, in request shape, with the tenant ID as resource ID.
- `resolveAssignees` and `nextLevel` return `{level, userIds}`, so a caller that climbs does not resolve again; the context's `handlerId` may be null, as before acceptance.
