# Phase 7 API: Escalation and Notifications

The endpoints of [phase-7-escalation-notifications.md](phase-7-escalation-notifications.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.
This is the implemented form: an index of the endpoints.
Request and response shapes, statuses, and the errors of each endpoint are in `docs/api/openapi.json`.

Notification routes run `authenticate()` and `requireRole('user')`, and **not** `subscriptionGuard`, so they work in Read-only (Q5): they read and write only the caller's own rows, and `read_at` is inbox state, not business data.
This is a recorded exception to T16 (P7.7).
No permission is required: every user has an inbox, as every user has `/auth/me`.

| Method | Path                          | Who       | Purpose                                                           | Spec refs    |
| ------ | ----------------------------- | --------- | ----------------------------------------------------------------- | ------------ |
| GET    | `/notifications`              | any user  | The caller's notifications, newest first, optionally unread only  | R7.15        |
| GET    | `/notifications/unread-count` | any user  | The number of unread notifications                                | R7.15        |
| POST   | `/notifications/:id/read`     | its owner | Mark one notification read; repeating it is 204 too               | R7.11, R7.15 |
| POST   | `/notifications/read-all`     | any user  | Mark the caller's unread notifications read up to one they saw    | R7.15        |

`GET /requests/:id` (Phase 6) gains `escalations`, one entry per rule that fired, ordered by `fired_at` (R7.5, R7.10).

## Rules a schema does not state

- The order is `created_at` descending, then `id` descending, and a cursor continues after the last notification of the previous page in that order.
  Notifications written by one transaction share a `created_at`, so the ID breaks the tie; the order between them is arbitrary but stable.
- `unread=true` is unread only, `unread=false` is read only, and `all` (the default) is both; any other value is 400 `invalid_value`.
- Why a cursor instead of `offset`: a notification that arrives while Faisal reads page one would shift every later page by one with offsets, so he would see one twice; a position after the last notification he has seen does not move.
- Why `read-all` takes `upTo`: Faisal opens his list at 10:00:00 and presses "mark all read" at 10:00:05; the R2 that arrived at 10:00:03 must stay unread, since he never saw it.
  `upTo` marks the caller's unread notifications at or before that notification, in the list order.
  An `upTo` that is not the caller's own notification is 400 `unknown_notification`, the same answer for another user's ID and a made-up one.
