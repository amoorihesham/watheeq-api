# Phase 2 Spec: Org Structure & Users

| Field                  | Value                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Status**             | Implemented                                                                                                            |
| **Approved by / date** | _Amr - 21/10/2026 - 23:15 pm_                                                                                          |
| **Depends on**         | Phase 0 (`phase-0-foundations.md`), Phase 0.5 (`phase-0.5-refactor.md`), Phase 1 (`phase-1-platform-subscriptions.md`) |
| **Related decisions**  | MVP 3.2, 3.3 (D2 self-change rule only), 3.9, D3, D15, D16; Technical T2, T5, T7, T8, T14, T16, T17, T19, T20          |

---

## 1. Objective

Let a Tenant Admin build the organization (departments and sections, and who manages them) and manage the tenant's users: invite them, place them in the structure, change their basic role, and deactivate or reactivate them.
Give every user a way to change a forgotten or known password.
It is needed now because roles and scopes (Phase 3), Legal configuration (Phase 5), and escalation (Phase 7) all resolve "who" and "where" from this structure.

## 2. Scope

**In scope:**

- Organization units of two kinds under the tenant: a department sits directly under the organization, and a section sits under a department (D3). Create, rename, move a section, delete an empty unit.
- Managers: a unit has zero or more managers, all equal, each an active member of that unit (P2.3).
- Users: invite (create), list, view, edit name, unit, manager flag, and membership role, deactivate, reactivate, resend the invitation.
- The invited user sets their own password through an emailed link, the same way the first Tenant Admin does (P1.15).
- Password change (signed in) and password reset (forgotten), deferred from Phase 0.
- The permission each tenant endpoint will require, enforced now with an interim rule until Phase 3.

**Out of scope (and where it is handled instead):**

- Tenant-defined roles, the permission catalog, the subset rules, and scope resolution: Phase 3.
  Legal responsibilities (configuring legal operations, reviewing and owning requests) are permissions in that catalog, not a place in the structure (P2.14).
  Phase 2 keeps the `admin` / `member` membership enum (P0.13).
- Who is notified when a unit has several managers or none: Phase 7 (all active managers; a missing level is skipped, MVP 3.7).
- Changing a user's email address: after the MVP, or when requested; it needs a re-verification flow.
- Deleting users: never in the MVP. Deactivation keeps audit history and request ownership intact.
- Positions and job titles: out of the MVP (D3).
- Self-service profile editing (a user renaming themselves): later, if asked for.
- Rate limiting of password-reset requests: deferred hardening (added to the table in `TECHNICAL_DECISIONS.md`).

## 3. Requirements

Example tenant: **Al-Noor**, Tenant Admin **Sara** (the owner), on Basic (10 users).
Example structure:

```
Al-Noor (the tenant; not a unit)
├── Legal Affairs (department)               managers: Huda, Ahmed
│   ├── Contracts (section)                  managers: Faisal
│   └── Litigation (section)                 no manager yet
└── Finance (department)                     managers: Majed
    └── Procurement (section)                managers: Reem
```

Legal Affairs is an ordinary department that Sara created, like Finance.
Huda and Ahmed will act as Heads of Legal because, from Phase 3, Sara gives their role the legal permissions, not because of the department they manage.
Khalid is a member of Procurement who will submit legal requests in Phase 6.

| ID    | Requirement                                                                                                                                                                                           | Example                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R2.1  | A new tenant starts with an empty structure; no department has a special kind or protection.                                                                                                          | _Omar creates Al-Noor; `GET /org-units` returns no departments, and Sara is at the organization level. Sara creates "الشؤون القانونية" like any other department, and may later delete it once it is empty._ |
| R2.2  | A Tenant Admin can create departments directly under the organization and sections directly under a department. Nothing can be created under a section.                                               | _Sara creates Finance, then Procurement under Finance. Creating a unit under Procurement returns 400._                                                                                                       |
| R2.3  | Unit names are unique among their siblings, ignoring case.                                                                                                                                            | _A second department named "finance" returns 409 `UNIT_NAME_TAKEN`; a section named "Contracts" under Finance is allowed._                                                                                   |
| R2.4  | A Tenant Admin can rename a unit and move a section to another department. A department can never become a section, or the reverse.                                                                   | _Sara moves Procurement from Finance to Legal Affairs; Reem and Khalid move with it._                                                                                                                        |
| R2.5  | A unit can be deleted only when it has no sections and no members (active or not).                                                                                                                    | _Deleting Finance while Procurement exists returns 409 `UNIT_NOT_EMPTY`._                                                                                                                                    |
| R2.6  | A unit has zero or more managers, all with the same standing. A manager is a member of the unit they manage, so a person manages at most one unit.                                                    | _Sara marks Huda and Ahmed as managers of Legal Affairs. Litigation has no manager, which is allowed. Marking Khalid as a manager makes him a manager of Procurement, the unit he is in._                    |
| R2.7  | A user with no unit cannot be a manager. Moving a manager to another unit, or deactivating them, ends their manager role; the change is audited.                                                      | _Sara moves Faisal from Contracts to Litigation: he arrives as a plain member, and Contracts now has no manager. `user.updated` records `isManager: true → false`._                                          |
| R2.8  | A Tenant Admin invites a user with email, name, unit (or none), manager flag, and membership role. The invited user receives an email, sets their own password through the link, and can then log in. | _Sara invites `khalid@alnoor.sa` into Procurement as `member`. Khalid follows the link, chooses a password, and logs in. Sara never sees it._                                                                |
| R2.9  | Inviting a user takes a seat: it is rejected when the tenant is at its user limit, including under concurrency (R1.12).                                                                               | _Al-Noor has 10 of 10 users; Sara's invitation returns 409 `USER_LIMIT_REACHED`._                                                                                                                            |
| R2.10 | A user belongs to at most one unit; a user with no unit sits directly under the organization (Q1).                                                                                                    | _Sara herself has no unit; she appears at the organization level._                                                                                                                                           |
| R2.11 | A Tenant Admin can change a user's name, unit, manager flag, and membership role.                                                                                                                     | _Sara moves Khalid from Procurement to Finance and promotes Majed to `admin`._                                                                                                                               |
| R2.12 | A Tenant Admin can deactivate and reactivate users. A deactivated user cannot log in, loses access within 30 minutes, and frees their seat. Reactivation takes a seat (R1.12).                        | _Khalid leaves Al-Noor; Sara deactivates him and Al-Noor drops to 9 of 10 users. Reactivating him on a full tenant returns 409 `USER_LIMIT_REACHED`._                                                        |
| R2.13 | The owner (P0.10) can never be deactivated or lose the `admin` role. No user can deactivate themselves or change their own role (D2).                                                                 | _Majed (admin) tries to deactivate Sara: 409 `OWNER_PROTECTED`. Majed tries to set his own role to `member`: 403 `SELF_CHANGE_FORBIDDEN`._                                                                   |
| R2.14 | A Tenant Admin can resend an invitation to a user who has not set their password yet; older links stop working.                                                                                       | _Khalid lost the email; Sara resends; the first link now returns `VERIFICATION_INVALID`._                                                                                                                    |
| R2.15 | Every tenant user can view the organization structure and the user directory of their own tenant. Only Tenant Admins can change them.                                                                 | _Khalid opens the structure and sees Huda and Ahmed as managers of Legal Affairs. Khalid's `POST /org-units` returns 403 `FORBIDDEN`._                                                                       |
| R2.16 | A signed-in user can change their password by giving the current one. Their other sessions are signed out.                                                                                            | _Huda changes her password on her laptop; her phone's next refresh fails._                                                                                                                                   |
| R2.17 | A user who forgot their password can request a reset link by email. The response never reveals whether the email exists. Using the link sets a new password and signs out every session.              | _Huda requests a reset and gets an email. A request for `nobody@alnoor.sa` gets the same 204 and sends nothing._                                                                                             |
| R2.18 | Every structure and user change is audited in the same transaction, with before and after values where something changed.                                                                             | _Sara moves Khalid: `audit_log` has `user.updated` with `{before:{unitId: Procurement}, after:{unitId: Finance}}`._                                                                                          |
| R2.19 | Tenant endpoints only ever read or change the caller's tenant data.                                                                                                                                   | _Sara sends Al-Rashid's unit ID to `PATCH /org-units/:unitId`: 404 `NOT_FOUND`._                                                                                                                             |
| R2.20 | Every tenant endpoint declares the permission it requires.                                                                                                                                            | _`POST /users` requires `user.create`._                                                                                                                                                                      |

## 4. Design

### 4.1 Data model

#### The organization is the tenant; units are two kinds under it

MVP 3.2 calls the structure "Organization → Department → Section".
The organization is the tenant itself (Al-Noor in `tenants`), so it is not stored again.
`org_units` holds only departments and sections, and two rules keep the shape fixed: a department has no parent, and a section's parent is a department.

#### Why one `org_units` table instead of `departments` and `sections`

A user belongs to "a department or a section".
With two tables, `tenant_members` would need two nullable columns (`department_id`, `section_id`) plus a check that at most one is set, and every query that asks "who is in this unit" would branch on the kind.
One table with a `kind` column gives one foreign key from the member to their unit and one tree query.

**`org_units`** (new, tenant data):

| Column                     | Type                  | Notes                                                                                                                                                                                                                          |
| -------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                       | `uuid` PK             |                                                                                                                                                                                                                                |
| `tenant_id`                | `uuid`                | FK to `tenants`, not null.                                                                                                                                                                                                     |
| `kind`                     | `org_unit_kinds` enum | `department` or `section`. Never changes after creation.                                                                                                                                                                       |
| `parent_id`                | `uuid`                | Null for a department; the department's ID for a section. Composite FK `(tenant_id, parent_id)` → `org_units (tenant_id, id)`, so a parent is always in the same tenant. Check: `(kind = 'department') = (parent_id is null)`. |
| `name`                     | `text`                | Trimmed, 1-100 characters (check).                                                                                                                                                                                             |
| `created_at`, `updated_at` | `timestamptz`         |                                                                                                                                                                                                                                |

Indexes and constraints:

- Unique `(tenant_id, id)`: the target of the composite foreign keys.
- Two partial unique indexes keep sibling names unique ignoring case (R2.3): `org_units_department_name_unique` on `(tenant_id, lower(name))` where `parent_id is null`, and `org_units_section_name_unique` on `(parent_id, lower(name))` where `parent_id is not null`. Both map to 409 `UNIT_NAME_TAKEN`. (Drizzle supports `NULLS NOT DISTINCT` only on plain column constraints, not on an expression index.)
- That a section's parent is a department is checked in the service. It cannot race: `kind` never changes, and a parent that is deleted at the same moment is caught by the foreign key.

**`tenant_members`** (changed):

- `unit_id uuid`, nullable: the user's unit, or null for "directly under the organization" (R2.10, Q1).
  Composite FK `(tenant_id, unit_id)` → `org_units (tenant_id, id)`, so a member can only be placed in a unit of their own tenant.
- `is_manager boolean`, not null, default `false`: this member manages their unit (R2.6).
  Check `not is_manager or unit_id is not null`: a user at the organization level manages nothing.
- Index on `(tenant_id, unit_id)` for "members of this unit".

**`password_tokens`** (renamed from `email_verifications`):

The invitation link and the reset link do the same thing: prove the person controls the email, then let them set a password.
Phase 1's table gains a `purpose` column instead of a second, almost identical table.

| Change                                                   | Notes                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Table renamed to `password_tokens`                       | Its rows are no longer only email verifications.                                        |
| `purpose` `password_token_purposes` enum, not null       | `invitation` (Phase 1's verification link, now also used for invited users) or `reset`. |
| Unique index renamed `password_tokens_token_hash_unique` |                                                                                         |

Invitation links last 72 hours (Phase 1's `VERIFICATION_TOKEN_TTL_SECONDS`); reset links last 1 hour (`PASSWORD_RESET_TTL_SECONDS`, default `3600`).
Issuing a link retires the user's unused links of the same purpose, as Phase 1's resend does.

There is no production data (P0.13), so the migration creates `password_tokens` and drops `email_verifications` instead of renaming it: a rename would have to add the required `purpose` column to existing rows.
A local database migrated earlier loses only its pending verification links, which the operator can resend.

#### Managers

Because a manager must be a member of the unit they manage, and a member belongs to one unit, "manager" is a property of the membership, not of the unit.
`tenant_members.is_manager` stores it, and "the managers of Legal Affairs" is a query:

```sql
select user_id from tenant_members m join users u on u.id = m.user_id
where m.tenant_id = $1 and m.unit_id = $2 and m.is_manager and u.is_active
```

What this design gives without extra machinery:

- A manager can never be outside their unit: the flag is on the same row as the unit.
- Several equal managers per unit, or none, with no limit to enforce.
- No manager-specific concurrency rule. Example: Sara marks Faisal as a manager while Majed moves him to Litigation. Both write the same `tenant_members` row; PostgreSQL runs the two updates one after the other, and the move clears the flag (below), so Faisal ends as a member of Litigation and Faisal's audit entries record both changes in order.

Two rules keep the flag meaningful:

- **A move clears it.** When `unitId` changes, `is_manager` becomes `false` unless the same request sets `isManager: true`. Otherwise Faisal, managing Contracts, would silently become a manager of Litigation.
- **Deactivation clears it.** A deactivated manager does not appear as a manager, and reactivating them brings them back as a plain member; Sara marks them again if she wants. The audit entry shows `isManager: true → false`.

Nothing marks a department as Legal (P2.14).
Who may configure legal operations or review requests is a permission (Phase 3); the escalation chain in Phase 7 climbs the request owner's own units: Faisal's section managers (Contracts), then his department's managers (Legal Affairs).

#### Database errors

Repositories never catch (Phase 0.5); `fromDatabaseError` in `src/http/errors.ts` maps known constraints.
Phase 2 adds foreign-key violations (SQLSTATE `23503`) to the same mechanism, keyed by constraint name:

| Constraint | SQLSTATE | Code |
| ---------- | -------- | ---- |
| `org_units_department_name_unique`, `org_units_section_name_unique` | 23505 | 409 `UNIT_NAME_TAKEN` |
| `org_units_parent_fk` (a section written under a unit that was just deleted) | 23503 | 400 `VALIDATION_FAILED`, detail `{path: "parentId", code: "unknown_unit"}` |
| `tenant_members_unit_fk` (a member placed in a unit that was just deleted) | 23503 | 400 `VALIDATION_FAILED`, detail `{path: "unitId", code: "unknown_unit"}` |

Only the side that writes into a unit is mapped.
A delete never violates these keys, because it locks the unit before checking that it is empty (see "Delete a unit" in 4.3); the error's `table` field could not tell the two sides of `org_units_parent_fk` apart anyway, since both are `org_units`.

#### Membership role changes

`tenant_members.role` stays `admin` / `member` until Phase 3 (P0.13).
A role change or a deactivation takes effect in the user's access token at the next refresh, within 30 minutes (P0.9).
Example: Sara demotes Majed at 10:00; until his token expires at up to 10:30, Majed can still call admin endpoints.
This is the same accepted gap as deactivation (Phase 0), and it is listed in section 6.

#### Seats

`assertSeatAvailable(tx, tenantId)` (T17) is called in the same transaction by invitation and reactivation, and only by them.
Moving, renaming, marking a manager, or changing a role never changes the seat count.

#### Audit actions

| Action                                 | Resource | `details`                                                   |
| -------------------------------------- | -------- | ----------------------------------------------------------- |
| `org_unit.created`                     | org_unit | `{name, kind, parentId}`                                    |
| `org_unit.updated`                     | org_unit | `{before, after}` of name and parent                        |
| `org_unit.deleted`                     | org_unit | `{name, kind, parentId}`                                    |
| `user.invited`                         | user     | `{email, userName, unitId, isManager, role}`                |
| `user.updated`                         | user     | `{before, after}` of changed fields, including `isManager`  |
| `user.deactivated`, `user.reactivated` | user     | `user.deactivated` includes `isManager` when it was cleared |
| `user.invitation_resent`               | user     | none                                                        |
| `user.password_changed`                | user     | none (actor is the user)                                    |
| `user.password_reset`                  | user     | none (actor is the user)                                    |

A reset request is not audited: it changes nothing until the link is used, and logging requests for unknown emails would fill the audit log with noise from anyone on the internet.

### 4.2 API

See [phase-2-org-structure-users.API.md](phase-2-org-structure-users.API.md).

### 4.3 Key flows

#### Create a tenant (unchanged)

Phase 1's flow creates no unit; Sara's membership has `unit_id = null`, at the organization level (R2.1, R2.10).

#### Invite a user

1. Validate the body; `unitId`, when given, must be a unit of the caller's tenant; `isManager` needs a unit.
2. In one transaction: `assertSeatAvailable`; insert the user (unverified, no password; `insertPendingUser`); insert the membership with unit, manager flag, and role; issue an `invitation` token; audit `user.invited`.
3. A taken email rolls everything back with 409 `EMAIL_TAKEN` (email is unique platform-wide, T6, so an email used in Al-Rashid cannot be invited to Al-Noor).
4. After commit, send the invitation email (P1.14). A send failure is logged; the 201 is still returned, and Sara can resend.

Khalid sets his password with Phase 1's `/auth/verify`; the flow is unchanged.
The invitation email text says who invited him and to which organization; the link is the same `/verify-email` page.

#### Update a user

In one transaction:

1. Load the target membership (404 if not in this tenant).
2. Reject a change to the caller's own role (403 `SELF_CHANGE_FORBIDDEN`), and demotion of the owner (409 `OWNER_PROTECTED`).
3. Compute the new manager flag: the requested `isManager` if given; otherwise `false` when `unitId` changes, else unchanged. A manager flag with no unit is 400.
4. Update in one statement, and audit `user.updated` with only the fields that changed.

The caller may change their own name, unit, and manager flag.

#### Deactivate and reactivate

Deactivate, in one transaction: reject self (403), the owner (409 `OWNER_PROTECTED`); set `is_active = false` and `is_manager = false`; retire the user's unused password tokens; revoke the user's refresh tokens; audit.
Revoking refresh tokens is not required for correctness (refresh already rejects inactive users, P0.8), but it removes rows that can never be used again.
An invited user who never set a password can be deactivated too; their retired invitation means a later click fails.

Reactivate, in one transaction: `assertSeatAvailable`; set `is_active = true`; audit.
Deactivating or reactivating a user already in that state returns 200 with no change and no audit entry.

#### Delete a unit

In one transaction: load and lock the unit (`FOR UPDATE`; 404); any section or member → 409 `UNIT_NOT_EMPTY`; delete; audit.

Why the lock: Sara deletes Finance while Majed creates a section under it.
Majed's insert checks its foreign key by taking a key-share lock on Finance, which conflicts with Sara's `FOR UPDATE`, so the two run one after the other:

- Majed's insert first: Sara's lock waits for his commit, her count then sees his section, and she gets 409 `UNIT_NOT_EMPTY`.
- Sara's lock first: Majed's foreign-key check waits for her commit, then finds Finance gone, and he gets 400 `unknown_unit`.

Without the lock, Sara's count could miss Majed's uncommitted section and her `DELETE` would fail on the foreign key instead.

#### Change password (signed in)

1. Validate; verify `currentPassword` against the stored hash (wrong → 401 `INVALID_CREDENTIALS`).
2. In one transaction: set the new hash; revoke every refresh token of the user except the one in this request's cookie; audit `user.password_changed`.

#### Reset a forgotten password

Request (`POST /auth/password-reset/request`):

1. Validate the email; respond 204 immediately.
2. After the response: if the email belongs to an active, verified user, issue a `reset` token in a transaction and send the email (link `${APP_BASE_URL}/reset-password?token=<token>`). Otherwise do nothing. Failures are logged.

Doing the work after the response keeps the response time the same whether or not the account exists, so timing does not reveal registered emails.
An invited user who has not set a password gets nothing; their invitation is the way in, and Sara can resend it.

Use (`POST /auth/password-reset`):

1. Validate `{token, password}`.
2. In one transaction: consume the `reset` token with Phase 1's conditional `UPDATE` (unknown, used, expired, or replaced → 400 `VERIFICATION_INVALID`); the user must still be active (else the same 400); set the new hash; revoke every refresh token of the user; audit `user.password_reset`.
3. Return 204; the user then logs in.

An `invitation` token cannot be used on the reset endpoint, or the reverse: the consuming `UPDATE` matches on `purpose`.

### 4.4 Module structure

```
src/
  db/schema/org-units.ts                    new
  db/schema/tenant-members.ts               (changed) unit_id, is_manager
  db/schema/password-tokens.ts              renamed from email-verifications.ts; purpose
  db/errors.ts                              (changed) foreign-key violations: constraint and table
  http/errors.ts                            (changed) new codes; foreign-key map
  modules/
    tenant-access/                          (new, small) requireTenantPermission, tenant permission list, interim fallback
    org/
      org.routes.ts (composes), .controller.ts, .service.ts, .repository.ts
      org.constants.ts, .schemas.ts, .types.ts
    users/
      users.routes.ts (composes), .controller.ts, .service.ts, .repository.ts
      users.constants.ts, .schemas.ts, .types.ts
    auth/                                   (changed) password change and reset; invitation email; onboarding helpers take a purpose
    subscriptions/                          (changed) GET /subscription uses requireTenantPermission('subscription.view')
```

`app.ts` gains `/org-units` and `/users`.
`tenant-access` is a module of its own because `org`, `users`, and `subscriptions` all need it and none of them should import another for it; Phase 3 grows it into the roles module or replaces it.

## 5. Edge Cases and Failure Behavior

| Scenario                                                                                  | Expected behavior                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sara and Majed create a department named "HR" at the same moment.                         | One succeeds; the other hits `org_units_department_name_unique` and gets 409 `UNIT_NAME_TAKEN`.                                                                                                   |
| Sara deletes Finance while Majed moves Khalid into it.                                    | The foreign key decides: if the delete commits first, the move fails with 400 (`unknown_unit`); if the move commits first, the delete fails with 409 `UNIT_NOT_EMPTY`.                 |
| Sara marks Faisal as a manager while Majed moves him to Litigation.                       | Both update Faisal's membership row; PostgreSQL applies them one after the other. Faisal ends in Litigation; he is a manager only if the mark ran second, which the audit order shows. |
| Faisal, manager of Contracts, is moved to Litigation without `isManager`.                 | He arrives as a plain member; Contracts has no manager; `user.updated` shows `isManager: true → false`.                                                                                |
| Huda, one of two managers of Legal Affairs, is deactivated.                               | Allowed; Ahmed remains its manager. Had she been the only one, Legal Affairs would simply have no manager.                                                                             |
| Sara sets `isManager: true` on a user with no unit.                                       | 400 `manager_needs_unit`; the database check rejects it as a second safeguard.                                                                                                         |
| Two admins invite the 10th user of a 10-user tenant at the same moment.                   | The seat lock serializes them; the second gets 409 `USER_LIMIT_REACHED` (T17).                                                                                                         |
| Al-Noor was downgraded to 5 users and has 8. Sara deactivates one, then reactivates them. | Deactivation is allowed; reactivation is rejected (7 ≥ 5) (D15).                                                                                                                       |
| Sara moves Procurement (with its members and manager Reem) from Finance to Legal Affairs. | Allowed: members and Reem move with the section and Reem stays its manager; nobody's `unit_id` changes.                                                                                |
| Sara tries to make Procurement a department, or Finance a section.                        | 400: `parentId` on a department is rejected, and a section's `parentId` cannot be null.                                                                                                |
| Majed (admin) demotes Sara (owner).                                                       | 409 `OWNER_PROTECTED`.                                                                                                                                                                 |
| Sara demotes Majed while he is signed in.                                                 | His token keeps `admin` until it expires (at most 30 minutes); then refresh issues a `member` token.                                                                                   |
| Khalid is deactivated before he accepts his invitation.                                   | His links are retired; `/auth/verify` returns 400 `VERIFICATION_INVALID`.                                                                                                              |
| Sara invites an email that belongs to an Al-Rashid user.                                  | 409 `EMAIL_TAKEN`. The response does not say which tenant has it.                                                                                                                      |
| Someone requests password resets for many emails.                                         | Each gets 204; only real, active, verified users get an email. Rate limiting is deferred hardening.                                                                                    |
| Huda uses a reset link after Sara deactivated her.                                        | 400 `VERIFICATION_INVALID`.                                                                                                                                                            |
| Huda opens an old reset link after requesting a newer one.                                | The older one was retired; 400 `VERIFICATION_INVALID`.                                                                                                                                 |
| Al-Noor is Read-only; Sara invites a user.                                                | 403 `SUBSCRIPTION_READ_ONLY` (guard).                                                                                                                                                  |
| Al-Noor is Read-only; Huda changes her password or resets it.                             | Allowed: `/auth/*` is not behind the guard.                                                                                                                                            |
| Sara sends an Al-Rashid unit ID or user ID in a path.                                     | 404 `NOT_FOUND`; in a body, 400 with `unknown_unit` or `unknown_user`.                                                                                                                 |

## 6. Security and Authorization

- **Trust boundaries:** every body and query validated with zod; names and keys also have database checks.
- **Tenant isolation:** application-level (T2). Every repository function takes the tenant ID from the token. The composite foreign keys add a database guarantee that a member or a section is never linked to another tenant's unit, even if a query forgets the filter.
- **Authorization:** every route declares a tenant permission (R2.20); until Phase 3 an interim role table decides.
  Self role change and self deactivation are refused (D2); the owner keeps `admin` and stays active (P0.10).
- **Accepted gap:** a demoted or deactivated user keeps their access token's rights for up to 30 minutes (P0.9).
- **Account enumeration:** the reset request always returns 204 with the same timing; `EMAIL_TAKEN` on invite reveals that an email exists on the platform, but only to a Tenant Admin, and is needed to explain the failure.
- **Tokens:** invitation and reset links are random, stored only as hashes, single use, purpose-bound, and expire (72 hours and 1 hour). A password reset or change signs out other sessions.
- **Audit:** every write audited in the same transaction (T8).

## 7. Implementation Steps

| Step                   | Objective                                         | Delivers                                                                                                                                                                                                       | Acceptance criteria                                                                                                                                                                                                                                                                                                                                                       | Verification                                                                                                               |
| ---------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2.1 Tenant permissions | Every tenant route declares a permission.         | `tenant-access` module, `requireTenantPermission`, interim role table; `GET /subscription` moved onto it.                                                                                                      | R2.20: `admin` passes every permission; `member` passes only `org.view` and `user.view`; operators are refused; a token with a `roleId` is judged by its `permissions` only, never by the fallback.                                                                                                                                                                            | Integration tests.                                                                                                         |
| 2.2 Organization units | Admins build the tree.                            | `org_units`, `tenant_members.unit_id` (needed for R2.5 and member counts), migration, foreign-key error mapping, unit CRUD and move, `GET /org-units`.                                                                                                                       | R2.1-R2.5, R2.15 (structure), R2.19: only departments under the organization and sections under departments; sibling names unique ignoring case, including Arabic names; delete only when empty, including under a concurrent create; a new tenant starts with no units; another tenant's IDs give 404 or 400.                                                            | Integration tests, including one concurrent delete-versus-create on two connections.                                       |
| 2.3 Users and managers | Admins invite and manage users and mark managers. | `tenant_members.is_manager`, `password_tokens` rename with `purpose`, users module (invite, list, detail, edit, deactivate, reactivate, resend), invitation email, managers in `GET /org-units`. | R2.6-R2.14, R2.15 (directory), R2.18, R2.19: an invited user sets a password and logs in; seats taken by invite and reactivation; owner and self protections; a move or deactivation clears the manager flag and audits it; several managers and none both shown correctly; list filters, search, ordering, and paging; every write audited with before and after values. | Integration tests with the fake email sender; one test through Mailpit; concurrency test for the last seat via invitation. |
| 2.4 Passwords          | Users change and recover passwords.               | `/auth/password`, `/auth/password-reset/request`, `/auth/password-reset`, reset email, `PASSWORD_RESET_TTL_SECONDS`.                                                                                           | R2.16, R2.17: other sessions signed out; reset for unknown, unverified, and inactive emails sends nothing and returns the same 204; tokens are single use, purpose-bound, expire after 1 hour, and are replaced by a newer request.                                                                                                                                       | Integration tests with the fake email sender.                                                                              |

Suggested order: 2.1; then 2.2; then 2.3; then 2.4.

## 8. Test Plan

Integration tests run against real PostgreSQL with two seeded tenants (Al-Noor and Al-Rashid), so every endpoint is also tested with the other tenant's IDs.

| Requirement  | Test                                                                                                                           | Step    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------- |
| R2.20        | Each permission per membership role; token permissions override the fallback; operators refused.                               | 2.1     |
| R2.1-R2.5    | Empty structure at creation; create, rename, move, delete; shape rules; name uniqueness; empty-only delete, concurrent delete. | 2.2     |
| R2.6, R2.7   | Several managers, none, manager needs a unit, move and deactivation clear the flag.                                            | 2.3     |
| R2.8-R2.14   | Invite to first login; seats; owner and self protections; resend; deactivate and reactivate.                                   | 2.3     |
| R2.16, R2.17 | Change, reset request for each kind of email, reset use, sessions revoked.                                                     | 2.4     |
| R2.15, R2.19 | Members read but cannot write; cross-tenant IDs in paths and bodies.                                                           | 2.2-2.3 |
| R2.18        | Each write leaves the expected audit row, with before and after values.                                                        | 2.2-2.4 |

## 9. Open Questions

| #   | Question                                                                                                                                                                                                      | Options                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Resolution                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Must every user belong to a unit? MVP 3.2 says "exactly one unit", but Sara (created with the tenant, before any unit exists) and people like a CEO or an IT admin do not naturally sit in a department.      | (a) **Recommended:** a user has at most one unit; no unit means "directly under the organization". Changes MVP 3.2's wording to "at most one". Phase 3 scopes treat such a user as having only "own" and "organization" scope. (b) Every user must have a unit; Sara gets one at tenant creation, and invitations require a unit. (c) A unit is optional only until it is first set, then required.                                                                                                                                                         | **Resolved 2026-10-21: (a)** (P2.13).                                                                                                                                                                     |
| Q2  | How does the system know which department is Legal (and so who the Heads of Legal are)?                                                                                                                       | (a) **Recommended:** the Legal department is created with the tenant, marked `is_legal`, renameable, never deletable. Every tenant of a legal-affairs product has one, so it always exists for Phases 5-7. Default name in Arabic, `الشؤون القانونية`, which Sara can rename. (b) Sara creates it herself and marks one department as Legal; until she does, Legal configuration is impossible. (c) Same as (a) with an English default name. (d) No marker: legal responsibilities are permissions (Phase 3), and escalation climbs the owner's own units. | **Resolved 2026-10-21: (d)**, owner's proposal (P2.14). A flag would decide authorization from the tree, which D1 gives to roles; every later use is covered by a permission or by the owner's own units. |
| Q3  | How many managers does a unit have, and who can be one? MVP 3.2 says "exactly one manager".                                                                                                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **Resolved 2026-10-21:** departments and sections have zero or more managers, all equal; a manager is a member of the unit they manage (P2.3, P2.12).                                                     |
| Q4  | Should password change and password reset be part of this phase? Phase 0 deferred them here. Without reset, a user who forgets their password needs the operator to intervene, and there is no tool for that. | (a) **Recommended:** yes, as step 2.4. (b) Only password change now; reset in a later phase. (c) Neither; a Tenant Admin "resends an invitation" to reset someone's password.                                                                                                                                                                                                                                                                                                                                                                               | **Resolved 2026-10-21: (a)**, step 2.4.                                                                                                                                                                   |
| Q5  | Can members (non-admins) see the user directory, including colleagues' emails?                                                                                                                                | (a) **Recommended:** yes for now (`user.view` held by `member` until Phase 3); requesters and legal staff need to find each other, and Phase 3 can narrow it with scopes. (b) Admins only until Phase 3.                                                                                                                                                                                                                                                                                                                                                    | **Resolved 2026-10-21: (a)**.                                                                                                                                                                             |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Rationale                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2.1  | One `org_units` table with `kind` (`department`, `section`) and `parent_id`; the organization is the tenant and is not stored as a unit; the shape is a check plus a service rule on an immutable `kind`.                                                                                                                                                                                                                                                                       | One foreign key from a member to their unit; one tree query; the shape cannot be broken by concurrency.                                                                                                          |
| P2.2  | Composite foreign keys including `tenant_id` for a section's parent and a member's unit.                                                                                                                                                                                                                                                                                                                                                                                        | A database guarantee against cross-tenant links, on top of T2's application filter.                                                                                                                              |
| P2.3  | A manager is a member of the unit they manage, stored as `tenant_members.is_manager`; moving or deactivating a member clears the flag unless the same request sets it.                                                                                                                                                                                                                                                                                                          | Owner decision (Q3): the flag can never point outside the unit, needs no locks, and never silently makes someone a manager of a new unit.                                                                        |
| P2.4  | Foreign-key violations join the central error map, keyed by constraint and table.                                                                                                                                                                                                                                                                                                                                                                                               | Repositories keep never catching (Phase 0.5); concurrency losers get a meaningful 409 or 400.                                                                                                                    |
| P2.5  | Invited users onboard through Phase 1's verification flow (`/auth/verify`).                                                                                                                                                                                                                                                                                                                                                                                                     | One way to set a first password; no password ever passes through an admin.                                                                                                                                       |
| P2.6  | `email_verifications` becomes `password_tokens` with a `purpose` (`invitation`, `reset`); reset links last 1 hour.                                                                                                                                                                                                                                                                                                                                                              | Both links prove control of the email and set a password; one table, one consuming `UPDATE`.                                                                                                                     |
| P2.7  | The reset request answers 204 before doing any work.                                                                                                                                                                                                                                                                                                                                                                                                                            | No account enumeration through the response or its timing.                                                                                                                                                       |
| P2.8  | Password change and reset revoke the user's other refresh tokens.                                                                                                                                                                                                                                                                                                                                                                                                               | A stolen session does not survive a password change.                                                                                                                                                             |
| P2.9  | `requireTenantPermission` reads `tenant.permissions`, with an interim fallback by membership role until Phase 3.                                                                                                                                                                                                                                                                                                                                                                | Routes are written once against their final permission; Phase 3 changes only where permissions come from.                                                                                                        |
| P2.10 | Users are never deleted; deactivation keeps their unit and history.                                                                                                                                                                                                                                                                                                                                                                                                             | Audit and future request ownership keep pointing at a real user.                                                                                                                                                 |
| P2.11 | The user list is paged with `limit` and `offset` and filtered by unit, manager flag, status, and a name or email search.                                                                                                                                                                                                                                                                                                                                                        | Tenants can have hundreds of requesters; admins need to find a person to place or make a manager.                                                                                                                |
| P2.12 | Departments and sections have zero or more managers, all equal. Replaces MVP 3.2's "exactly one manager" (to be recorded as a new MVP decision when the phase is implemented).                                                                                                                                                                                                                                                                                                  | Owner decision (Q3): real departments are run by more than one person, and the Product Vision already expects several Legal Department Managers. Phase 7 notifies all active managers of a level.                |
| P2.13 | A user belongs to at most one unit; a user with no unit sits directly under the organization. Replaces MVP 3.2's "exactly one unit" (to be recorded as a new MVP decision when the phase is implemented).                                                                                                                                                                                                                                                                       | Owner decision (Q1): the first Tenant Admin exists before any unit, and some people (a CEO, an IT admin) belong to no department.                                                                                |
| P2.14 | No department is marked as Legal. Legal responsibilities (configuring legal operations, reviewing and owning requests, receiving R0 escalations) are permissions in the Phase 3 catalog; the escalation chain climbs the request owner's own units (section managers, then department managers). Replaces MVP 3.2's "The Legal department is a department in this tree; its manager is the Head of Legal" (to be recorded as a new MVP decision when the phase is implemented). | Owner decision (Q2): authorization stays with roles (D1), Legal is configured like any department, and organization administration and legal operations stay separable (Product Vision §3). Phases 5-7 apply it. |

Promoted on 2026-10-21: P2.12-P2.14 to `MVP_SCOPE.md` as D18-D20 (with MVP 3.2, 3.7, the actors table, D3, and the known limitations updated to match); P2.1-P2.9 to `TECHNICAL_DECISIONS.md` as T21-T24; rate limiting of password-reset requests added to the deferred hardening table. Decisions not promoted are detail that stays authoritative here.

## 11. Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                          | Reason                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 2026-10-21 | Initial draft.                                                                                                                                                                                                                                                                                                                                                                                  | Phase 2 spec requested. |
| 2026-10-21 | Managers: zero or more per unit, all equal, members of their unit, stored as `tenant_members.is_manager` (Q3 resolved, P2.3, P2.12); removed `org_units.manager_id`, the manager foreign key and row locks, the manager endpoint, and `MANAGER_NOT_MEMBER`, `USER_INACTIVE`, `USER_IS_MANAGER`; managers merged into the users step; structure described as two kinds of unit under the tenant. | Owner review.           |
| 2026-10-21 | Resolved Q1 (at most one unit, P2.13), Q4 (password change and reset in step 2.4), and Q5 (members see the directory until Phase 3).                                                                                                                                                                                                                                                            | Owner review.           |
| 2026-10-21 | Resolved Q2: no Legal marker (P2.14). Removed `is_legal`, the Legal department at tenant creation, and `UNIT_PROTECTED`; R2.1 now states that a new tenant starts with an empty structure.                                                                                                                                                                                                      | Owner review.           |
| 2026-10-21 | Spec approved; implementation started. | Owner approval. |
| 2026-10-21 | Step 2.1 implemented and verified: `tenant-access` module (`TENANT_PERMISSIONS`, interim role table, `tenantPermissionsOf`, `requireTenantPermission`); `GET /subscription` requires `subscription.view`, so members now get 403. The fallback applies when the token's `roleId` is null, instead of when `permissions` is empty (approved by the owner with the go-ahead for step 2.2). | Acceptance criteria met; a token whose Phase 3 role is named `admin` with no permissions must not get admin rights through the fallback. |
| 2026-10-21 | Step 2.2 implemented and verified: migration `0003_org_units`, org module (`GET`, `POST`, `PATCH`, `DELETE /org-units`), foreign-key violations in the central error map. Proposed for owner approval: `tenant_members.unit_id` moved from step 2.3 to 2.2; two partial unique indexes instead of one `NULLS NOT DISTINCT` index; a unit delete locks the unit and only the writing side of a foreign key is mapped (`unknown_unit`), instead of telling the sides apart by table. `managers` joins `GET /org-units` in step 2.3. Approved by the owner with the go-ahead for step 2.3. | Acceptance criteria met; the delete-versus-create race test fails when the lock is removed. |
| 2026-10-21 | Step 2.3 implemented and verified: migration `0004_users_and_managers` (`password_tokens` with `purpose`, `tenant_members.is_manager`), users module (`/users`: list, detail, invite, edit, deactivate, reactivate, resend), invitation email, `managers` in `GET /org-units`; also checked end to end against a running server with Mailpit. Proposed for owner approval: `password_tokens` is created and `email_verifications` dropped rather than renamed; resending an invitation to a deactivated user returns 409 `USER_INACTIVE` (both approved by the owner with the go-ahead for step 2.4). Fixed two flaky tests: Phase 1's tenant-isolation lock test no longer measures wall-clock time and always releases its transaction; a users test no longer counts a name shared with another file. | Acceptance criteria met; mutation checks on the seat check and the move rule fail as expected; five consecutive full runs pass. |
| 2026-10-21 | Step 2.4 implemented and verified: `POST /auth/password` (signs out the user's other sessions), `POST /auth/password-reset/request` (validates, answers 204, then looks up the account and emails a link), `POST /auth/password-reset` (signs out every session), reset email with `${APP_BASE_URL}/reset-password?token=`, `PASSWORD_RESET_TTL_SECONDS` (default 3600); also checked end to end against a running server with Mailpit. | Acceptance criteria met; mutation checks on answering before the email work and on signing out other sessions fail as expected. |
| 2026-10-21 | All four steps verified; status set to `Implemented`; decisions promoted (D18-D20, T21-T24, deferred hardening). | Phase 2 complete. |
