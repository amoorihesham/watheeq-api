# Phase 1 Spec: Platform, Plans & Subscriptions

| Field                  | Value                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| **Status**             | In Review                                                                                     |
| **Approved by / date** | \_Amr - 20/10/2026 - 18:18 pm                                                                 |
| **Depends on**         | Phase 0 (`phase-0-foundations.md`), Phase 0.5 (`phase-0.5-refactor.md`)                       |
| **Related decisions**  | MVP 3.1, 3.9, D11-D15, open questions 5-7; Technical T2, T6, T8, T11, T14, T15, T20, T21, T23 |

---

## 1. Objective

Let a platform operator create tenants, define plans, and manage each tenant's subscription, and make the subscription govern what the tenant can do: Active, Grace, or Read-only, and how many users it may have.
It is needed now because every later phase (users, roles, requests) runs inside a tenant that must first exist, and their write paths must respect the subscription state and user limit from the start rather than being retrofitted.

## 2. Scope

**In scope:**

- How the application creates tenants, given that the runtime role can only read `tenants` today (Phase 0 open item).
- How operators reach platform data across tenants without weakening tenant isolation for tenant-realm code.
- How operator and platform-level actions are audited (Phase 0 open item).
- Plans: create, list, view, edit (operator).
- Tenants: create a tenant together with its subscription and its first Tenant Admin user, list, view (operator).
- Subscriptions: renew, extend, change, or end a tenant's subscription (operator); view the subscription and usage (tenant).
- The permission each endpoint requires.
- Subscription states Active → Grace → Read-only, derived from dates, and their enforcement mechanism on tenant routes.
- User-limit enforcement that holds under concurrency, including the over-limit state after a downgrade.

**Out of scope (and where it is handled instead):**

- Creating, editing, and deactivating users through the API: Phase 2. Phase 1 delivers the user-limit check those endpoints must call.
- The Tenant Admin role, the permission catalog, and enforcing tenant permissions such as `subscription.view`: Phase 3. Phase 1 names the permissions (4.2); Phase 3's catalog must include them.
- Operator roles and per-operator permissions: after the MVP. The MVP has one kind of operator (MVP section 2), so every operator holds every platform permission (4.2).
- Blocking new request submission during Grace: the mechanism is delivered here (4.3); Phase 6 applies it to the submission route.
- Effect of Read-only on SLA clocks and escalations of open requests (MVP open question 6): Phases 6 and 7.
- Subscription warning notifications to Tenant Admins: Phase 7. Phase 1 exposes the state in the session response so the client can show a banner.
- Forced password change for the first Tenant Admin: Phase 2, together with the password change flow.
- Payments, invoices, trials, feature gating, self-service plan changes: out of the MVP (MVP section 4).
- A screen or endpoint for subscription history: the history is kept in the audit log (R1.6); an endpoint to read it comes with the audit views.
- Pagination of operator lists: not needed at MVP tenant counts; added when lists grow.

## 3. Requirements

Example people: **Omar**, a platform operator; **Sara**, the first Tenant Admin of **Al-Noor**; **Khalid**, a user at **Al-Rashid**.
Example plans: **Basic** (10 users, 14 grace days) and **Professional** (50 users, 30 grace days).
All dates are calendar dates in Saudi Arabia (`Asia/Riyadh`).

| ID    | Requirement                                                                                                                                                                                                  | Example                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1.1  | An operator can create, list, view, and edit plans. A plan has a unique name, a user limit of at least 1, and a grace period in days.                                                                        | _Omar creates "Basic" with 10 users and 14 grace days. Creating a second plan named "basic" is rejected with 409 `PLAN_NAME_TAKEN`._                                                                     |
| R1.2  | Editing a plan never changes existing subscriptions.                                                                                                                                                         | _Al-Noor is on Basic (10 users). Omar edits Basic to 8 users. Al-Noor's limit stays 10; a tenant assigned Basic afterwards gets 8._                                                                      |
| R1.3  | An operator creates a tenant, its subscription, and its first Tenant Admin in one atomic action.                                                                                                             | _Omar creates Al-Noor on Basic from 2026-11-01 to 2027-10-31 with admin `sara@alnoor.sa`. If the email already belongs to another user, nothing is created: no tenant, no subscription, no user._        |
| R1.4  | The first Tenant Admin's initial password is generated by the system, shown once in the creation response, and works for tenant login.                                                                       | _The response contains a random initial password. Omar passes it to Sara, who logs in at `/auth/login`. Repeating `GET /operator/tenants/:id` never shows it again._                                     |
| R1.5  | Every tenant always has exactly one subscription.                                                                                                                                                            | _Two operators change Al-Noor's subscription at the same moment: the changes are applied one after the other; Al-Noor never has two subscriptions or none._                                              |
| R1.6  | An operator can renew, extend, change, or end a tenant's subscription by setting its plan and period; the previous terms are recorded in the audit log.                                                      | _Omar extends Al-Noor's end date to 2028-10-31 and moves it to Professional. Al-Noor's audit log has `subscription.changed` with the old terms (Basic, 10 users, ending 2027-10-31) and the new ones._   |
| R1.7  | The subscription state is derived from today's date in Saudi Arabia: Active through the end date, Grace for the copied number of grace days after it, Read-only after that.                                  | _Al-Noor's Basic subscription ends 2027-10-31 with 14 grace days: Active on 2027-10-31, Grace from 2027-11-01 to 2027-11-14, Read-only from 2027-11-15._                                                 |
| R1.8  | Renewal returns a tenant to Active immediately.                                                                                                                                                              | _Al-Noor is Read-only on 2027-11-20. Omar sets the end date to 2028-10-31; Sara's very next request is treated as Active._                                                                               |
| R1.9  | In Read-only, tenant users can still log in, log out, and read, but every other state-changing tenant request is rejected.                                                                                   | _Sara, in Read-only, can open `GET /subscription`, but any `POST`, `PUT`, `PATCH`, or `DELETE` on a tenant route other than logout returns 403 `SUBSCRIPTION_READ_ONLY`._                                |
| R1.10 | Routes can declare that they need an Active subscription; in Grace those routes are rejected.                                                                                                                | _Phase 6's "submit request" route declares it. In Grace, Khalid's submission returns 403 `SUBSCRIPTION_NOT_ACTIVE`, while acting on an in-progress request still works._                                 |
| R1.11 | Every tenant user can see the subscription state; Tenant Admins can see the plan, period, limit, and usage.                                                                                                  | _`GET /auth/session` tells Sara's browser the tenant is in Grace until 2027-11-14, so it shows a warning banner. `GET /subscription` shows "Basic, 7 of 10 users"._                                      |
| R1.12 | Adding an active user beyond the subscription's user limit is rejected, including under concurrent creation.                                                                                                 | _Al-Noor has 9 of 10 users. Two admins create a user at the same moment: exactly one succeeds, the other gets 409 `USER_LIMIT_REACHED`._                                                                 |
| R1.13 | A downgrade below the current user count is allowed; existing users keep working, and new users are blocked until the count is within the limit.                                                             | _Al-Rashid has 30 active users and moves to Basic (10). All 30 keep logging in. Creating user 31 fails, and keeps failing until fewer than 10 users are active._                                         |
| R1.14 | Every operator write is recorded in `audit_log`: plan changes as platform-level entries (no tenant), tenant creation and subscription changes as entries of the affected tenant, with the operator as actor. | _Omar edits Basic: `audit_log` has `plan.updated` with no tenant and with before and after values. Omar changes Al-Noor's subscription: Al-Noor's audit log has `subscription.changed` with actor Omar._ |
| R1.15 | Tenant-realm code cannot create tenants, change subscriptions, read other tenants' data, or read or write platform-level audit entries, even through a bug.                                                  | _A future bug runs `UPDATE subscriptions ...` from a tenant route in Al-Noor's context; the database rejects it._                                                                                        |
| R1.16 | Every endpoint declares the permission it requires.                                                                                                                                                          | _`POST /operator/plans` requires `platform.plan.create`; `GET /subscription` requires `subscription.view`._                                                                                              |

## 4. Design

### 4.1 Data model

The data layer adds one table for plans, one row per tenant for its subscription, and one rule that lets operator code see across tenants.
Everything else is unchanged from Phase 0.

#### One rule for platform access

Phase 0 made every tenant table answer only to `app_current_tenant()`.
That is right for Sara, but Omar must create tenants, list all of them, and record plan edits that belong to no tenant.

Operator code opens a **platform transaction**, which sets a second transaction-local setting, `app.platform = 'on'`, and no tenant:

```ts
await withPlatformTx(db, async (tx) => { ... });
```

One SQL function decides which rows a transaction may see, and every policy on the four shared tables uses it:

```sql
-- True only inside a platform transaction. Never raises.
CREATE FUNCTION app_platform_context() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.platform', true), '') = 'on'
$$;

-- Platform transaction: every row. Tenant transaction: that tenant's rows only.
CREATE FUNCTION app_row_visible(row_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN app_platform_context() THEN true
    ELSE row_tenant = app_current_tenant()
  END
$$;
```

"Platform transaction only" in the table below means the policy `app_platform_context()`.

`CASE` evaluates its branches in order, so a platform transaction never calls `app_current_tenant()`, and a tenant transaction with no tenant still raises exactly as in Phase 0 (R0.8).
A platform-level audit entry (`tenant_id IS NULL`) is never visible to a tenant transaction, because `NULL = app_current_tenant()` is never true.

Only `src/modules/platform/` may import `withPlatformTx`; an architecture test enforces it (step 1.1).

Why a setting and not a separate database login for operators: a second role would need its own connection string, pool, and approval from the KSA hosting provider.
RLS here guards against bugs, not a compromised application (which can already set any tenant context), and against bugs "only platform modules open a platform transaction" is enforced by the test.

#### Tables

| Table           | Change                       | RLS rule                                                                               | `watheeq_app` privileges                                   |
| --------------- | ---------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `tenants`       | none                         | `SELECT`: `app_row_visible(id)`. `INSERT`: platform transaction only.                  | `SELECT`, `INSERT`                                         |
| `users`         | none                         | `SELECT`, `INSERT`, `UPDATE`: `app_row_visible(tenant_id)`                             | unchanged (`SELECT`, `INSERT`, `UPDATE`)                   |
| `audit_log`     | `tenant_id` becomes nullable | `SELECT`, `INSERT`: `app_row_visible(tenant_id)`                                       | unchanged (`SELECT`, `INSERT`), so still append-only (T15) |
| `subscriptions` | new                          | `SELECT`: `app_row_visible(tenant_id)`. `INSERT`, `UPDATE`: platform transaction only. | `SELECT`, `INSERT`, `UPDATE`                               |
| `plans`         | new                          | none: a platform table, like `operators`                                               | `SELECT`, `INSERT`, `UPDATE`                               |

The existing Phase 0 policies on `tenants`, `users`, and `audit_log` are replaced by these.
`user_sessions` keeps its Phase 0 policy: operators never touch tenant sessions.

**`plans`**:

| Column       | Type          | Notes                                                      |
| ------------ | ------------- | ---------------------------------------------------------- |
| `id`         | `uuid` PK     |                                                            |
| `name`       | `text`        | Not null, 1-100 characters. Unique index on `lower(name)`. |
| `user_limit` | `integer`     | Not null, check `>= 1`.                                    |
| `grace_days` | `integer`     | Not null, check `between 0 and 365`.                       |
| `created_at` | `timestamptz` |                                                            |
| `updated_at` | `timestamptz` |                                                            |

Tenant code has no reason to read plans (its subscription carries a copy of the terms), and plan names and limits are not tenant data, so the table needs no RLS.

**`subscriptions`**: one row per tenant, updated in place.

| Column       | Type          | Notes                                                                                                                       |
| ------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `tenant_id`  | `uuid` PK     | FK to `tenants`, declared inline (T14). The primary key makes "exactly one subscription per tenant" (R1.5) a database fact. |
| `plan_id`    | `uuid`        | FK to `plans`. Which plan the terms were copied from.                                                                       |
| `plan_name`  | `text`        | Copied at assignment (D14).                                                                                                 |
| `user_limit` | `integer`     | Copied at assignment (D14). Check `>= 1`.                                                                                   |
| `grace_days` | `integer`     | Copied at assignment (D14). Check `>= 0`.                                                                                   |
| `start_date` | `date`        | Not null.                                                                                                                   |
| `end_date`   | `date`        | Not null. Check `end_date >= start_date`.                                                                                   |
| `updated_at` | `timestamptz` |                                                                                                                             |

The terms are copies, so editing a plan never changes a subscription (R1.2, D14).
Each change writes the old and new terms to `audit_log`, which is the history (R1.6).

**`audit_log`** (changed): `tenant_id IS NULL` marks a platform-level entry (Q2).
New check: `tenant_id IS NOT NULL OR actor_type <> 'user'`, since a tenant user always acts inside a tenant.

| Action                                | `tenant_id`       | Resource                                            |
| ------------------------------------- | ----------------- | --------------------------------------------------- |
| `plan.created`, `plan.updated`        | `NULL` (platform) | plan                                                |
| `tenant.created`                      | the new tenant    | tenant                                              |
| `user.created` (first Tenant Admin)   | the new tenant    | user                                                |
| `subscription.assigned` (at creation) | the tenant        | subscription                                        |
| `subscription.changed`                | the tenant        | subscription; `details` holds the old and new terms |

`audit(tx, ctx, entry)` (unchanged) takes the tenant from the tenant context.
`platformAudit(tx, ctx, entry)` (new) takes `tenantId` (a tenant or `null`) from the entry, because a platform transaction has no tenant context.

#### User-limit check

Users are counted as **active users** (`is_active = true`) (Q4).
One service function, `assertSeatAvailable(tx, tenantId)`, does the check, and every path that adds an active user calls it in the same transaction, before the insert or reactivation:

1. Take `pg_advisory_xact_lock` keyed by the tenant ID.
2. Read the subscription's `user_limit` and count the tenant's active users.
3. If the count is already at or above the limit, throw 409 `USER_LIMIT_REACHED`.

Phase 1 calls it when creating the first Tenant Admin; Phase 2 calls it when creating or reactivating a user.

Why the lock: without it, two admins can both pass the check before either commits:

1. Al-Noor has 9 of 10 users.
2. Admin A's transaction counts 9 and inserts user 10.
3. Before A commits, admin B's transaction counts 9 (it cannot see A's uncommitted row) and inserts user 11.
4. Both commit: 11 users on a 10-user plan.

With the lock, B waits at step 3 until A commits, then counts 10 and is rejected.
The lock is per tenant, so Al-Noor never waits for Al-Rashid.
A subscription change takes the same lock, so a downgrade and a user creation for one tenant cannot interleave.

Over-limit after a downgrade (R1.13, D15) needs no extra state: the check runs only when a user is added or reactivated, so Al-Rashid's 30 existing users are untouched, and user 31 is rejected until the active count drops below 10.

### 4.2 API

All operator routes require an operator session, CSRF on unsafe methods (Phase 0), and send `Cache-Control: no-store`.
Dates are `YYYY-MM-DD` strings.

| Method | Path                                       | Realm    | Permission                     | Request                                                            | Responses                                                                                                                                                           |
| ------ | ------------------------------------------ | -------- | ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/operator/plans`                          | operator | `platform.plan.create`         | `{name, userLimit, graceDays}`                                     | 201 `{plan}`; 400; 409 `PLAN_NAME_TAKEN`                                                                                                                            |
| GET    | `/operator/plans`                          | operator | `platform.plan.view`           | none                                                               | 200 `{plans:[...]}` ordered by name                                                                                                                                 |
| GET    | `/operator/plans/:planId`                  | operator | `platform.plan.view`           | none                                                               | 200 `{plan}`; 404                                                                                                                                                   |
| PATCH  | `/operator/plans/:planId`                  | operator | `platform.plan.update`         | any of `{name, userLimit, graceDays}`                              | 200 `{plan}`; 400; 404; 409 `PLAN_NAME_TAKEN`                                                                                                                       |
| POST   | `/operator/tenants`                        | operator | `platform.tenant.create`       | `{name, admin:{email}, subscription:{planId, startDate, endDate}}` | 201 `{tenant, subscription, admin:{id, email, initialPassword}}`; 400; 409 `EMAIL_TAKEN`                                                                            |
| GET    | `/operator/tenants`                        | operator | `platform.tenant.view`         | none                                                               | 200 `{tenants:[{id, name, createdAt, subscription:{planName, userLimit, startDate, endDate, graceEndsOn, state}, usage:{activeUsers, overLimit}}]}` ordered by name |
| GET    | `/operator/tenants/:tenantId`              | operator | `platform.tenant.view`         | none                                                               | 200 `{tenant, subscription, usage:{activeUsers, userLimit, overLimit}}`; 404                                                                                        |
| PUT    | `/operator/tenants/:tenantId/subscription` | operator | `platform.subscription.update` | `{planId, startDate, endDate, reason?}`                            | 200 `{subscription, usage}`; 400; 404                                                                                                                               |
| GET    | `/subscription`                            | tenant   | `subscription.view`            | none                                                               | 200 `{subscription:{planName, userLimit, startDate, endDate, graceEndsOn, state}, usage:{activeUsers, userLimit, overLimit}}`                                       |
| POST   | `/auth/login`                              | tenant   | none (public)                  | (changed)                                                          | Response gains `subscription:{state, endDate, graceEndsOn}`                                                                                                         |
| GET    | `/auth/session`                            | tenant   | any authenticated user         | (changed)                                                          | Response gains `subscription:{state, endDate, graceEndsOn}`                                                                                                         |

#### Permissions

| Permission                     | Realm    | Allows                                                              | Held by in the MVP          |
| ------------------------------ | -------- | ------------------------------------------------------------------- | --------------------------- |
| `platform.plan.view`           | operator | List and view plans.                                                | Every operator              |
| `platform.plan.create`         | operator | Create a plan.                                                      | Every operator              |
| `platform.plan.update`         | operator | Edit a plan.                                                        | Every operator              |
| `platform.tenant.view`         | operator | List and view tenants, their subscriptions, and usage.              | Every operator              |
| `platform.tenant.create`       | operator | Create a tenant with its subscription and first Tenant Admin.       | Every operator              |
| `platform.subscription.update` | operator | Renew, extend, change, or end a tenant's subscription.              | Every operator              |
| `subscription.view`            | tenant   | View the tenant's subscription and usage. Scope: organization only. | Tenant Admin (from Phase 3) |

The `platform.` prefix keeps operator permissions apart from the tenant catalog, so a tenant role can never be given one (T6).

Enforcement:

- **Operator routes:** each route declares its permission with `requirePlatformPermission(...)`. In the MVP every operator holds every platform permission, so the check passes for any authenticated operator; operator roles (after the MVP) change only how the check decides, not the routes.
- **Tenant routes:** `GET /subscription` declares `subscription.view`. Phase 3 adds the permission catalog and the check; until then the route is open to any authenticated tenant user. Its content (plan name, limit, user count) is low-sensitivity, so this temporary gap is accepted.
- **Login and session** need no permission. Every user sees the subscription state, because the client must explain why actions are disabled in Grace or Read-only.

#### Validation

- `name` (plan, tenant): trimmed, 1-100 characters.
- `userLimit`: integer 1-100,000. `graceDays`: integer 0-365.
- `startDate` must not be after today; `endDate >= startDate`. A past `endDate` is allowed: it is how an operator ends a subscription early.
- `planId` that does not exist: 400 `VALIDATION_FAILED` with detail `{path:"subscription.planId", code:"unknown_plan"}` (or `planId` for `PUT`).
- `admin.email`: normalized like login (trim, lowercase), valid email format.
- Path IDs that are not UUIDs: 404 `NOT_FOUND`, same as unknown IDs.

#### New error codes

| HTTP | Code                      | When                                                            |
| ---- | ------------------------- | --------------------------------------------------------------- |
| 403  | `SUBSCRIPTION_READ_ONLY`  | Unsafe tenant request while Read-only (R1.9).                   |
| 403  | `SUBSCRIPTION_NOT_ACTIVE` | Route requires Active, tenant is in Grace or Read-only (R1.10). |
| 403  | `FORBIDDEN`               | The principal lacks the route's permission.                     |
| 409  | `PLAN_NAME_TAKEN`         | Plan name exists (case-insensitive).                            |
| 409  | `EMAIL_TAKEN`             | First Tenant Admin email belongs to an existing user.           |
| 409  | `USER_LIMIT_REACHED`      | Adding an active user would exceed the limit (R1.12).           |

`initialPassword` is added to the logger's redaction paths, so it can never reach a log line.

### 4.3 Key flows and state transitions

#### Subscription state

```
              today > end_date                 today > end_date + grace_days
   Active ───────────────────────▶ Grace ─────────────────────────────────────▶ Read-only
     ▲                               │                                               │
     └──────────────── operator sets an end_date >= today ───────────────────────────┘
```

The state is never stored.
It is computed by one pure function, `subscriptionState({endDate, graceDays}, today)`, where `today` is the database's current date in `Asia/Riyadh` (`(now() AT TIME ZONE 'Asia/Riyadh')::date`), returned by the same query that loads the subscription.
`graceEndsOn = endDate + graceDays`.

Why derive instead of storing: a stored state needs a job to flip it at midnight, and the job runner arrives only in Phase 7.
A derived state can never be stale, and renewal returns a tenant to Active on the very next request (R1.8).
Why the database clock: every application instance then agrees on what "today" is.

A `grace_days` of 0 moves a tenant from Active straight to Read-only.

#### Create a tenant (operator)

1. Validate the body.
2. Generate an initial password (24 random bytes, base64url) and hash it (argon2id, as at login).
3. In one platform transaction:
   1. Load the plan; unknown plan → 400.
   2. Insert the tenant, then its subscription with the plan's terms copied.
   3. `assertSeatAvailable`, then insert the first user (Sara). Every plan allows at least 1 user, so this passes.
   4. Audit `tenant.created`, `subscription.assigned`, `user.created`.
4. A unique violation on the email rolls everything back and returns 409 `EMAIL_TAKEN` (R1.3).
5. Return 201 with the initial password.

#### Change a subscription (operator)

1. Validate the body.
2. In one platform transaction:
   1. Load the plan; unknown plan → 400.
   2. Take the tenant's seat lock (the same lock as `assertSeatAvailable`).
   3. Load the subscription; none (unknown tenant) → 404.
   4. Update it with the plan's current terms and the new dates.
   5. Audit `subscription.changed` with the old and new terms and the optional reason.
3. Return the subscription and usage; `overLimit` tells Omar if the change made the tenant over-limit (R1.13).

Renew, extend, change plan, and end early are all this one operation with different values.
The lock runs two concurrent changes for Al-Noor one after the other (R1.5).

#### Subscription guard (tenant routes)

A middleware mounted after `requireUser` on every tenant router loads the subscription state (one primary-key lookup) and attaches it to the request.

- Read-only: unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) are rejected with 403 `SUBSCRIPTION_READ_ONLY`, except `POST /auth/logout`.
- Grace and Active: no general restriction.
- `requireActiveSubscription`: a route-level middleware for routes that need Active; Phase 6 attaches it to request submission.

Why default-deny by method in Read-only: every future write route is blocked without its author having to remember.
A read route that uses `POST` (for example a complex search) must be allow-listed explicitly, which is the safe direction to fail.

Read-only does not revoke sessions: the MVP says Read-only users can still view their data.

### 4.4 Module structure

```
src/
  db/
    platform-tx.ts                  withPlatformTx
    schema/plans.ts, subscriptions.ts
  audit/
    platform-audit.ts               platformAudit(tx, ctx, entry)
    context.ts                      auditContext(req): actor from the request's principal, plus request ID
  middleware/
    subscription-guard.ts           Read-only guard and requireActiveSubscription
    require-platform-permission.ts  requirePlatformPermission(permission)
  modules/
    platform/
      plans/                        routes, controller, service, repository
      tenants/                      tenant creation, list, detail, subscription change
    subscriptions/
      subscription-state.ts         pure state function
      seats.ts                      assertSeatAvailable(tx, tenantId)
      subscription.routes.ts, .controller.ts, .service.ts, .repository.ts   GET /subscription
    auth/tenant/                    (changed) session and login responses carry the state
db/migrations/                      app_row_visible, policy replacements, nullable audit tenant, plans, subscriptions
test/
  architecture.test.ts              only src/modules/platform/ imports platform-tx
```

`audit/context.ts` answers Phase 0.5's open item: the audit context is built per request from the authenticated principal, for both realms.

## 5. Edge Cases and Failure Behavior

| Scenario                                                                                                 | Expected behavior                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Omar creates Al-Noor with `sara@alnoor.sa`, which already belongs to an Al-Rashid user.                  | Unique violation; the whole transaction rolls back; 409 `EMAIL_TAKEN`; no tenant, subscription, or audit row remains (R1.3).                                              |
| Omar double-clicks "Create tenant".                                                                      | The second request hits the same admin email and gets 409 `EMAIL_TAKEN`; exactly one tenant exists.                                                                       |
| Al-Noor has 9 of 10 users; two user creations run concurrently.                                          | The seat lock serializes them; the second counts 10 and gets 409 `USER_LIMIT_REACHED` (R1.12).                                                                            |
| Omar downgrades Al-Noor to 5 users while an admin is creating user 10.                                   | Both take the seat lock. If the creation goes first, the downgrade returns `overLimit: true`. If the downgrade goes first, the creation sees the limit 5 and is rejected. |
| A deactivated Al-Noor user is reactivated while the tenant is at its limit.                              | `assertSeatAvailable` rejects it with 409 `USER_LIMIT_REACHED` (applies once Phase 2 adds reactivation).                                                                  |
| Two operators change Al-Noor's subscription at the same moment.                                          | The seat lock runs them one after the other; the second change is the one in effect; both are in the audit log (R1.5, R1.6).                                              |
| Omar edits Basic's limit from 10 to 8.                                                                   | No subscription row changes; only `plans` and a platform-level `audit_log` entry (R1.2).                                                                                  |
| Al-Noor's end date is 2027-10-31 and a request arrives at 23:59 Riyadh time (20:59 UTC) on that date.    | `today` is computed in `Asia/Riyadh`, so the state is Active. One minute later it is Grace.                                                                               |
| Omar sets an end date in the past to end a subscription early.                                           | Allowed; the state follows from the date (Grace or Read-only); audited with the reason.                                                                                   |
| Omar sets a start date in the future.                                                                    | 400. A subscription always starts no later than today, so there is no "not yet started" state.                                                                            |
| A tenant-route bug inserts a tenant or updates a subscription.                                           | Not a platform transaction; the policy rejects it (R1.15).                                                                                                                |
| A tenant-route bug runs `SELECT * FROM subscriptions` or `SELECT * FROM audit_log` in Al-Noor's context. | Only Al-Noor's rows; platform-level audit entries never match (R1.15).                                                                                                    |
| Tenant-route code queries `users` with no tenant context.                                                | `app_current_tenant()` raises, exactly as in Phase 0 (R0.8).                                                                                                              |
| A file outside `src/modules/platform/` imports `withPlatformTx`.                                         | The architecture test fails.                                                                                                                                              |
| Al-Noor is Read-only; Sara posts to `/auth/logout`.                                                      | Allowed; logout must always work.                                                                                                                                         |
| Al-Noor is Read-only; Sara opens `GET /subscription`.                                                    | 200. Reads are allowed.                                                                                                                                                   |
| Al-Noor is Read-only; Sara logs in.                                                                      | Allowed; the response shows `state: "read_only"` so the client can explain why actions are disabled.                                                                      |
| A plan is edited to a 0-user limit, or a subscription change specifies `endDate < startDate`.            | 400 `VALIDATION_FAILED`; database checks reject the same values as a second safeguard.                                                                                    |
| `GET /operator/tenants/not-a-uuid`.                                                                      | 404 `NOT_FOUND`, not a database cast error.                                                                                                                               |

## 6. Security and Authorization

- **Trust boundaries:** every operator and tenant body is validated with zod before any logic runs. Plan and subscription values have database check constraints too.
- **Tenant isolation:** unchanged for tenant-realm code: one tenant's rows only, and a missing tenant context raises. `subscriptions` uses forced RLS like every other tenant table.
- **Platform access:** only a platform transaction sees across tenants, and only on `tenants`, `users`, `subscriptions`, and `audit_log`. Only `src/modules/platform/` can open one (enforced by a test). Only a platform transaction can create tenants or write subscriptions.
- **Privilege minimization:** `watheeq_app` gets no `DELETE` on any new table; `audit_log` stays append-only.
- **Authorization:** every route declares its permission (4.2). Operator permissions are held by every operator in the MVP. `subscription.view` is enforced from Phase 3; until then any tenant user can read the subscription summary.
- **Initial password:** 192 bits of randomness, stored only as an argon2id hash, returned once, redacted from logs, sent with `no-store`. Known gap: Omar sees it, until Phase 2 adds a forced password change.
- **Audit:** every operator write is audited in the same transaction (T8): plan changes as platform-level entries, tenant and subscription changes as entries of that tenant.

## 7. Implementation Steps

| Step                                  | Objective                                                                                | Delivers                                                                                                                                                                                                                                                                      | Acceptance criteria                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Verification                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 Platform access and audit         | Give operator code a safe, explicit way to reach platform data, and a place to audit it. | `app_row_visible()`, replaced policies on `tenants`, `users`, `audit_log`; `INSERT` on `tenants`; nullable `audit_log.tenant_id` with its check; `withPlatformTx`; `platformAudit()`; `auditContext(req)`; `requirePlatformPermission`; `FORBIDDEN` error; architecture test. | A platform transaction sees every tenant, user, and audit entry, and can insert a tenant. A tenant transaction sees only its own rows, never a platform-level audit entry, cannot insert a tenant, and still raises without a tenant context. `UPDATE` and `DELETE` on `audit_log` still fail; a `user` actor without a tenant is rejected. The architecture test fails on an import from outside `src/modules/platform/`. All Phase 0 tests still pass.                 | Integration tests per criterion; architecture test shown failing on a planted import, then passing.                                          |
| 1.2 Plans                             | Operators manage plans.                                                                  | `plans` table and grants; plan routes, controller, service, repository; `plan.created` and `plan.updated` audit.                                                                                                                                                              | R1.1: create, list, view, edit work; duplicate name (any case) returns 409; invalid values return 400. Each write leaves one platform-level `audit_log` row with before and after values. Each route declares its permission.                                                                                                                                                                                                                                            | Integration tests per criterion.                                                                                                             |
| 1.3 Tenants and subscriptions         | Operators create tenants and see them.                                                   | `subscriptions` table, RLS, grants; state function; `assertSeatAvailable`; `POST /operator/tenants`, `GET /operator/tenants`, `GET /operator/tenants/:tenantId`; initial password and its redaction.                                                                          | R1.3, R1.4, R1.7: creation writes tenant, subscription with copied terms, first user, and three audit rows atomically; a taken email leaves nothing behind. The first Tenant Admin logs in with the returned password. The list shows each tenant's state and usage. The state function matches R1.7 at each boundary date, including the Riyadh midnight case. The initial password never appears in logs. A tenant transaction cannot insert or update a subscription. | Unit tests for the state function at every boundary; integration tests for creation, rollback, login, list, RLS, and log capture.            |
| 1.4 Subscription changes              | Operators renew, extend, change, or end subscriptions.                                   | `PUT /operator/tenants/:tenantId/subscription`, `subscription.changed` audit.                                                                                                                                                                                                 | R1.2, R1.5, R1.6, R1.8: a change copies the current plan terms; editing a plan afterwards changes no subscription; concurrent changes are applied one after the other; the audit entry holds old and new terms; a Read-only tenant is Active again on its next request after renewal.                                                                                                                                                                                    | Integration tests per criterion, including a concurrent-change test on two connections.                                                      |
| 1.5 User-limit enforcement            | The user limit holds under concurrency and after a downgrade.                            | Seat lock in subscription changes; tests of `assertSeatAvailable` as Phase 2 will use it.                                                                                                                                                                                     | R1.12, R1.13: adding a user over the limit fails; two concurrent additions for the last seat produce exactly one user; reactivating over the limit fails; after a downgrade below the count, existing users still log in and a new user is rejected until the count is within the limit; one tenant's lock never blocks another tenant.                                                                                                                                  | Integration tests on two real connections with a controlled interleaving (the first transaction holds the lock until the second is waiting). |
| 1.6 Tenant-side state and enforcement | Tenants see and are governed by their subscription.                                      | Subscription guard, `requireActiveSubscription`, `GET /subscription`, state in login and session responses.                                                                                                                                                                   | R1.9, R1.10, R1.11: in Read-only, a test `POST` route returns 403 `SUBSCRIPTION_READ_ONLY`, logout still works, reads still work; a route with `requireActiveSubscription` returns 403 `SUBSCRIPTION_NOT_ACTIVE` in Grace and works in Active; login and session responses carry the state; `GET /subscription` returns plan, period, limit, and active user count.                                                                                                      | Integration tests with subscription dates set in the database to reach each state; test-only routers through `deps.routers`.                 |

**Suggested rounds** (per the agreed way of working): round 1 is step 1.1; round 2 is 1.2; round 3 is 1.3; round 4 runs 1.4, 1.5, and 1.6 in parallel, since each depends only on 1.3.
Each round ends with a review gate.

## 8. Test Plan

All integration tests run against real PostgreSQL connected as `watheeq_app`, as in Phase 0.
Dates are controlled by writing subscription dates relative to the database's current Riyadh date, not by changing clocks.

| Requirement  | Test type                                                                                                  | Covered in step |
| ------------ | ---------------------------------------------------------------------------------------------------------- | --------------- |
| R1.1, R1.2   | Integration: plan CRUD, duplicate names, validation, audit rows; plan edit leaves subscriptions unchanged. | 1.2, 1.4        |
| R1.3, R1.4   | Integration: atomic creation, rollback on taken email, first admin login, log redaction.                   | 1.3             |
| R1.5, R1.6   | Integration: change, audit of old and new terms, concurrent changes on two connections.                    | 1.4             |
| R1.7, R1.8   | Unit: state function at each boundary. Integration: renewal from Read-only.                                | 1.3, 1.4        |
| R1.9-R1.11   | Integration: guard per state, logout allowed, active-only route, session and subscription responses.       | 1.6             |
| R1.12, R1.13 | Integration: limit, concurrent last seat, reactivation, downgrade over-limit.                              | 1.5             |
| R1.14        | Integration: each operator write leaves the expected audit row with the expected `tenant_id`.              | 1.2-1.4         |
| R1.15        | Integration: tenant transactions attempting each forbidden operation.                                      | 1.1, 1.3        |
| R1.16        | Integration: each route rejects with 403 `FORBIDDEN` when its permission check fails (forced in a test).   | 1.1-1.4, 1.6    |

## 9. Open Questions

| #   | Question                                                                                               | Options                                                                                                                                                                                                         | Resolution                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | How does the application create tenants, and how do operators read across tenants? (Phase 0 open item) | (a) Platform setting `app.platform` checked by RLS policies. (b) A separate `LOGIN` role for the operator realm with its own pool. (c) `SECURITY DEFINER` functions for each operator operation.                | **Resolved 2026-10-20: (a).** Tenants are created by the operator through the UI, via `POST /operator/tenants`. Simplified on 2026-10-20 to one rule, `app_row_visible()` (4.1). |
| Q2  | Where are operator actions audited? (Phase 0 open item)                                                | (a) Tenant-affecting actions in that tenant's `audit_log`, plan actions in a separate platform table. (b) Everything operator-made in a separate platform table. (c) One `audit_log` with nullable `tenant_id`. | **Resolved 2026-10-20: (c).** One `audit_log`; `tenant_id IS NULL` marks a platform-level entry (4.1).                                                                           |
| Q3  | Grace period length and where it is defined (MVP open question 5).                                     | (a) Per plan, copied into the subscription like the user limit. (b) One platform-wide setting in configuration.                                                                                                 | **Resolved 2026-10-20: (a)** per plan, copied into the subscription.                                                                                                             |
| Q4  | Which users count against the user limit?                                                              | (a) Active users only; deactivating frees a seat, reactivating takes one. (b) All users ever created.                                                                                                           | **Resolved 2026-10-20: (a)** active users only.                                                                                                                                  |
| Q5  | Can an operator suspend a tenant independently of its subscription (MVP open question 7)?              | (a) Defer; ending the subscription early covers most cases. (b) Add a suspension that blocks all tenant logins now.                                                                                             | **Resolved 2026-10-20: (a)** deferred.                                                                                                                                           |
| Q6  | How does the first Tenant Admin get a password, with no email channel (D10)?                           | (a) Generated by the system, shown once to the operator. (b) Typed by the operator.                                                                                                                             | **Resolved 2026-10-20: (a)** generated, shown once.                                                                                                                              |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #     | Decision                                                                                                                                                                                                                                                | Rationale                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.1  | A platform transaction (`app.platform = 'on'`, opened only by `withPlatformTx` from `src/modules/platform/`) sees all rows of `tenants`, `users`, `subscriptions`, and `audit_log`; one function, `app_row_visible()`, expresses this for every policy. | One rule instead of per-table platform policies; `CASE` keeps `app_current_tenant()` unchanged for tenant code (Q1).                                                      |
| P1.2  | Only a platform transaction can insert tenants and insert or update subscriptions.                                                                                                                                                                      | Tenant-realm code cannot create tenants or change its own terms, even through a bug.                                                                                      |
| P1.3  | `plans` is a platform table without RLS, like `operators`.                                                                                                                                                                                              | It holds no tenant data, and tenant code has no reason to read it.                                                                                                        |
| P1.4  | One subscription row per tenant (`tenant_id` primary key), updated in place; the history is the audit log.                                                                                                                                              | "Exactly one subscription" becomes a database fact; no history table or superseding logic.                                                                                |
| P1.5  | Subscription state is derived from the dates and the database's current date in `Asia/Riyadh`; never stored.                                                                                                                                            | No job needed before Phase 7; never stale; renewal takes effect immediately.                                                                                              |
| P1.6  | The user limit is checked by `assertSeatAvailable(tx, tenantId)` under a per-tenant advisory lock, called by every path that adds an active user; subscription changes take the same lock.                                                              | Concurrent additions cannot exceed the limit; plain service code, easy to read and test. Every user-adding path must call it (Phase 2 tests cover create and reactivate). |
| P1.7  | Read-only blocks all unsafe tenant requests except logout by default; Active-only routes opt in with `requireActiveSubscription`.                                                                                                                       | Future write routes are protected without per-route effort.                                                                                                               |
| P1.8  | A subscription's start date is never after today; a past end date is allowed.                                                                                                                                                                           | Avoids a "not yet started" state; ending early needs no separate feature.                                                                                                 |
| P1.9  | The first Tenant Admin is created as a user in Phase 1; Phase 3 assigns the Tenant Admin role, and changes tenant creation to assign it.                                                                                                                | Roles do not exist before Phase 3; there is no production data before the MVP, so no backfill is needed.                                                                  |
| P1.10 | The audit context is built per request from the authenticated principal (`auditContext(req)`).                                                                                                                                                          | Resolves Phase 0.5's open item; one place builds actor and request ID for both realms.                                                                                    |
| P1.11 | One `audit_log` for both levels: `tenant_id IS NULL` is a platform-level entry; tenant-affecting operator actions carry the tenant's ID.                                                                                                                | Owner decision (Q2): a single audit history to query and operate.                                                                                                         |
| P1.12 | Grace period defined per plan (`grace_days`) and copied into each subscription.                                                                                                                                                                         | Owner decision (Q3); consistent with D14.                                                                                                                                 |
| P1.13 | Only active users count against the user limit.                                                                                                                                                                                                         | Owner decision (Q4): deactivating a leaver frees the seat.                                                                                                                |
| P1.14 | Operator suspension independent of the subscription is deferred; ending a subscription early covers the MVP.                                                                                                                                            | Owner decision (Q5); resolves MVP open question 7 for now.                                                                                                                |
| P1.15 | The first Tenant Admin's initial password is generated by the system and returned once.                                                                                                                                                                 | Owner decision (Q6): no weak operator-chosen passwords.                                                                                                                   |
| P1.16 | Every route declares a permission. Operator permissions use the `platform.` prefix and are held by every operator in the MVP; tenant permissions (`subscription.view`) are enforced from Phase 3.                                                       | Owner review: permissions must be explicit per resource; operator roles are outside the MVP.                                                                              |

Promote these to `MVP_SCOPE.md` or `TECHNICAL_DECISIONS.md` when the phase is implemented.

## 11. Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                | Reason                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 2026-10-19 | Initial draft.                                                                                                                                                                                                                                                                                                                                                                        | Phase 1 spec requested. |
| 2026-10-20 | Resolved Q1-Q6; replaced the separate platform audit table with a nullable `audit_log.tenant_id` (P1.11-P1.15).                                                                                                                                                                                                                                                                       | Owner review.           |
| 2026-10-20 | Simplified the data layer: one `app_row_visible()` rule instead of per-table platform policies and the `app_current_tenant()` change; one subscription row per tenant instead of history rows; `plans` without RLS; user-limit check in a service function instead of a trigger; dropped the history endpoint. Added a permission per endpoint and a permission table (R1.16, P1.16). | Owner review.           |
