# Phase 6 API: Request Lifecycle

The endpoints of [phase-6-request-lifecycle.md](phase-6-request-lifecycle.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

Tenant routes run `authenticate()`, `requireRole('user')`, and the subscription guard (T16).
Routes for parties (requester, handler, assignees) declare no permission: being the party is the authorization, re-checked in the database (D31; recorded exception to T24, as Phase 5 records).

| Method | Path                                                | Who                                   | Request                                                                                                                                                                                             | Responses                                                                                              |
| ------ | --------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/requests/catalog`                                 | `request.submit`                      |                                                                                                                                                                                                     | 200 `{services:[{id, name, description, form}], priorities:[{id, name, days}]}`                        |
| POST   | `/requests`                                         | `request.submit`, Active subscription | `{serviceId, priorityId, title, answers, fileIds?}`                                                                                                                                                 | 201 the request; 400; 403 `SUBSCRIPTION_NOT_ACTIVE`; 409 `ESCALATION_NOT_CONFIGURED`, `TOO_MANY_FILES` |
| GET    | `/requests`                                         | anyone; rows by R6.7                  | `view?` (`waiting_on_me`, `handling`, `requested`, `review_queue`; left out: every request the caller sees), `state` (a state or `all`; default `all`), `serviceId` (an ID or `all`; default `all`) | 200 a page of request summaries, newest submission first; 400 `invalid_value`, `invalid_cursor`        |
| GET    | `/requests/:id`                                     | R6.7                                  |                                                                                                                                                                                                     | 200 the request; 404                                                                                   |
| PUT    | `/requests/:id/priority`                            | `request.review`, in review           | `{priorityId, reason}`                                                                                                                                                                              | 200 the request; 400; 404; 409 `INVALID_REQUEST_STATE`                                                 |
| POST   | `/requests/:id/accept`                              | `request.review`, in review           | `{handlerId, workflowId}`                                                                                                                                                                           | 200 the request; 400; 404; 409 `INVALID_REQUEST_STATE`                                                 |
| POST   | `/requests/:id/reject`                              | `request.review`, in review           | `{reason}`                                                                                                                                                                                          | 200 the request; 404; 409                                                                              |
| POST   | `/requests/:id/withdraw`                            | the requester, in review              | `{reason}`                                                                                                                                                                                          | 200 the request; 404; 409                                                                              |
| PUT    | `/requests/:id/handler`                             | `request.reassign`, in progress       | `{handlerId, reason}`                                                                                                                                                                               | 200 the request; 400; 404; 409                                                                         |
| POST   | `/requests/:id/stages/:runId/complete`              | an assignee                           | `{comment?}`                                                                                                                                                                                        | 200 the request; 403; 404; 409 `STAGE_NOT_ACTIVE`                                                      |
| POST   | `/requests/:id/stages/:runId/return`                | an assignee                           | `{reason}`                                                                                                                                                                                          | 200 the request; 403; 404; 409 `STAGE_NOT_ACTIVE`, `NO_EARLIER_STAGE`                                  |
| POST   | `/requests/:id/stages/:runId/narrow`                | the handler, if the stage allows      | `{userIds, reason}`                                                                                                                                                                                 | 200 the request; 400 `not_assignee`; 403; 404; 409                                                     |
| POST   | `/requests/:id/stages/:runId/escalate`              | the handler, if the stage allows      | `{reason}`                                                                                                                                                                                          | 200 the request; 403; 404; 409 `NO_HIGHER_LEVEL`                                                       |
| POST   | `/requests/:id/stages/:runId/refresh`               | the handler                           | `{reason?}`                                                                                                                                                                                         | 200 the request; 403; 404; 409                                                                         |
| POST   | `/requests/:id/information-requests`                | R6.20                                 | `{question}`                                                                                                                                                                                        | 200 the request; 403; 404; 409 `INFORMATION_REQUEST_OPEN`, `INVALID_REQUEST_STATE`                     |
| POST   | `/requests/:id/information-requests/:infoId/answer` | the requester                         | `{answer, fileIds?}`                                                                                                                                                                                | 200 the request; 403; 404; 409                                                                         |
| POST   | `/requests/:id/information-requests/:infoId/cancel` | its asker or the handler              |                                                                                                                                                                                                     | 200 the request; 403; 404; 409                                                                         |
| POST   | `/requests/:id/close-no-response`                   | the handler, in progress              | `{reason}`                                                                                                                                                                                          | 200 the request; 403; 404; 409 `NO_OPEN_INFORMATION_REQUEST`                                           |
| POST   | `/requests/:id/files`                               | R6.24                                 | `{fileIds}`                                                                                                                                                                                         | 200 the request; 400; 403; 404; 409 `TOO_MANY_FILES`                                                   |
| POST   | `/requests/:id/files/:fileId/remove`                | R6.25                                 | `{reason}`                                                                                                                                                                                          | 200 the request; 403; 404; 409                                                                         |
| GET    | `/requests/:id/files/:fileId/content`               | R6.7                                  |                                                                                                                                                                                                     | 200 the bytes as a download (Phase 5.5 headers); 404                                                   |

Shapes:

- **Summary:** `{id, number: "REQ-42-2026", title, state, service: {id, name}, priority: {name, days}, requester: {id, name}, handler, submittedAt, acceptedAt, closedAt, deadline, activeStage}`; `handler`, `acceptedAt`, `closedAt`, `deadline`, and `activeStage` (`{name, waitingOn:[{id, name}]}`) are `null` when they do not apply.
- **Request:** the summary plus `answers`, `files`, `stages` (every run in order, with assignees, state, times, and comments), `informationRequests`, `sla`, `escalations`, and `allowedActions` (the actions the caller may take now, so the web app shows only valid buttons).
- **Answer:** `{field, value, chosen, files}`: `field` is the copy of the form field's definition, in the field shape of Phase 5.5 (every setting present, `null` where the type has none), `chosen` is the list of chosen options for a choice field and `null` otherwise, and `files` is the list of the files named for a file field and `null` otherwise.
  An answer's file is `{id, removed, name, contentType, sizeBytes}`; once removed (R6.25) `removed` is `true` and the other three are `null`.
- **SLA:** `{deadline, elapsedDays, met, breachDays, awaitingInfoDays}`: live while in progress, the frozen record once closed, `null` before acceptance.

Every action route returns the request, as `GET /requests/:id` shows it to the caller after the action.
Asking an information request returns 200, not 201: it creates nothing with its own URL.
`files` are ordered by attach time, then name, then ID.
`allowedActions` names: `withdraw`, `change_priority`, `accept`, `reject`, `reassign`, `complete`, `return`, `refresh`, `narrow`, `escalate`, `attach_files`, `ask_information`, `answer_information`, `cancel_information`, `close_no_response`.
Changing the priority to the one the request already has returns 200 and writes no audit entry.
The list is ordered by `submitted_at` descending, then `id` descending, paged by `cursor` and `limit` (`conventions.md`); the total counts the requests the caller sees that match the filters.
`deadline` in lists is computed in memory with one `loadCalendar` per request (Q6).
Reasons are trimmed, 1-2,000 characters; comments up to 2,000.
`fileIds` are the caller's pending uploads (Phase 5.5); refusals come from `attachFiles` at `fileIds.<index>`, and for a file named in a form answer at `answers.<fieldId>.<index>`.

Checks run in this order: not visible is 404, not allowed is 403, the wrong state is 409.
Two exceptions: attaching and asking on a closed request are 409 before the party check, and closing as no response while in review is 403, since there is no handler yet.
Every party action (withdraw, the stage actions, asking, answering, cancelling, attaching, removing, and closing as no response) first checks in the database that the caller is still an active member: a deactivated member's token stays valid until it expires (D31), and the action is 403.

## New error codes

| HTTP | Code                          | When                                                              |
| ---- | ----------------------------- | ----------------------------------------------------------------- |
| 403  | `SUBSCRIPTION_NOT_ACTIVE`     | Submitting in Grace (Phase 1's `requireActiveSubscription`).      |
| 409  | `ESCALATION_NOT_CONFIGURED`   | Submitting before the tenant saved its escalation settings (D33). |
| 403  | `PERMISSION_NOT_HELD`         | Review or reassign by a caller whose role, read from the database, no longer holds the permission. |
| 409  | `INVALID_REQUEST_STATE`       | The action is not allowed in the request's state; also a handler stage action on a request not in progress. |
| 409  | `STAGE_NOT_ACTIVE`            | The run is not the request's live run, or no longer active; also any stage action on a closed request, and anything but refresh on a held run. |
| 409  | `NO_EARLIER_STAGE`            | Returning from the first stage that ran.                          |
| 409  | `NO_HIGHER_LEVEL`             | Escalating past the department's managers.                        |
| 409  | `INFORMATION_REQUEST_OPEN`    | A second information request while one is open.                   |
| 409  | `NO_OPEN_INFORMATION_REQUEST` | "No response" closure without an open information request; answering or cancelling one that is no longer open. |
| 409  | `TOO_MANY_FILES`              | More than 50 files on one request.                                |

Validation detail codes: `unknown_service`, `service_retired`, `unknown_priority`, `priority_retired`, `unknown_workflow`, `workflow_not_allowed`, `workflow_retired`, `handler_not_eligible`, `handler_is_requester`, `not_assignee`, `same_handler`, plus the answer codes of Phase 5.5 and the `attachFiles` codes.

## Permissions

Five catalog keys (T26); the Tenant Admin role holds them at once (D21), each at its widest allowed scope, so `request.submit` at own:

| Key                | Scopes                                 | Grants                                                                             |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `request.submit`   | own                                    | the catalog and submission                                                         |
| `request.view`     | own, section, department, organization | requests whose recorded requester or handler unit is within scope (R6.7)           |
| `request.review`   | organization                           | the review queue, priority changes, information requests in review, accept, reject |
| `request.handle`   | organization                           | being eligible as a handler (checked on the chosen person, not the caller)         |
| `request.reassign` | organization                           | changing the handler                                                               |
