# Phase 3 API: Roles & Authorization

The endpoints of [phase-3-roles-authorization.md](phase-3-roles-authorization.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

Tenant routes run `authenticate()`, `requireRole('user')`, the subscription guard (T16), and `requireTenantPermission(...)`, as in Phase 2.
In Read-only, every write below is refused by the guard.

| Method | Path                  | Permission    | Request                                                            | Responses                                                                                                        |
| ------ | --------------------- | ------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `/permissions`        | `role.view`   | none                                                               | 200 `{permissions:[{key, scopes}]}` in catalog order                                                             |
| GET    | `/roles`              | `role.view`   | none                                                               | 200 `{roles:[role]}` ordered by name (T20)                                                                       |
| GET    | `/roles/:roleId`      | `role.view`   | none                                                               | 200 `{role}`; 404                                                                                                |
| POST   | `/roles`              | `role.manage` | `{name, permissions:[{key, scope}]}`                               | 201 `{role}`; 400; 403 `PERMISSION_NOT_HELD`; 409 `ROLE_NAME_TAKEN`                                              |
| PATCH  | `/roles/:roleId`      | `role.manage` | any of `{name, permissions}`; `permissions` replaces the whole set | 200 `{role}`; 400; 403 `PERMISSION_NOT_HELD`; 404; 409 `ROLE_NAME_TAKEN`, `ROLE_PROTECTED`                       |
| DELETE | `/roles/:roleId`      | `role.manage` | none                                                               | 204; 403 `PERMISSION_NOT_HELD`; 404; 409 `ROLE_IN_USE`, `ROLE_PROTECTED`                                         |
| PUT    | `/users/:userId/role` | `role.assign` | `{roleId}`                                                         | 200 `{user}`; 400 `unknown_role`; 403 `SELF_CHANGE_FORBIDDEN`, `PERMISSION_NOT_HELD`; 404; 409 `OWNER_PROTECTED` |

A role in a response is `{id, name, isSystem, permissions:[{key, scope}], memberCount, createdAt, updatedAt}`.
For the Tenant Admin role, `permissions` is the computed full catalog, so clients render it like any other role, and `isSystem` lets them show a localized label and hide edit and delete.

Changes to Phase 2 endpoints:

| Endpoint                                        | Change                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| User in every response                          | `role` becomes `{id, name, isSystem}`.                                                                        |
| `GET /users`                                    | New filter `roleId?`. Rows limited to the caller's `user.view` scope (R3.15).                                 |
| `GET /users/:userId`                            | 404 for a user outside the caller's `user.view` scope.                                                        |
| `POST /users`                                   | `role` becomes `roleId`; the role must be within the caller's permissions (403 `PERMISSION_NOT_HELD`).        |
| `PATCH /users/:userId`                          | No longer accepts a role; a role change is `PUT /users/:userId/role`.                                         |
| `POST /users/:userId/deactivate`, `/reactivate` | The user's role must be within the caller's permissions (Q4).                                                 |
| Auth responses and the access token             | `tenant.roleId` is never null; `roleName` is the role's name; `permissions` holds the role's permission keys. |

The token's `tenant` claim keeps the shape Phase 0 fixed (P0.18), `{id, roleId, roleName, permissions}`, with `permissions` a list of keys without scopes.
Scopes are read from the database when rows are filtered (4.3), so the token answers "may you call this endpoint" and the database answers "which rows".

## Validation

- Role `name`: trimmed, 1-100 characters.
- `permissions`: at most one entry per key (`duplicate_permission`); each key in the catalog (`unknown_permission`); each scope allowed for its key (`scope_not_allowed`). Up to 100 entries.
- `roleId`: a role of this tenant; another tenant's role in a body is 400 `unknown_role`, in a path 404.

## New error codes

| HTTP | Code                  | When                                                                                                                              |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 403  | `PERMISSION_NOT_HELD` | A subset rule fails (R3.8, R3.10). `details` has one item per permission the actor lacks, or holds only at a narrower scope: `{path: <permission key>, code: "permission_not_held", scope: <the scope needed>}`, for example `[{path: "user.create", code: "permission_not_held", scope: "organization"}]`, so the client can explain. `scope` is an optional field of the error detail, present only here. |
| 409  | `ROLE_NAME_TAKEN`     | Another role of this tenant has the name (R3.5).                                                                                  |
| 409  | `ROLE_IN_USE`         | Delete of a role someone holds (R3.7).                                                                                            |
| 409  | `ROLE_PROTECTED`      | Edit or delete of the Tenant Admin role (R3.2).                                                                                   |

`OWNER_PROTECTED` and `SELF_CHANGE_FORBIDDEN` keep their Phase 2 meaning, now applied to `PUT /users/:userId/role`.
