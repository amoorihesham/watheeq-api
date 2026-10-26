# Phase 7 API: Escalation and Notifications

The endpoints of [phase-7-escalation-notifications.md](phase-7-escalation-notifications.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

Notification routes run `authenticate()` and `requireRole('user')`, and **not** `subscriptionGuard`, so they work in Read-only (Q5): they read and write only the caller's own rows, and `read_at` is inbox state, not business data.
This is a recorded exception to T16 (P7.7).
No permission is required: every user has an inbox, as every user has `/auth/me`.

| Method | Path                          | Who       | Request                                                                        | Responses                                                                              |
| ------ | ----------------------------- | --------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| GET    | `/notifications`              | any user  | `unread?` (`true`, or `false` for no filter), `before?` (a notification ID), `limit` (1-100, default 25) | 200 `{notifications: [notification], hasMore}`; 400 `unknown_notification` at `before` |
| GET    | `/notifications/unread-count` | any user  |                                                                                | 200 `{count}`                                                                          |
| POST   | `/notifications/:id/read`     | its owner |                                                                                | 204, also when already read; 404                                                       |
| POST   | `/notifications/read-all`     | any user  | `{upTo}` (a notification ID)                                                   | 204; 400 `unknown_notification` at `upTo`                                              |

Shapes:

- **Notification:** `{id, kind, request: {id} | null, data, createdAt, readAt}`.
- Ordered by `created_at` descending, then `id` descending; `before` returns the ones after the given notification in that order.
- Notifications written by one transaction share a `created_at`, so the ID breaks the tie; the order between them is arbitrary but stable, and `upTo` uses the same order, so "mark all read" covers exactly what the list showed up to that point.
- `unread=false` means no filter, so a client can send its toggle's value as it is; any other value is 400.

Why `before` instead of `offset` (as `GET /users` uses): a notification that arrives while Faisal reads page one would shift every later page by one with offsets, so he would see one twice; a position relative to a notification he has seen does not move.
Why `read-all` takes `upTo`: Faisal opens his list at 10:00:00 and presses "mark all read" at 10:00:05; the R2 that arrived at 10:00:03 must stay unread, since he never saw it.
`upTo` marks the caller's unread notifications at or before that notification, in the list order.
A `before` or `upTo` that is not the caller's own notification is `unknown_notification` (400), the same answer for another user's ID and a made-up one.

`GET /requests/:id` (Phase 6) gains `escalations: [{rule, dueAt, firedAt}]`, ordered by `fired_at`.
