# Phase 3 Spec: Roles & Authorization

| Field                  | Value                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Status**             | Implemented                                                                                                                                                              |
| **Approved by / date** | \_Amr - 22/10/2026 - 15:42 pm                                                                                                                                      |
| **Depends on**         | Phase 0 (`phase-0-foundations.md`), Phase 0.5 (`phase-0.5-refactor.md`), Phase 1 (`phase-1-platform-subscriptions.md`), Phase 2 (`phase-2-org-structure-users.md`) |
| **Related decisions**  | MVP 3.2, 3.3, 3.9, D1, D2, D19, D20; Technical T2, T5, T7, T8, T14, T17, T20, T22, T24; Phase 0 P0.9, P0.10, P0.13, P0.18                                          |

---

## 1. Objective

Replace the interim `admin` / `member` membership role with roles that each tenant defines from a system permission catalog, assign one role to each user, and enforce the anti-privilege-escalation rules (D2).
Give permissions a scope (own, section, department, organization) resolved from the user's place in the structure, so "what" comes from the role and "where" comes from the structure (D1).
It is needed now because Phase 5 (legal configuration) and Phase 6 (requests) declare their permissions against this catalog, and Phase 6 lists requests by scope.

## 2. Scope

**In scope:**

- The tenant permission catalog: every permission a tenant route can require, with the scopes it allows.
- Roles: list, view, create, rename, change permissions, delete an unused role.
- A protected Tenant Admin role in every tenant, held by the owner, that always holds every permission (Q1).
- Assigning a role to a user, at invitation and afterwards.
- The subset rules (D2): a role can be created, edited, deleted, or assigned only within the actor's own permissions and scopes.
- The access token carries the user's real role and permissions; the interim fallback is removed.
- Scope resolution, applied to its first consumer, the user directory (`user.view`, Q3).

**Out of scope (and where it is handled instead):**

- Permissions for the working calendar, legal configuration, and requests: added to the catalog by Phases 4, 5, and 6, each with the routes that require them.
- Scoped write permissions (for example a department head editing only their department's users): later, if asked for. Every Phase 3 write permission is organization-wide.
- Delegation of permissions: out of the MVP (MVP 4).
- Immediate revocation: a role change or a role edit reaches the access token at its next refresh, within 30 minutes (P0.9). Row filtering by scope is always current (4.3).
- Notifying users that their role changed: Phase 7, if it joins the notification event list (MVP open question 8).

## 3. Requirements

Example tenant: **Al-Noor**, owner **Sara**, structure and people as in Phase 2:

```
Al-Noor (the tenant; not a unit)                no unit: Sara (owner), Lina (IT admin)
├── Legal Affairs (department)                  managers: Huda, Ahmed
│   ├── Contracts (section)                     managers: Faisal; member: Nora
│   └── Litigation (section)                    no manager
└── Finance (department)                        managers: Majed
    └── Procurement (section)                   managers: Reem; member: Khalid
```

Example roles Sara creates (the permissions are those of Phase 3; later phases add legal and request permissions):

| Role                       | Permissions                                                                       | Held by      |
| -------------------------- | --------------------------------------------------------------------------------- | ------------ |
| Tenant Admin (system role) | every permission, organization scope                                              | Sara, Majed  |
| Head of Legal              | `org.view`, `user.view` (organization), `role.view`, `role.manage`, `role.assign` | Huda, Ahmed  |
| Legal Staff                | `org.view`, `user.view` (department)                                              | Faisal, Nora |
| Employee                   | `org.view`, `user.view` (own)                                                     | Khalid, Reem |

| ID    | Requirement                                                                                                                                                                                                                                                                                                                                                                               | Example                                                                                                                                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3.1  | The system defines a fixed permission catalog. Each permission names an operation on a resource and lists the scopes it allows. Tenants cannot add permissions.                                                                                                                                                                                                                           | _`GET /permissions` returns `user.view` with scopes `own`, `section`, `department`, `organization`, and `org.manage` with `organization` only._                                                                                        |
| R3.2  | Every tenant has exactly one Tenant Admin role, created with the tenant. It always holds every permission in the catalog at organization scope, including permissions added by later phases. It cannot be edited or deleted.                                                                                                                                                              | _Phase 4 adds `calendar.manage`; Sara and Majed hold it the moment the new code runs, with no data change. `PATCH /roles/<Tenant Admin>` returns 409 `ROLE_PROTECTED`._                                                                |
| R3.3  | The owner always holds the Tenant Admin role.                                                                                                                                                                                                                                                                                                                                             | _Majed tries to give Sara the Employee role: 409 `OWNER_PROTECTED`._                                                                                                                                                                   |
| R3.4  | A user holding `role.manage` can create a role with a name and a set of permissions, each with one scope the permission allows. An empty role is allowed.                                                                                                                                                                                                                                 | _Sara creates Legal Staff with `org.view` and `user.view` at department scope._                                                                                                                                                        |
| R3.5  | Role names are unique within the tenant, ignoring case.                                                                                                                                                                                                                                                                                                                                   | _A second role named "legal staff" returns 409 `ROLE_NAME_TAKEN`. Al-Rashid may have its own "Legal Staff"._                                                                                                                           |
| R3.6  | A user holding `role.manage` can rename a role and replace its permissions. The change reaches every holder at their next token refresh, within 30 minutes.                                                                                                                                                                                                                               | _Sara narrows Legal Staff's `user.view` from department to section; Faisal's next refresh carries the new role._                                                                                                                       |
| R3.7  | A role can be deleted only when no user (active or not) holds it.                                                                                                                                                                                                                                                                                                                         | _Deleting Employee while Khalid holds it returns 409 `ROLE_IN_USE`._                                                                                                                                                                   |
| R3.8  | Subset rule for roles (D2): a role can be created only with permissions and scopes the actor holds, and edited or deleted only when both its current and its new permissions are within the actor's. A scope is within another when it is the same or narrower: own < section < department < organization.                                                                                | _Huda creates Legal Staff with `user.view` at department scope (she holds organization). Huda adds `user.create` to it: 403 `PERMISSION_NOT_HELD`. Huda cannot rename the Tenant Admin role or edit a role holding `user.deactivate`._ |
| R3.9  | Each user holds exactly one role. An invitation names the role; a user holding `role.assign` can change a user's role afterwards.                                                                                                                                                                                                                                                         | _Sara invites Nora as Legal Staff. Huda later changes Nora's role to Head of Legal._                                                                                                                                                   |
| R3.10 | Subset rule for users (D2): a role can be given to a user, by invitation or assignment, only when the role is within the actor's permissions; changing, deactivating, or reactivating a user also requires the user's current role to be within the actor's (Q4).                                                                                                                         | _Huda gives Faisal the Employee role: allowed. Huda gives Faisal the Tenant Admin role: 403. Huda changes Majed (Tenant Admin) to Legal Staff: 403, because Majed's current role exceeds hers._                                        |
| R3.11 | No user can change their own role (D2).                                                                                                                                                                                                                                                                                                                                                   | _Huda sets her own role to Legal Staff: 403 `SELF_CHANGE_FORBIDDEN`._                                                                                                                                                                  |
| R3.12 | Subset checks use the actor's role as it is in the database at that moment, not the role in their access token.                                                                                                                                                                                                                                                                           | _Sara removes `role.manage` from Head of Legal at 10:00. At 10:05 Huda's token still carries it; her `POST /roles` is refused with 403 `PERMISSION_NOT_HELD`._                                                                         |
| R3.13 | The access token carries the user's role ID, role name, and permission keys; tenant routes are allowed or refused by those permissions only.                                                                                                                                                                                                                                              | _Khalid's token carries `{roleId: <Employee>, roleName: "Employee", permissions: ["org.view", "user.view"]}`; his `POST /org-units` returns 403 `FORBIDDEN`._                                                                          |
| R3.14 | A scope is resolved from the user's current place in the structure: **own** is the user themselves; **section** is the user's own unit (a section, or a department for a member placed directly in it); **department** is the user's department and all its sections; **organization** is the whole tenant. A user with no unit reaches only themselves with section or department scope. | _Nora (Contracts) with department scope reaches Legal Affairs, Contracts, and Litigation. Lina (no unit) with department scope reaches only herself._                                                                                  |
| R3.15 | The user directory (`GET /users`, `GET /users/:userId`) shows only users within the caller's `user.view` scope; the caller always sees themselves. A user outside the scope is 404.                                                                                                                                                                                                       | _Khalid (own) lists one user, himself. Faisal (department) lists Huda, Ahmed, Faisal, Nora, and Litigation's members. Faisal opens Khalid: 404 `NOT_FOUND`._                                                                           |
| R3.16 | Scope follows the structure immediately: moving a user changes what they reach on their next request, without waiting for a token refresh.                                                                                                                                                                                                                                                | _Sara moves Nora from Contracts to Procurement; Nora's next `GET /users` lists Finance's people, not Legal Affairs'._                                                                                                                  |
| R3.17 | Every role change and every role assignment is audited in the same transaction, with before and after values.                                                                                                                                                                                                                                                                             | _Huda changes Nora's role: `user.role_assigned` records `{before:{roleId, roleName: "Legal Staff"}, after:{roleId, roleName: "Head of Legal"}}`._                                                                                      |
| R3.18 | Role endpoints only ever read or change the caller's tenant data.                                                                                                                                                                                                                                                                                                                         | _Sara sends Al-Rashid's role ID to `PATCH /roles/:roleId`: 404; in an invitation body: 400 `unknown_role`._                                                                                                                            |

## 4. Design

### 4.1 Data model

#### The catalog lives in code; roles and their grants live in the database

The catalog is part of the product: each permission exists because a route requires it, and both ship in the same release.
Keeping it in code (as Phase 2's `TENANT_PERMISSIONS` already is) means a new permission needs no data migration, and a route can never require a permission the catalog lacks, because TypeScript checks the key.
Roles are tenant data, so they live in tables.

```ts
// tenant-access.config.ts
export const PERMISSION_SCOPES = [
  "own",
  "section",
  "department",
  "organization",
] as const;

export const TENANT_PERMISSIONS = {
  "org.view": ["organization"],
  "org.manage": ["organization"],
  "user.view": ["own", "section", "department", "organization"],
  "user.create": ["organization"],
  "user.update": ["organization"],
  "user.deactivate": ["organization"],
  "subscription.view": ["organization"],
  "role.view": ["organization"],
  "role.manage": ["organization"],
  "role.assign": ["organization"],
} as const;
```

Phase 3 adds `role.view` (list and view roles and the catalog), `role.manage` (create, edit, delete), and `role.assign` (change a user's role).
`role.manage` covers create, edit, and delete together, like `org.manage` for units; MVP 3.3's `role.create` example becomes `role.manage` when the phase is promoted.
`role.assign` is separate from `user.update` so that Huda, as Head of Legal, can give Nora a legal role without also being able to rename or move Finance's people (Q5).

**`roles`** (new, tenant data):

| Column                     | Type          | Notes                                                                                                |
| -------------------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                       | `uuid` PK     |                                                                                                      |
| `tenant_id`                | `uuid`        | FK to `tenants`, not null.                                                                           |
| `name`                     | `text`        | Trimmed, 1-100 characters (check).                                                                   |
| `is_system`                | `boolean`     | Not null, default `false`. `true` only for the Tenant Admin role, which holds every permission (Q1). |
| `created_at`, `updated_at` | `timestamptz` |                                                                                                      |

Indexes and constraints:

- Unique `(tenant_id, id)`: the target of the composite foreign keys (T21).
- `roles_name_unique` on `(tenant_id, lower(name))`: 409 `ROLE_NAME_TAKEN` (R3.5).
- `roles_system_unique` on `(tenant_id)` where `is_system`: at most one Tenant Admin role per tenant (R3.2).

**`role_permissions`** (new, tenant data): one row per permission a role grants.

| Column       | Type                     | Notes                                                                                                    |
| ------------ | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `tenant_id`  | `uuid`                   | Not null.                                                                                                |
| `role_id`    | `uuid`                   | Composite FK `(tenant_id, role_id)` → `roles (tenant_id, id)`, `on delete cascade`.                      |
| `permission` | `text`                   | A catalog key, checked by the service. Check `permission ~ '^[a-z_]+\.[a-z_]+$'` as a second safeguard.  |
| `scope`      | `permission_scopes` enum | `own`, `section`, `department`, `organization`; one of the scopes the permission allows (service check). |

Primary key `(role_id, permission)`: a role grants a permission at most once, with one scope.

Why a table instead of a `permissions jsonb` column on `roles`: Phase 7's R0 rule notifies "users who may review requests across the organization", which is a query by permission and scope (`where permission = 'request.review' and scope = 'organization'`).
A table answers it with a plain join; a JSON column needs JSON operators and cannot use a normal index.

The Tenant Admin role has no `role_permissions` rows.
Its permissions are computed: the whole catalog, each at its widest scope.
That is what makes R3.2 hold when Phase 4 adds `calendar.manage`: no migration has to remember to grant it.
A query by permission (Phase 7) includes system roles with `or r.is_system`.

A `role_permissions` row whose key is no longer in the catalog (a permission removed in a future release) is ignored when permissions are read, and dropped the next time the role is saved.

**`tenant_members`** (changed):

- `role` and the `tenant_member_roles` enum are dropped (P0.13).
- `role_id uuid`, not null; composite FK `tenant_members_role_fk` `(tenant_id, role_id)` → `roles (tenant_id, id)`, so a member can only hold a role of their own tenant.
- Index on `(tenant_id, role_id)` for member counts and the in-use check.

#### Migration

There is no production data (P0.13).
A new not-null `role_id` cannot be added to existing `tenant_members` rows without inventing roles for them, so migration `0005` is generated by Drizzle Kit as usual and a local database migrated earlier must be recreated (`docker compose down -v`), as after the Phase 0 refactor.

#### Database errors

| Constraint                                                             | SQLSTATE | Code                                                                     |
| ---------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `roles_name_unique`                                                    | 23505    | 409 `ROLE_NAME_TAKEN`                                                    |
| `tenant_members_role_fk` (a member given a role that was just deleted) | 23503    | 400 `VALIDATION_FAILED`, detail `{path: "roleId", code: "unknown_role"}` |

As in T22, only the side that writes into a role is mapped; a role delete locks the role before checking that nobody holds it (4.3).

#### Audit actions

| Action               | Resource | `details`                                                          |
| -------------------- | -------- | ------------------------------------------------------------------ |
| `role.created`       | role     | `{name, isSystem, permissions}`                                    |
| `role.updated`       | role     | `{before, after}` of the changed fields among name and permissions |
| `role.deleted`       | role     | `{name, permissions}`                                              |
| `user.role_assigned` | user     | `{before:{roleId, roleName}, after:{roleId, roleName}}`            |
| `user.invited`       | user     | Phase 2's details with `roleId` and `roleName` instead of `role`   |

Tenant creation (Phase 1) writes `role.created` for the Tenant Admin role, and its `user.created` entry records the role ID instead of `tenantRole: "admin"`.

### 4.2 API

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

#### Validation

- Role `name`: trimmed, 1-100 characters.
- `permissions`: at most one entry per key (`duplicate_permission`); each key in the catalog (`unknown_permission`); each scope allowed for its key (`scope_not_allowed`). Up to 100 entries.
- `roleId`: a role of this tenant; another tenant's role in a body is 400 `unknown_role`, in a path 404.

#### New error codes

| HTTP | Code                  | When                                                                                                                              |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 403  | `PERMISSION_NOT_HELD` | A subset rule fails (R3.8, R3.10). `details` has one item per permission the actor lacks, or holds only at a narrower scope: `{path: <permission key>, code: "permission_not_held", scope: <the scope needed>}`, for example `[{path: "user.create", code: "permission_not_held", scope: "organization"}]`, so the client can explain. `scope` is an optional field of the error detail, present only here. |
| 409  | `ROLE_NAME_TAKEN`     | Another role of this tenant has the name (R3.5).                                                                                  |
| 409  | `ROLE_IN_USE`         | Delete of a role someone holds (R3.7).                                                                                            |
| 409  | `ROLE_PROTECTED`      | Edit or delete of the Tenant Admin role (R3.2).                                                                                   |

`OWNER_PROTECTED` and `SELF_CHANGE_FORBIDDEN` keep their Phase 2 meaning, now applied to `PUT /users/:userId/role`.

### 4.3 Key flows

#### The subset rule

One function decides every D2 check:

```ts
// Returns the grants in `wanted` that `held` does not cover; empty means allowed.
missingGrants(held: GrantMap, wanted: Grant[]): Grant[]
// covered when held[key] exists and rank(wanted.scope) <= rank(held[key]),
// with rank: own 0, section 1, department 2, organization 3
```

`held` is the actor's current role, read from the database in the same transaction (R3.12).
A system role holds every key at its widest scope.

Where it applies:

| Action                        | Must be within the actor's grants                      |
| ----------------------------- | ------------------------------------------------------ |
| Create a role                 | the new permissions                                    |
| Edit a role                   | the role's current permissions and its new permissions |
| Delete a role                 | the role's permissions                                 |
| Invite a user                 | the given role                                         |
| Assign a role                 | the user's current role and the new role               |
| Deactivate, reactivate a user | the user's role (Q4)                                   |

Why the current role counts too: without it, Huda (Head of Legal) could empty the permissions of a "Finance Admin" role that holds `user.deactivate`, or put Majed on Legal Staff, taking away powers she does not hold herself.
Both are within her `role.manage` and `role.assign`, and neither gives her anything new, so a rule that checks only the new side would allow them.
Requiring both sides keeps everyone acting only on what is within their own power.

The service also re-checks, against the same database read, that the actor still holds the route's own permission (`role.manage`, `role.assign`, `user.create`, `user.deactivate`).
This closes the 30-minute token gap (P0.9) for the writes that hand out power, at the cost of one query that the subset check needs anyway.

Concurrency: the actor's role is read without a lock.
Example: Sara removes `user.view` from Head of Legal while Huda creates a role with `user.view`.
If Huda's read happens before Sara commits, her role is created; that is the same result as Huda acting just before Sara, which is a legitimate order, so no lock is needed.

#### Log in and refresh

Login and refresh already read the account with its membership.
They now also read the role (`id`, `name`, `is_system`) and its permission keys, and build `tenant: {id, roleId, roleName, permissions}`.
For a system role, `permissions` is every catalog key.
`tenantPermissionsOf` reads `tenant.permissions` only; the interim table and the null-`roleId` branch are removed, and `tenantClaimSchema` requires a `roleId`.
An access token issued before Phase 3 (with a null `roleId`) fails validation, so its holder gets 401 and refreshes.

#### Create a tenant (changed)

In Phase 1's transaction, after the tenant row: insert the Tenant Admin role (`is_system = true`, name `Tenant Admin`), then the owner's membership with that role; audit `role.created`.
No other role is created (Q2).

#### Edit a role

In one transaction:

1. Load and lock the role (`FOR UPDATE`; 404). A system role is 409 `ROLE_PROTECTED`.
2. Validate the new permissions against the catalog.
3. Load the actor's grants; current and new permissions must be within them (403).
4. Update the name and `updated_at`; when `permissions` is given, delete the role's rows and insert the new set.
5. Audit `role.updated` with only the fields that changed. An edit that changes nothing returns 200 with no audit entry.

Why the lock: Huda empties Clerk's permissions while Sara is adding `user.deactivate` to it.
Without a lock, Huda's transaction reads Clerk before Sara commits, so her subset check and her audit entry use Clerk as it was: she passes the check and strips `user.deactivate`, a power she does not hold (R3.8).
With the lock, Huda's transaction waits for Sara's commit, then reads Clerk with `user.deactivate` and is refused with 403. The lock also serializes the grant replacement itself, so two edits never leave a mix of both sets.

#### Delete a role

In one transaction: load and lock the role (`FOR UPDATE`; 404); system role → 409 `ROLE_PROTECTED`; subset check on its permissions; any member holding it (active or not) → 409 `ROLE_IN_USE`; delete (its permission rows cascade); audit.

The lock works as Phase 2's unit delete (T22): if Sara deletes Employee while Majed invites Khalid as Employee, either Majed's insert commits first and Sara gets 409 `ROLE_IN_USE`, or Sara's delete commits first and Majed's foreign-key check fails with 400 `unknown_role`.

#### Assign a role

In one transaction:

1. Load the target membership with its role (404 if not in this tenant, or not within the caller's `user.view` scope).
2. The caller themselves → 403 `SELF_CHANGE_FORBIDDEN` (R3.11). The owner, to any role other than Tenant Admin → 409 `OWNER_PROTECTED` (R3.3).
3. Load the new role (400 `unknown_role`).
4. Subset check on the current and the new role (403 `PERMISSION_NOT_HELD`).
5. Update `role_id`; audit `user.role_assigned`. The same role again returns 200 with no audit entry.

Deactivating or reactivating a user may also be done while their role changes; both write the same `tenant_members` row, so PostgreSQL applies them one after the other.

#### Resolve a scope

Scope resolution turns "Faisal holds `user.view` at department scope" into "the units whose rows Faisal may see".
It runs inside the SQL of the query that needs it, so it always uses the caller's current unit and current role, whatever their token says (R3.16).

```sql
-- the caller's scope for one permission, and their place in the structure
with me as (
  select m.user_id, m.unit_id, u.kind, coalesce(u.parent_id, u.id) as department_id,
         case when r.is_system then 'organization' else rp.scope end as scope
  from tenant_members m
  join roles r on r.tenant_id = m.tenant_id and r.id = m.role_id
  left join role_permissions rp on rp.role_id = r.id and rp.permission = $permission
  left join org_units u on u.tenant_id = m.tenant_id and u.id = m.unit_id
  where m.tenant_id = $tenantId and m.user_id = $callerId
)
```

A row (here, a member) is visible when:

| Scope           | Condition on the target member                                                 |
| --------------- | ------------------------------------------------------------------------------ |
| `organization`  | always                                                                         |
| `department`    | its unit is `me.department_id` or a section whose parent is `me.department_id` |
| `section`       | its unit is `me.unit_id`                                                       |
| `own`           | it is the caller                                                               |
| none (no grant) | never                                                                          |

The caller always sees themselves (R3.15), and with a null `unit_id` the department and section conditions match nothing but the caller (R3.14).
A unit-less member is visible only at organization scope.

The resolver lives in `tenant-access` as a function that returns a Drizzle SQL condition for a given permission, so Phase 6 reuses it for requests by applying it to the request's unit instead of the member's.

### 4.4 Module structure

```
src/
  db/schema/roles.ts                        new: roles, role_permissions, permission_scopes enum
  db/schema/tenant-members.ts               (changed) role_id replaces role; enum dropped
  http/errors.ts                            (changed) new codes; role constraint map
  modules/
    tenant-access/                          (changed) catalog with scopes, missingGrants, actor grants loader,
                                            scope resolver; interim fallback removed
    roles/                                  new
      roles.routes.ts (composes), .controller.ts, .service.ts, .repository.ts
      roles.config.ts, .schemas.ts, .types.ts
    users/                                  (changed) roleId, PUT /users/:userId/role, subset checks, scoped user.view
    auth/                                   (changed) login and refresh read the role and its permissions
    platform/tenants/                       (changed) creates the Tenant Admin role with the tenant
tests/                                      (changed) helpers create roles instead of admin/member memberships
```

`app.ts` gains `/permissions` and `/roles`.
`tenant-access` keeps everything other modules need to decide access (catalog, middleware, subset rule, scope resolver) and imports no feature module; `roles` owns the CRUD and imports `tenant-access`, as `users` does.

## 5. Edge Cases and Failure Behavior

| Scenario                                                                                           | Expected behavior                                                                                                                |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Sara and Majed edit Legal Staff's permissions at the same moment.                                  | The role lock serializes them; the role ends with exactly one set, and the audit shows both edits in order.                      |
| Sara deletes Employee while Majed invites Khalid as Employee.                                      | Either 409 `ROLE_IN_USE` for Sara or 400 `unknown_role` for Majed, depending on which commits first (role lock and foreign key). |
| Sara removes `role.manage` from Head of Legal; Huda, whose token still carries it, creates a role. | 403 `PERMISSION_NOT_HELD`: the service re-reads Huda's role (R3.12).                                                             |
| Sara narrows Legal Staff's `user.view` to own; Faisal lists users before his token refreshes.      | He sees only himself at once: the scope is read from the database. His token still lets him call the endpoint.                   |
| Sara removes `user.view` from Legal Staff entirely; Faisal's token still carries it.               | The call passes the gate and the resolver finds no grant: an empty list, and 404 for any other user.                             |
| Huda edits her own role, Head of Legal, removing `role.assign`.                                    | Allowed: it removes only what she holds. Her next refresh carries the smaller role.                                              |
| Huda edits her own role, adding `user.create`.                                                     | 403 `PERMISSION_NOT_HELD`.                                                                                                       |
| Huda tries to delete Head of Legal, which she holds.                                               | 409 `ROLE_IN_USE`.                                                                                                               |
| Majed (Tenant Admin) changes Sara's role.                                                          | 409 `OWNER_PROTECTED`.                                                                                                           |
| Majed changes his own role.                                                                        | 403 `SELF_CHANGE_FORBIDDEN`.                                                                                                     |
| Huda deactivates Majed.                                                                            | 403 `PERMISSION_NOT_HELD` (Majed's role exceeds hers; Q4); she lacks `user.deactivate` anyway, so the route refuses her first.   |
| Sara gives Lina (no unit) `user.view` at department scope.                                         | Lina sees only herself (R3.14).                                                                                                  |
| Sara moves Procurement from Finance to Legal Affairs.                                              | Reem's and Khalid's department scope now resolves to Legal Affairs on their next request; no role changes.                       |
| A role grants `user.view` twice, or `org.manage` at department scope.                              | 400 `duplicate_permission` or `scope_not_allowed`.                                                                               |
| Sara creates a role named "Tenant Admin".                                                          | 409 `ROLE_NAME_TAKEN`: the system role's name is taken like any other.                                                           |
| A user calls a tenant route with a pre-Phase-3 token (null `roleId`).                              | 401; the client refreshes and gets a new token.                                                                                  |
| Al-Noor is Read-only; Sara creates a role.                                                         | 403 `SUBSCRIPTION_READ_ONLY` (guard). Listing roles still works.                                                                 |
| Sara sends Al-Rashid's role ID in a path or a body.                                                | 404 in a path; 400 `unknown_role` in a body.                                                                                     |

## 6. Security and Authorization

- **Trust boundaries:** role bodies validated with zod against the catalog; names and permission keys also have database checks.
- **Tenant isolation:** application-level (T2); every repository function takes the tenant ID from the token. Composite foreign keys guarantee that a member holds a role of their own tenant and a grant belongs to a role of its tenant.
- **Privilege escalation (D2):** one `missingGrants` function decides every subset check, against the actor's role read from the database in the same transaction. No self role change. The owner always holds the Tenant Admin role, and that role cannot be edited or deleted, so a tenant can never lose its last full administrator.
- **Accepted gap:** a role change or role edit reaches the access token within 30 minutes (P0.9). During that window the gate may still let a user call an endpoint; row filtering by scope and every power-granting write use the current database state.
- **Audit:** every role write and role assignment is audited in the same transaction (T8, MVP 3.9).

## 7. Implementation Steps

| Step                                      | Objective                                                              | Delivers                                                                                                                                                                                                                                                                                                   | Acceptance criteria                                                                                                                                                                                                                                                                                                                                      | Verification                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 Roles in the data model and the token | Every member holds a real role, and the token carries its permissions. | Catalog with scopes (adds `role.*`), migration `0005` (`roles`, `role_permissions`, `tenant_members.role_id`, enum dropped), Tenant Admin role at tenant creation, login and refresh reading the role, interim fallback removed, users API with `roleId` and the role object, test helpers creating roles. | R3.1, R3.2 (computed permissions), R3.13: a new tenant has exactly one role, Tenant Admin, held by the owner; a token carries the role's keys, and a system role carries every key; a member with a custom role passes exactly its permissions; a null-`roleId` token is rejected; operators are refused; every Phase 1 and 2 test passes against roles. | Integration tests; a mutation check adding a catalog key shows the Tenant Admin token carries it without a data change.                               |
| 3.2 Role management                       | Tenants define roles within their own power.                           | `roles` module (`GET /permissions`, list, view, create, edit, delete), `missingGrants`, the actor grants loader, role locks, audit.                                                                                                                                                                        | R3.2 (protection), R3.4-R3.8, R3.12, R3.17, R3.18: catalog and scope validation; name uniqueness; subset rule on create, edit (current and new), and delete, with the scope order; a stale token refused by the database read; delete only when unused; every write audited.                                                                             | Integration tests, including concurrent edits of one role and delete versus invite on two connections; each race test fails when its lock is removed. |
| 3.3 Role assignment                       | Roles are given to users within the actor's power.                     | `PUT /users/:userId/role` (`role.assign`), subset checks on invite, assignment, deactivation, and reactivation; `role` removed from `PATCH /users`; `user.role_assigned` audit.                                                                                                                            | R3.3, R3.9-R3.11, R3.17: owner keeps Tenant Admin; no self change; both roles within the actor's on assignment; the given role within the actor's on invite; the target's role within the actor's on deactivate and reactivate.                                                                                                                          | Integration tests.                                                                                                                                    |
| 3.4 Scopes                                | The user directory follows the caller's scope.                         | Scope resolver in `tenant-access`; scoped `GET /users` and `GET /users/:userId`; the same scope bounds the target lookup in role assignment.                                                                                                                                                               | R3.14-R3.16: each scope for a section member, a member placed directly in a department, and a member with no unit; the caller always sees themselves; unit-less members only at organization scope; a move or a role edit changes the result without a token refresh; other tenants never appear.                                                        | Integration tests over the Al-Noor example structure.                                                                                                 |

Suggested order: 3.1, then 3.2, then 3.3, then 3.4.
Each step depends on the one before it, so the steps run one at a time in the main session, as in Phases 1 and 2.

## 8. Test Plan

Integration tests run against real PostgreSQL with two seeded tenants (Al-Noor and Al-Rashid); Al-Noor gets the example structure and the four example roles from section 3.

| Requirement       | Test                                                                                                                                                                         | Step     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R3.1, R3.2, R3.13 | Catalog listing; Tenant Admin at creation with computed permissions; token contents for system and custom roles; fallback gone.                                              | 3.1      |
| R3.4-R3.7         | Create, rename, replace permissions, delete; validation codes; name uniqueness ignoring case, Arabic names included.                                                         | 3.2      |
| R3.8, R3.12       | Subset matrix: Huda against Tenant Admin, Head of Legal, Legal Staff, and a role with `user.deactivate`; scope order; stale-token refusal.                                   | 3.2      |
| R3.3, R3.9-R3.11  | Invite with a role; assignment matrix with the owner, self, and roles beyond the actor's; deactivate and reactivate within the actor's power.                                | 3.3      |
| R3.14-R3.16       | Visibility table for Khalid (own), Faisal and Nora (department), a section-scope user, Lina (no unit), Sara (organization); after a move; after a role edit without refresh. | 3.4      |
| R3.17             | Each role write and assignment leaves the expected audit row.                                                                                                                | 3.2, 3.3 |
| R3.18             | Al-Rashid role and user IDs in paths and bodies.                                                                                                                             | 3.2-3.4  |

## 9. Open Questions

| #   | Question                                                                                                                                                                     | Options                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Resolution                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | How is the Tenant Admin represented? MVP 3.1 says the first Tenant Admin "holds every tenant-level permission", and each later phase adds permissions.                       | (a) **Recommended:** a protected system role per tenant (`is_system`) whose permissions are computed as the whole catalog; it cannot be edited or deleted, and the owner always holds it. New permissions reach it with no data change. (b) An ordinary role seeded with every current permission; each later phase's migration grants its new permissions to every tenant's admin role, and Sara could edit it. (c) No admin role: the owner bypasses permission checks. Simplest, but Majed could never be a full admin, and a bypass is a second authorization path to test.                                          | **Resolved 2026-10-22: (a)**, a protected Tenant Admin system role with computed permissions; not editable or deletable; the owner always holds it (P3.8). |
| Q2  | Which roles does a new tenant start with?                                                                                                                                    | (a) **Recommended:** only Tenant Admin. Sara creates Head of Legal, Legal Staff, and Employee herself; seeded defaults would drift from what each later phase adds. (b) Also an editable "Employee" role with `org.view` and `user.view` (own), so Sara can invite people before creating any role.                                                                                                                                                                                                                                                                                                                      | **Resolved 2026-10-22: (a)**, a new tenant starts with the Tenant Admin role only (P3.9).                                                                  |
| Q3  | How much of scope belongs in Phase 3? Today no Phase 3 resource is naturally scoped except the user directory (Phase 2 Q5 left it open to all members, to be narrowed here). | (a) **Recommended:** store a scope with each grant, apply the scope order in the subset rule, and build the resolver now with `user.view` as its first consumer. The model and the rules are complete and tested before Phase 6 depends on them. (b) Store scopes and apply them in the subset rule now, but build the resolver in Phase 6 with requests; `user.view` stays organization-wide. Less code now, but the resolver is first tested under the most complex resource. (c) No scopes until Phase 6; every grant is organization-wide. Roles created before Phase 6 would need a data change when scopes arrive. | **Resolved 2026-10-22: (a)**, scopes stored on every grant and compared by the subset rule; the resolver is built now and applied to `user.view` (P3.10).  |
| Q4  | Does the subset rule also protect the target user? D2 says only that the role given must be within the actor's.                                                              | (a) **Recommended:** yes: assigning a role, deactivating, and reactivating also require the target's current role to be within the actor's. Otherwise Huda could put Majed (Tenant Admin) on Employee, or someone with `user.deactivate` alone could lock Sara's co-admin out. (b) No: only the given role is checked, as D2 is worded.                                                                                                                                                                                                                                                                                  | **Resolved 2026-10-22: (a)**, assigning, deactivating, and reactivating also require the target's current role to be within the actor's (P3.11).           |
| Q5  | Is changing a user's role its own permission?                                                                                                                                | (a) **Recommended:** yes, `role.assign`, on its own endpoint `PUT /users/:userId/role`. Huda can give legal roles without being able to rename or move Finance's people (`user.update`). (b) No: `user.update` covers it in `PATCH /users`, bounded by the subset rule. One permission fewer, but every role assigner can also edit any user's name and unit.                                                                                                                                                                                                                                                            | **Resolved 2026-10-22: (a)**, `role.assign` on its own endpoint, `PUT /users/:userId/role` (P3.12).                                                        |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #     | Decision                                                                                                                                                                                                                    | Rationale                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3.1  | The permission catalog lives in code as a map from key to allowed scopes; roles and their grants live in `roles` and `role_permissions`.                                                                                    | A permission ships with the route that requires it; routes are type-checked against the catalog; grants are queryable by permission for Phase 7.          |
| P3.2  | `tenant_members.role_id` with a composite foreign key replaces the membership enum; local databases are recreated.                                                                                                          | P0.13 planned this; there is no production data to migrate.                                                                                               |
| P3.3  | Scope order own < section < department < organization; a grant is within another when its key matches and its scope is the same or narrower.                                                                                | Makes D2 decidable for scoped permissions with one comparison.                                                                                            |
| P3.4  | Subset checks and the route's own permission are re-read from the database in the write's transaction; reading the actor's role takes no lock.                                                                              | Power-granting writes do not trust a token that may be 30 minutes old; any interleaving is equivalent to a valid serial order.                            |
| P3.5  | Role edits and deletes lock the role row (`FOR UPDATE`) before reading its grants. | An edit is judged and audited against the role as the previous edit left it; delete versus assign is deterministic (T22). |
| P3.6  | The token's `permissions` stays a list of keys; scopes are resolved in SQL from the current membership and role.                                                                                                            | Keeps P0.18's shape; row visibility is never stale, even when the token is.                                                                               |
| P3.7  | Scope definitions: own is the user; section is the user's own unit; department is the user's department and its sections; organization is the tenant; a user with no unit reaches only themselves below organization scope. | Gives every placement allowed by D19 a defined answer; a member placed directly in a department gets that unit as their section scope.                    |
| P3.8  | The Tenant Admin is a protected system role per tenant (`is_system`); its permissions are computed as the whole catalog at the widest scopes; it cannot be edited or deleted, and the owner always holds it.                | Owner decision (Q1): permissions added by later phases reach it with no data change, Majed can be a full admin too, and there is no bypass path.          |
| P3.9  | A new tenant starts with the Tenant Admin role only.                                                                                                                                                                        | Owner decision (Q2): no seeded defaults that drift from what later phases add.                                                                            |
| P3.10 | Every grant carries a scope, the subset rule compares scopes, and the scope resolver is built now with `user.view` as its first consumer.                                                                                   | Owner decision (Q3): the model and the rules are complete and tested before Phase 6 depends on them; the directory is narrowed as Phase 2 Q5 anticipated. |
| P3.11 | Assigning a role, deactivating, and reactivating also require the target's current role to be within the actor's grants. Extends D2.                                                                                        | Owner decision (Q4): nobody can take away powers they do not hold themselves.                                                                             |
| P3.12 | Changing a user's role needs its own permission, `role.assign`, on `PUT /users/:userId/role`; `PATCH /users` no longer accepts a role.                                                                                      | Owner decision (Q5): a Head of Legal can give legal roles without being able to rename or move other departments' people.                                 |

Promoted on 2026-10-22: P3.8, P3.9, P3.11, and P3.12 to `MVP_SCOPE.md` as D21-D23 (with section 3.3 updated: scope definitions, `role.manage`, the Tenant Admin role); P3.1-P3.8 to `TECHNICAL_DECISIONS.md` as T26-T29. Decisions not promoted are detail that stays authoritative here.

## 11. Change Log

| Date       | Change                                                         | Reason                  |
| ---------- | -------------------------------------------------------------- | ----------------------- |
| 2026-10-22 | Initial draft.                                                 | Phase 3 spec requested. |
| 2026-10-22 | Resolved Q1-Q5, each with the recommended option (P3.8-P3.12). | Owner review.           |
| 2026-10-22 | Spec approved; implementation started. | Owner approval. |
| 2026-10-22 | Step 3.1 implemented and verified: migration `0005_roles` (`roles`, `role_permissions`, `permission_scopes`, `tenant_members.role_id`; the `tenant_member_roles` enum dropped), the catalog with scopes (`role.view`, `role.manage`, `role.assign` added), the Tenant Admin role created with each tenant and audited as `role.created`, login and refresh reading the role and its permissions, the interim fallback removed, and `roleId` in the users API (invite, edit, list filter) with the role object in every user; also checked end to end against a running server with Mailpit. Proposed for owner approval: until step 3.3, `PATCH /users` takes `roleId` with Phase 2's owner and self protections and audits it in `user.updated`; step 3.3 moves it to `PUT /users/:userId/role`. | Acceptance criteria met; mutation checks: a catalog key added with no data change reaches the Tenant Admin token and not a custom role's, and removing the system-role branch fails 13 tests. |
| 2026-10-22 | Step 3.1 approved by the owner with the go-ahead for step 3.2. | Owner approval. |
| 2026-10-22 | Step 3.2 implemented and verified: `roles` module (`GET /permissions`, `GET`, `POST`, `PATCH`, `DELETE /roles`), `missingGrants` and `loadMemberGrants` in `tenant-access`, the role lock, `ROLE_NAME_TAKEN`, `ROLE_IN_USE`, `ROLE_PROTECTED`, `PERMISSION_NOT_HELD`, and `tenant_members_role_fk` mapped to 400 `unknown_role`; also checked end to end against a running server. Proposed for owner approval: `PERMISSION_NOT_HELD` details keep the existing `[{path, code}]` shape as `{path: <permission key>, code: "permission_not_held", scope}` with `scope` an optional detail field (the owner's choice) instead of `{permissions:[{key, scope}]}`, and the error handler sends details for any code that has them; a deactivated actor holds no grants in subset checks; the edit lock's rationale is corrected (4.3, P3.5), because an edit updates the role row before replacing its grants, so the real risk without the lock is a subset check and audit against stale grants, not a union of two sets. | Acceptance criteria met; mutation checks: removing the role lock fails both race tests, not re-reading the route permission fails the stale-token and deactivated-actor tests, and not checking the current grants on edit fails the subset and race tests. |
| 2026-10-22 | Step 3.2 approved by the owner with the go-ahead for step 3.3, including the `PERMISSION_NOT_HELD` detail shape `{path, code: "permission_not_held", scope}` with `scope` an optional detail field. | Owner approval. |
| 2026-10-22 | Step 3.3 implemented and verified: `PUT /users/:userId/role` (`role.assign`) with `user.role_assigned` audit; the subset rule on invitation (`user.create` and the role), assignment (`role.assign`, the current and the new role), deactivation and reactivation (`user.deactivate` and the user's role); `PATCH /users` no longer takes a role; `assertGrantsHeld` and `loadRoleGrants` moved into `tenant-access` and shared by the roles and users modules; also checked end to end against a running server. Ordering detail: the self and owner checks come first, then the subset rule, then the no-op for an unchanged role or an already inactive or active user, so authorization is checked even when nothing changes. | Acceptance criteria met; mutation checks: ignoring the current role on assignment, skipping the subset rule on invitation, deactivation, or reactivation, and removing owner protection each fail the matching tests. |
| 2026-10-22 | Step 3.3 approved by the owner. Cross-cutting change requested by the owner, outside this phase's steps: request bodies reject unknown fields with `unknown_field` details, and named codes replace `custom` (`no_fields`, `end_before_start`, `too_many_decimals`); recorded as T25 in `TECHNICAL_DECISIONS.md`. `PATCH /users` with `roleId` now returns 400 `unknown_field` instead of ignoring it. | Owner request: the client can render which field was not accepted. |
| 2026-10-22 | Step 3.4 implemented and verified: `withinScope` in `tenant-access` (a SQL condition resolved inside the query from the caller's current unit, role, and active status, reusable for requests in Phase 6), applied to `GET /users`, `GET /users/:userId`, and the target lookup of `PUT /users/:userId/role`; also checked end to end against a running server. As the spec's edge cases say, a caller whose role no longer grants `user.view` sees nobody, themselves included; a deactivated caller with a live token sees nobody either. | Acceptance criteria met; mutation checks: dropping a department's sections, the "no grant" rule, the active-caller rule, the always-see-yourself rule, or the scope on assignment each fail the matching tests. |
| 2026-10-22 | Step 3.4 approved; all four steps verified; status set to `Implemented`; decisions promoted (D21-D23, T26-T29). | Phase 3 complete. |
