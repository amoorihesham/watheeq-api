# Phase 2 API: Org Structure & Users

The endpoints of [phase-2-org-structure-users.md](phase-2-org-structure-users.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

Tenant routes run `authenticate()`, `requireRole('user')`, the subscription guard (T16), and `requireTenantPermission(...)`.
In Read-only, every write below is refused by the guard; in Grace, everything is allowed (only request submission is blocked, MVP 3.1).

| Method | Path                               | Permission        | Request                                                                                                                                                                                                                               | Responses                                                                                                                                                           |
| ------ | ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/org-units`                       | `org.view`        | none                                                                                                                                                                                                                                  | 200 the tree `{organization:{memberCount}, departments:[{id, name, managers:[{id, userName}], memberCount, sections:[{id, name, managers, memberCount}]}]}`, ordered by name |
| POST   | `/org-units`                       | `org.manage`      | `{name, parentId?}`: no parent creates a department, a department parent creates a section                                                                                                                                            | 201 the unit; 400 (parent is a section, or not in this tenant); 409 `TAKEN` at `name`                                                                               |
| PATCH  | `/org-units/:unitId`               | `org.manage`      | any of `{name, parentId}`; `parentId` only for sections                                                                                                                                                                               | 200 the unit; 400; 404; 409 `TAKEN` at `name`                                                                                                                       |
| DELETE | `/org-units/:unitId`               | `org.manage`      | none                                                                                                                                                                                                                                  | 204; 404; 409 `UNIT_NOT_EMPTY`                                                                                                                                      |
| GET    | `/users`                           | `user.view`       | `unitId` (an ID, `none`, `all`; `all`), `managers` (`true`, `false`, `all`; `all`), `roleId` (an ID, `all`; `all`), `status` (`invited`, `active`, `inactive`, `all`; `active`), `q` (name or email contains), `cursor`, `limit`      | 200 a page of users, ordered by name (T20); 400 `invalid_value` at a filter, `invalid_cursor` at `cursor`                                                           |
| GET    | `/users/:userId`                   | `user.view`       | none                                                                                                                                                                                                                                  | 200 the user; 404                                                                                                                                                   |
| POST   | `/users`                           | `user.create`     | `{email, userName, unitId?, isManager?, role}`                                                                                                                                                                                        | 201 the user; 400; 409 `TAKEN` at `email`, `USER_LIMIT_REACHED`                                                                                                     |
| PATCH  | `/users/:userId`                   | `user.update`     | any of `{userName, unitId, isManager, role}`                                                                                                                                                                                          | 200 the user; 400; 403 `SELF_CHANGE_FORBIDDEN`; 404; 409 `OWNER_PROTECTED`                                                                                          |
| POST   | `/users/:userId/deactivate`        | `user.deactivate` | none                                                                                                                                                                                                                                  | 200 the user; 403 `SELF_CHANGE_FORBIDDEN`; 404; 409 `OWNER_PROTECTED`                                                                                               |
| POST   | `/users/:userId/reactivate`        | `user.deactivate` | none                                                                                                                                                                                                                                  | 200 the user; 404; 409 `USER_LIMIT_REACHED`                                                                                                                         |
| POST   | `/users/:userId/resend-invitation` | `user.create`     | none                                                                                                                                                                                                                                  | 204; 404; 409 `ALREADY_VERIFIED`, `USER_INACTIVE`; 500 if the email fails (as Phase 1 resend)                                                                                        |
| POST   | `/auth/password`                   | signed in         | `{currentPassword, newPassword}`                                                                                                                                                                                                      | 204; 400; 401 `INVALID_CREDENTIALS` (wrong current password)                                                                                                        |
| POST   | `/auth/password-reset/request`     | none              | `{email}`                                                                                                                                                                                                                             | 204 always                                                                                                                                                          |
| POST   | `/auth/password-reset`             | none              | `{token, password}`                                                                                                                                                                                                                   | 204; 400 `VALIDATION_FAILED`; 400 `VERIFICATION_INVALID`                                                                                                            |

A user in a response is `{id, email, userName, unit:{id, name, kind} | null, isManager, role, isOwner, status, createdAt}`, where `status` is `invited` (never set a password), `active`, or `inactive`.
`isOwner` lets the client hide the deactivate and demote actions for Sara.
`isManager: true` with no unit (in the request or the result) is 400 with detail `manager_needs_unit`.

`/auth/password` is a signed-in route: it runs `authenticate()` and, like every `/auth/*` route, is not behind the subscription guard, so a Read-only tenant's users can still change their password.
Operators can use `/auth/password` and the reset endpoints too; they live in the same `users` table (T4).

## Permissions (interim until Phase 3)

| Permission        | Allows                              | Held until Phase 3 by |
| ----------------- | ----------------------------------- | --------------------- |
| `org.view`        | `GET /org-units`                    | `admin`, `member`     |
| `org.manage`      | Unit changes                        | `admin`               |
| `user.view`       | `GET /users`, `GET /users/:userId`  | `admin`, `member`     |
| `user.create`     | Invite, resend invitation           | `admin`               |
| `user.update`     | Edit name, unit, manager flag, role | `admin`               |
| `user.deactivate` | Deactivate, reactivate              | `admin`               |

`requireTenantPermission(permission)` reads the token's `tenant.permissions`.
Until Phase 3, the token's `roleId` is null (P0.18), and the middleware falls back to the table above by `tenant.roleName`; a token with a `roleId` uses its `permissions` only, even when empty.
Phase 3 removes the fallback and changes no route.
`subscription.view` (Phase 1) joins the same middleware, held by `admin` only, so `GET /subscription` stops being open to members (Phase 1, 4.2).

Being a manager grants nothing in Phase 2: a manager is a `member` or `admin` like anyone else.
Phase 3 gives managers their reach through scopes (a department manager sees their department's requests), and Phase 7 notifies them along the escalation chain.

## Validation

- Unit `name`: trimmed, 1-100 characters.
- `parentId`, `unitId`, `userId`: UUIDs of this tenant; a well-formed ID of another tenant is 404 for path IDs and 400 with detail `unknown_unit` for body IDs.
- `email`, `userName`: as Phase 1 (`emailSchema`, `userNameSchema`).
- `role`: `admin` or `member`. `isManager`: boolean.
- Passwords: 12-256 characters (Phase 1, P1.15). `currentPassword`: 1-256.

## New error codes

| HTTP | Code                    | When                                                             |
| ---- | ----------------------- | ---------------------------------------------------------------- |
| 403  | `SELF_CHANGE_FORBIDDEN` | A user changes their own role or deactivates themselves (R2.13). |
| 409  | `TAKEN`                 | Sibling with the same name (R2.3), with the detail at `name`.    |
| 409  | `UNIT_NOT_EMPTY`        | Delete of a unit with sections or members (R2.5).                |
| 409  | `OWNER_PROTECTED`       | Deactivation or demotion of the owner (R2.13).                   |
| 409  | `USER_INACTIVE` | Invitation resent to a deactivated user; reactivate them first. |
