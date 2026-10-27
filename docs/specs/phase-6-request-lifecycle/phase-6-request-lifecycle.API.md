# Phase 6 API: Request Lifecycle

The endpoints of [phase-6-request-lifecycle.md](phase-6-request-lifecycle.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.
This is the implemented form: an index of the endpoints.
Request and response shapes, statuses, and the errors of each endpoint are in `docs/api/openapi.json`.

Tenant routes run `authenticate()`, `requireRole('user')`, and the subscription guard (T16).
Routes for parties (requester, handler, assignees) declare no permission: being the party is the authorization, re-checked in the database (D31; recorded exception to T24, as Phase 5 records).

| Method | Path                                                | Who                                   | Purpose                                                                         | Spec refs    |
| ------ | --------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- | ------------ |
| GET    | `/requests/catalog`                                 | `request.submit`                      | The active services with their forms and the active priorities                  | R6.2         |
| POST   | `/requests`                                         | `request.submit`, Active subscription | Submit a request with the service's form answers and files                      | R6.1, R6.3-R6.6 |
| GET    | `/requests`                                         | anyone; rows by R6.7                  | List the requests the caller sees, newest submission first, by view, state, service | R6.7, R6.8   |
| GET    | `/requests/:id`                                     | R6.7                                  | One request with answers, stages, information requests, SLA, and allowed actions | R6.7, R6.22  |
| PUT    | `/requests/:id/priority`                            | `request.review`, in review           | Change the priority with a reason                                               | R6.9         |
| POST   | `/requests/:id/accept`                              | `request.review`, in review           | Accept with a handler and a workflow                                            | R6.10, R6.11 |
| POST   | `/requests/:id/reject`                              | `request.review`, in review           | Reject with a reason                                                            | R6.12        |
| POST   | `/requests/:id/withdraw`                            | the requester, in review              | Withdraw with a reason                                                          | R6.12        |
| PUT    | `/requests/:id/handler`                             | `request.reassign`, in progress       | Change the handler with a reason                                                | R6.19        |
| POST   | `/requests/:id/stages/:runId/complete`              | an assignee                           | Complete the active stage; the last stage completes the request                 | R6.14, R6.15 |
| POST   | `/requests/:id/stages/:runId/return`                | an assignee                           | Return to the nearest earlier stage that ran, with a reason                     | R6.14, R6.16 |
| POST   | `/requests/:id/stages/:runId/narrow`                | the handler, if the stage allows      | Narrow the stage's assignees to some of them                                    | R6.17        |
| POST   | `/requests/:id/stages/:runId/escalate`              | the handler, if the stage allows      | Escalate the stage to the next level                                            | R6.17        |
| POST   | `/requests/:id/stages/:runId/refresh`               | the handler                           | Resolve the stage's assignees again                                             | R6.18        |
| POST   | `/requests/:id/information-requests`                | R6.20                                 | Ask the requester a question                                                    | R6.20        |
| POST   | `/requests/:id/information-requests/:infoId/answer` | the requester                         | Answer an open information request, with files                                  | R6.20        |
| POST   | `/requests/:id/information-requests/:infoId/cancel` | its asker or the handler              | Cancel an open information request                                              | R6.20        |
| POST   | `/requests/:id/close-no-response`                   | the handler, in progress              | Close as "Rejected - no response" while an information request is open          | R6.21        |
| POST   | `/requests/:id/files`                               | R6.24                                 | Attach pending uploads to an open request                                       | R6.24        |
| POST   | `/requests/:id/files/:fileId/remove`                | R6.25                                 | Remove an attached file with a reason                                           | R6.25        |
| GET    | `/requests/:id/files/:fileId/content`               | R6.7                                  | Download an attached file                                                       | R6.7, R5.5.13 |

## Rules a schema does not state

- Every action route returns the request, as `GET /requests/:id` shows it to the caller after the action.
  Asking an information request returns 200, not 201: it creates nothing with its own URL.
- `allowedActions` names the actions the caller may take now, so the web app shows only valid buttons: `withdraw`, `change_priority`, `accept`, `reject`, `reassign`, `complete`, `return`, `refresh`, `narrow`, `escalate`, `attach_files`, `ask_information`, `answer_information`, `cancel_information`, `close_no_response`.
- Changing the priority to the one the request already has returns 200 and writes no audit entry.
- The list is ordered by `submitted_at` descending, then `id` descending; the total counts the requests the caller sees that match the filters. `deadline` in lists is computed in memory with one `loadCalendar` per request (Q6). `files` are ordered by attach time, then name, then ID.
- Reasons are trimmed, 1-2,000 characters; comments up to 2,000.
- `fileIds` are the caller's pending uploads (Phase 5.5); refusals come from `attachFiles` at `fileIds.<index>`, and for a file named in a form answer at `answers.<fieldId>.<index>`.
- Checks run in this order: not visible is 404, not allowed is 403, the wrong state is 409.
  Two exceptions: attaching and asking on a closed request are 409 before the party check, and closing as no response while in review is 403, since there is no handler yet.
- Every party action (withdraw, the stage actions, asking, answering, cancelling, attaching, removing, and closing as no response) first checks in the database that the caller is still an active member: a deactivated member's token stays valid until it expires (D31), and the action is 403.
- `PERMISSION_NOT_HELD` on review or reassign means the caller's role, read from the database, no longer holds the permission.

## Permissions

Five catalog keys (T26); the Tenant Admin role holds them at once (D21), each at its widest allowed scope, so `request.submit` at own:

| Key                | Scopes                                 | Grants                                                                             |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `request.submit`   | own                                    | the catalog and submission                                                         |
| `request.view`     | own, section, department, organization | requests whose recorded requester or handler unit is within scope (R6.7)           |
| `request.review`   | organization                           | the review queue, priority changes, information requests in review, accept, reject |
| `request.handle`   | organization                           | being eligible as a handler (checked on the chosen person, not the caller)         |
| `request.reassign` | organization                           | changing the handler                                                               |
