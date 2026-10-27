# Phase 2 API: Org Structure & Users

The endpoints of [phase-2-org-structure-users.md](phase-2-org-structure-users.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.
This is the implemented form: an index of the endpoints.
Request and response shapes, statuses, and the errors of each endpoint are in `docs/api/openapi.json`.

Tenant routes run `authenticate()`, `requireRole('user')`, the subscription guard (T16), and `requireTenantPermission(...)`.
In Read-only, every write below is refused by the guard; in Grace, everything is allowed (only request submission is blocked, MVP 3.1).

| Method | Path                               | Who               | Purpose                                                                                | Spec refs               |
| ------ | ---------------------------------- | ----------------- | -------------------------------------------------------------------------------------- | ----------------------- |
| GET    | `/org-units`                       | `org.view`        | The organization tree: departments, their sections, managers, and member counts         | R2.15                   |
| POST   | `/org-units`                       | `org.manage`      | Create a department, or a section when a department parent is given                    | R2.1, R2.2, R2.3, R2.18 |
| PATCH  | `/org-units/:unitId`               | `org.manage`      | Rename a unit, or move a section to another department                                 | R2.3, R2.4              |
| DELETE | `/org-units/:unitId`               | `org.manage`      | Delete a unit with no sections and no members                                          | R2.5                    |
| GET    | `/users`                           | `user.view`       | The user directory, filtered by unit, manager flag, role, status, or name or email      | R2.15, R3.15            |
| GET    | `/users/:userId`                   | `user.view`       | One user                                                                               | R2.15, R3.15            |
| POST   | `/users`                           | `user.create`     | Invite a user by email; they set their own password; takes a seat                      | R2.8, R2.9, R2.10       |
| PATCH  | `/users/:userId`                   | `user.update`     | Edit a user's name, unit, or manager flag (a role change is `PUT /users/:userId/role`) | R2.6, R2.7, R2.11       |
| POST   | `/users/:userId/deactivate`        | `user.deactivate` | Deactivate a user: frees the seat and ends their manager role and sessions             | R2.12, R2.13            |
| POST   | `/users/:userId/reactivate`        | `user.deactivate` | Reactivate a user; takes a seat                                                        | R2.12, R2.9             |
| POST   | `/users/:userId/resend-invitation` | `user.create`     | Resend the invitation to a user who has not set a password; older links stop working   | R2.14                   |
| POST   | `/auth/password`                   | signed in         | Change the caller's own password with the current one; other sessions are signed out   | R2.16                   |
| POST   | `/auth/password-reset/request`     | public            | Request a reset link by email; the answer never reveals whether the email exists       | R2.17                   |
| POST   | `/auth/password-reset`             | public            | Set a new password with a reset link's token                                           | R2.17                   |

`isOwner` in a user lets the client hide the deactivate and demote actions for the owner (R2.13).
`isManager: true` with no unit, in the request or the result, is 400 with the detail `manager_needs_unit` (R2.7).
A well-formed unit or user ID of another tenant is 404 in a path and 400 with the detail `unknown_unit` in a body.

`/auth/password` is a signed-in route: it runs `authenticate()` and, like every `/auth/*` route, is not behind the subscription guard, so a Read-only tenant's users can still change their password.
Operators can use `/auth/password` and the reset endpoints too; they live in the same `users` table (T4).

Being a manager grants nothing by itself: a manager is a user like anyone else.
Phase 3 gives managers their reach through scopes (a department manager sees their department's requests), and Phase 7 notifies them along the escalation chain.
The interim permission table Phase 2 used before Phase 3 is gone; the role's permissions in the token decide (Phase 3, R3.13).
