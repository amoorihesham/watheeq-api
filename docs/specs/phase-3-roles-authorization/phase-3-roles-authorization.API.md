# Phase 3 API: Roles & Authorization

The endpoints of [phase-3-roles-authorization.md](phase-3-roles-authorization.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.
This is the implemented form: an index of the endpoints.
Request and response shapes, statuses, and the errors of each endpoint are in `docs/api/openapi.json`.

Tenant routes run `authenticate()`, `requireRole('user')`, the subscription guard (T16), and `requireTenantPermission(...)`, as in Phase 2.
In Read-only, every write below is refused by the guard.

| Method | Path                  | Who           | Purpose                                                                          | Spec refs               |
| ------ | --------------------- | ------------- | -------------------------------------------------------------------------------- | ----------------------- |
| GET    | `/permissions`        | `role.view`   | The permission catalog and the scopes each permission allows                     | R3.1                    |
| GET    | `/roles`              | `role.view`   | List the tenant's roles by name                                                  | R3.2                    |
| GET    | `/roles/:roleId`      | `role.view`   | One role with its permissions                                                    | R3.2                    |
| POST   | `/roles`              | `role.manage` | Create a role with permissions the caller holds (subset rule)                    | R3.4, R3.5, R3.8        |
| PATCH  | `/roles/:roleId`      | `role.manage` | Rename a role or replace its permissions; the Tenant Admin role is protected     | R3.2, R3.6, R3.8        |
| DELETE | `/roles/:roleId`      | `role.manage` | Delete a role nobody holds                                                       | R3.7, R3.8              |
| PUT    | `/users/:userId/role` | `role.assign` | Give a user another role within the caller's permissions; never one's own role   | R3.9, R3.10, R3.11      |

Behavior of the Phase 2 endpoints changes as follows.

- Every user carries `role: {id, name, isSystem}`.
- `GET /users` gains the filter `roleId`, and its rows, like `GET /users/:userId`, are limited to the caller's `user.view` scope; a user outside it is 404 (R3.15).
- `POST /users` takes `roleId` instead of `role`, and the role must be within the caller's permissions (R3.10).
- `PATCH /users/:userId` no longer accepts a role.
- `POST /users/:userId/deactivate` and `/reactivate` need the user's role to be within the caller's permissions (R3.10).
- For the Tenant Admin role, `permissions` is the computed full catalog, so a client renders it like any other role, and `isSystem` lets it show a localized label and hide edit and delete (R3.2).
- `tenant.roleId` in the auth responses and the access token is never null; `permissions` holds the role's permission keys (R3.13).

The token's `tenant` claim keeps the shape Phase 0 fixed (P0.18), `{id, roleId, roleName, permissions}`, with `permissions` a list of keys without scopes.
Scopes are read from the database when rows are filtered (R3.14), so the token answers "may you call this endpoint" and the database answers "which rows".

## Rules a schema does not state

- A role `permissions` list has at most one entry per key (`duplicate_permission`), each key in the catalog (`unknown_permission`), and each scope allowed for its key (`scope_not_allowed`).
- A `roleId` in a body that names another tenant's role is 400 `unknown_role`; in a path it is 404.
- `PERMISSION_NOT_HELD` carries each detail at the body entry that asked for the permission, for example `permissions.3` or `roleId`; a refusal that no input caused (the route's own permission, a role being replaced or deleted, deactivating a user whose role is above the actor's) has no details (R3.8, R3.10).
- `OWNER_PROTECTED` and `SELF_CHANGE_FORBIDDEN` keep their Phase 2 meaning, now applied to `PUT /users/:userId/role` (R3.3, R3.11).
