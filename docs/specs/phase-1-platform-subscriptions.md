# Phase 1 Spec: Platform, Plans & Subscriptions

| Field                  | Value                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| **Status**             | Draft                                                                        |
| **Approved by / date** | _(set by the project owner only)_                                            |
| **Depends on**         | Phase 0 (`phase-0-foundations.md`), Phase 0.5 (`phase-0.5-refactor.md`)      |
| **Related decisions**  | MVP 3.1, 3.9, D11-D16; Technical T2, T4, T5, T7, T8, T11, T13, T14           |

---

## 1. Objective

Let a platform operator create tenants, define plans, and manage each tenant's subscription, and make the subscription govern what the tenant can do: Active, Grace, or Read-only, and how many users it may have.
It is needed now because every later phase runs inside a tenant that must first exist, and their write paths must respect the subscription state and user limit from the start.

## 2. Scope

**In scope:**

- Plans: create, list, view, edit (operator).
- Tenants: create a tenant with its subscription and its first Tenant Admin, list, view (operator).
- Email verification of the first Tenant Admin (`/auth/verify`, MVP D16).
- Subscriptions: renew, extend, change, or end (operator); view the subscription and usage (tenant).
- The permission each endpoint requires.
- Subscription states Active → Grace → Read-only, derived from dates, and their enforcement on tenant routes.
- User-limit enforcement that holds under concurrency, including the over-limit state after a downgrade.

**Out of scope (and where it is handled instead):**

- Creating, editing, and deactivating users through the API: Phase 2. Phase 1 delivers the user-limit check those endpoints must call.
- The Tenant Admin role, the permission catalog, and enforcing tenant permissions such as `subscription.view`: Phase 3.
- Operator roles and per-operator permissions: after the MVP. Every operator holds every platform permission (4.2).
- Blocking new request submission during Grace: the mechanism is delivered here; Phase 6 applies it.
- Effect of Read-only on SLA clocks and escalations (MVP open question 6): Phases 6 and 7.
- Subscription warning notifications: Phase 7. Phase 1 exposes the state in `/auth/me` so the client can show a banner.
- Payments, invoices, trials, feature gating, self-service plan changes: out of the MVP.
- Pagination of operator lists: added when lists grow.

## 3. Requirements

Example people: **Omar**, a platform operator; **Sara**, the first Tenant Admin of **Al-Noor**; **Khalid**, a user at **Al-Rashid**.
Example plans: **Basic** (10 users, 14 grace days) and **Professional** (50 users, 30 grace days).
All dates are calendar dates in Saudi Arabia (`Asia/Riyadh`).

| ID    | Requirement | Example |
| ----- | ----------- | ------- |
| R1.1  | An operator can create, list, view, and edit plans. A plan has a unique name, a user limit of at least 1, and a grace period in days. | _Omar creates "Basic" with 10 users and 14 grace days. A second plan named "basic" is rejected with 409 `PLAN_NAME_TAKEN`._ |
| R1.2  | Editing a plan never changes existing subscriptions. | _Omar edits Basic to 8 users. Al-Noor's limit stays 10; a tenant assigned Basic afterwards gets 8._ |
| R1.3  | An operator creates a tenant, its subscription, its first Tenant Admin, and the admin's membership in one atomic action. | _Omar creates Al-Noor on Basic with admin `sara@alnoor.sa`. If that email already belongs to a user, nothing is created._ |
| R1.4  | The first Tenant Admin verifies their email and sets their own password through the verification link; until then they cannot log in. The operator can resend the link, which invalidates older links. | _Sara receives an email, follows the link, chooses her password, and can then log in. Omar never sees a password. Before verifying, Sara's login attempts get 401._ |
| R1.5  | Every tenant always has exactly one subscription. | _Two operators change Al-Noor's subscription at the same moment: the changes run one after the other; Al-Noor never has two or none._ |
| R1.6  | An operator can renew, extend, change, or end a subscription by setting its plan and period; the previous terms are recorded in the audit log. | _Omar moves Al-Noor to Professional ending 2028-10-31. The audit log has `subscription.changed` with the old and new terms._ |
| R1.7  | The state is derived from today's date in Saudi Arabia: Active through the end date, Grace for the copied number of grace days after it, Read-only after that. | _End 2027-10-31, 14 grace days: Active on 2027-10-31, Grace 2027-11-01 to 2027-11-14, Read-only from 2027-11-15._ |
| R1.8  | Renewal returns a tenant to Active immediately. | _Al-Noor is Read-only; Omar sets a later end date; Sara's next request is treated as Active._ |
| R1.9  | In Read-only, tenant users can still log in, log out, refresh, and read, but every other state-changing tenant request is rejected. | _Any `POST`, `PUT`, `PATCH`, or `DELETE` on a tenant route other than auth returns 403 `SUBSCRIPTION_READ_ONLY`._ |
| R1.10 | Routes can declare that they need an Active subscription; in Grace those routes are rejected. | _In Grace, Khalid's submission returns 403 `SUBSCRIPTION_NOT_ACTIVE`._ |
| R1.11 | Every tenant user can see the subscription state; Tenant Admins can see plan, period, limit, and usage. | _`GET /auth/me` tells Sara's browser the tenant is in Grace; `GET /subscription` shows "Basic, 7 of 10 users"._ |
| R1.12 | Adding an active member beyond the user limit is rejected, including under concurrent creation. | _Al-Noor has 9 of 10 users; two admins add a user at the same moment: one succeeds, the other gets 409 `USER_LIMIT_REACHED`._ |
| R1.13 | A downgrade below the current user count is allowed; existing users keep working and new users are blocked until the count is within the limit. | _Al-Rashid has 30 users and moves to Basic (10). All 30 keep working; user 31 is rejected._ |
| R1.14 | Every operator write is audited: plan changes as platform-level entries (no tenant), tenant creation and subscription changes as entries of that tenant, with the operator as actor. | _Omar edits Basic: `audit_log` has `plan.updated` with a null tenant._ |
| R1.15 | Tenant users cannot call operator endpoints, and tenant endpoints only ever return the caller's tenant data. | _Sara calls `GET /operator/tenants` and gets 403 `FORBIDDEN`._ |
| R1.16 | Every endpoint declares the permission it requires. | _`POST /operator/plans` requires `platform.plan.create`._ |

## 4. Design

### 4.1 Data model

#### Operator access

There is no database-level platform mode (T2).
Operator endpoints are protected at the route: `authenticate()`, then `requireRole('operator')`, then `requirePlatformPermission(...)`.
Repositories in `src/modules/platform/` may query across tenants; every other module's tenant-data repository filters by the tenant from the access token (Phase 0, 4.1).

#### Unique values

Repositories never catch (Phase 0.5, 0.5-6).
A duplicate plan name, tenant slug, or admin email reaches the error handler as a unique violation, and the central constraint map in `src/http/errors.ts` turns it into the 409 code:

| Constraint | Code |
| ---------- | ---- |
| `plans_name_lower_unique` (unique index on `lower(name)`) | `PLAN_NAME_TAKEN` |
| `tenants_slug_unique` | `SLUG_TAKEN` |
| `users_email_unique` (exists) | `EMAIL_TAKEN` |

Because tenant creation runs in one transaction, the violation also rolls back everything inserted before it (R1.3).

#### Tables

**`plans`**: platform data, no `tenant_id`.

| Column       | Type          | Notes |
| ------------ | ------------- | ----- |
| `id`         | `uuid` PK     | |
| `name`       | `text`        | Not null, 1-100 characters. Unique index on `lower(name)`. |
| `user_limit` | `integer`     | Not null, check `>= 1`. |
| `grace_days` | `integer`     | Not null, check `between 0 and 365`. |
| `created_at`, `updated_at` | `timestamptz` | |

**`subscriptions`**: one row per tenant, updated in place.

| Column       | Type      | Notes |
| ------------ | --------- | ----- |
| `tenant_id`  | `uuid` PK | FK to `tenants`. The primary key makes "exactly one subscription" (R1.5) a database fact. |
| `plan_id`    | `uuid`    | FK to `plans`. Which plan the terms were copied from. |
| `plan_name`, `user_limit`, `grace_days` | | Copied at assignment (D14). Checks `user_limit >= 1`, `grace_days >= 0`. |
| `start_date`, `end_date` | `date` | Not null. Check `end_date >= start_date`. |
| `updated_at` | `timestamptz` | |

Each change writes the old and new terms to `audit_log`, which is the history (R1.6).

**`users`** (changed):

- `email_verified_at timestamptz`: null until verified. The `operator:create` CLI sets it at creation.
- `password_hash` becomes nullable: Sara has no password until she verifies (Q6).
- Check `email_verified_at IS NULL OR password_hash IS NOT NULL`: a verified user always has a password.

**`email_verifications`** (new):

| Column       | Type          | Notes |
| ------------ | ------------- | ----- |
| `id`         | `uuid` PK     | |
| `user_id`    | `uuid`        | FK to `users`, not null. Indexed. |
| `token_hash` | `text`        | SHA-256 of a random 256-bit token, unique. |
| `expires_at` | `timestamptz` | 72 hours after creation (`VERIFICATION_TOKEN_TTL_SECONDS`, default 259200). |
| `used_at`    | `timestamptz` | Set when verified, or when a resend replaces it. |
| `created_at` | `timestamptz` | |

Only the hash is stored, so a database leak yields no usable links.

| Audit action                          | `tenant_id`       | Resource |
| ------------------------------------- | ----------------- | -------- |
| `plan.created`, `plan.updated`        | `NULL` (platform) | plan |
| `tenant.created`                      | the new tenant    | tenant |
| `user.created` (first Tenant Admin)   | the new tenant    | user |
| `subscription.assigned` (at creation) | the tenant        | subscription |
| `subscription.changed`                | the tenant        | subscription; `details` holds old and new terms |

#### User-limit check

Users are counted as **active members**: rows in `tenant_members` whose user has `is_active = true`.
One service function, `assertSeatAvailable(tx, tenantId)`, does the check, and every path that adds or reactivates a member calls it in the same transaction:

1. Take `pg_advisory_xact_lock` keyed by the tenant ID.
2. Read the subscription's `user_limit` and count the active members.
3. At or above the limit: throw 409 `USER_LIMIT_REACHED`.

Why the lock: without it, two admins can both count 9 of 10 before either commits, and both insert, leaving 11 users on a 10-user plan.
With the lock, the second waits, counts 10, and is rejected.
The lock is per tenant, so Al-Noor never waits for Al-Rashid.
A subscription change takes the same lock, so a downgrade and a user creation cannot interleave.

Over-limit after a downgrade (R1.13, D15) needs no extra state: the check runs only when a member is added or reactivated.

### 4.2 API

Operator routes require an operator access token and send `Cache-Control: no-store`.
Dates are `YYYY-MM-DD` strings.

| Method | Path | Who | Permission | Request | Responses |
| ------ | ---- | --- | ---------- | ------- | --------- |
| POST   | `/operator/plans` | operator | `platform.plan.create` | `{name, userLimit, graceDays}` | 201 `{plan}`; 400; 409 `PLAN_NAME_TAKEN` |
| GET    | `/operator/plans` | operator | `platform.plan.view` | none | 200 `{plans:[...]}` ordered by name |
| GET    | `/operator/plans/:planId` | operator | `platform.plan.view` | none | 200 `{plan}`; 404 |
| PATCH  | `/operator/plans/:planId` | operator | `platform.plan.update` | any of `{name, userLimit, graceDays}` | 200 `{plan}`; 400; 404; 409 `PLAN_NAME_TAKEN` |
| POST   | `/operator/tenants` | operator | `platform.tenant.create` | `{name, slug, admin:{email, userName}, subscription:{planId, startDate, endDate}}` | 201 `{tenant, subscription, admin:{id, email}}`; 400; 409 `EMAIL_TAKEN`, `SLUG_TAKEN` |
| GET    | `/operator/tenants` | operator | `platform.tenant.view` | none | 200 `{tenants:[{id, name, slug, subscription:{..., state}, usage:{activeUsers, overLimit}}]}` |
| GET    | `/operator/tenants/:tenantId` | operator | `platform.tenant.view` | none | 200 `{tenant, subscription, usage}`; 404 |
| PUT    | `/operator/tenants/:tenantId/subscription` | operator | `platform.subscription.update` | `{planId, startDate, endDate, reason?}` | 200 `{subscription, usage}`; 400; 404 |
| POST   | `/operator/tenants/:tenantId/admin/resend-verification` | operator | `platform.tenant.create` | none | 204; 404; 409 `ALREADY_VERIFIED` |
| POST   | `/auth/verify` | anyone | none | `{token, password}` | 204; 400 `VALIDATION_FAILED` (password 12-256 characters); 400 `VERIFICATION_INVALID` |
| GET    | `/subscription` | tenant user | `subscription.view` | none | 200 `{subscription:{planName, userLimit, startDate, endDate, graceEndsOn, state}, usage}` |
| GET    | `/auth/me` | any user | none | (changed) | Tenant users' response gains `subscription:{state, endDate, graceEndsOn}` |

#### Permissions

| Permission | Allows | Held by in the MVP |
| ---------- | ------ | ------------------ |
| `platform.plan.view`, `platform.plan.create`, `platform.plan.update` | Plan endpoints | Every operator |
| `platform.tenant.view`, `platform.tenant.create` | Tenant endpoints | Every operator |
| `platform.subscription.update` | Subscription changes | Every operator |
| `subscription.view` | `GET /subscription` (organization scope) | Tenant Admin (from Phase 3) |

The `platform.` prefix keeps operator permissions out of the tenant catalog, so a tenant role can never hold one.
Until Phase 3, `GET /subscription` is open to any tenant user; its content is low-sensitivity.

#### Validation

- `name` (plan, tenant): trimmed, 1-100 characters. `slug`: lowercase letters, digits, and hyphens, 2-50 characters.
- `userLimit`: integer 1-100,000. `graceDays`: integer 0-365.
- `startDate` not after today; `endDate >= startDate`. A past `endDate` ends a subscription early.
- Unknown `planId`: 400 `VALIDATION_FAILED` with detail code `unknown_plan`.
- `admin.email`: normalized (trim, lowercase), valid format. `admin.userName`: trimmed, 1-100 characters (Phase 0, P0.20).
- Non-UUID path IDs: 404 `NOT_FOUND`.

#### New error codes

| HTTP | Code | When |
| ---- | ---- | ---- |
| 400  | `VERIFICATION_INVALID` | Unknown, expired, or used verification token. |
| 409  | `ALREADY_VERIFIED` | Resend requested for an admin who has already verified. |
| 403  | `SUBSCRIPTION_READ_ONLY` | Unsafe tenant request while Read-only (R1.9). |
| 403  | `SUBSCRIPTION_NOT_ACTIVE` | Route requires Active; tenant is in Grace or Read-only (R1.10). |
| 409  | `PLAN_NAME_TAKEN`, `EMAIL_TAKEN`, `SLUG_TAKEN` | Unique value already exists. |
| 409  | `USER_LIMIT_REACHED` | Adding an active member would exceed the limit (R1.12). |

### 4.3 Key flows and state transitions

#### Subscription state

```
              today > end_date                 today > end_date + grace_days
   Active ───────────────────────▶ Grace ─────────────────────────────────────▶ Read-only
     ▲                               │                                               │
     └──────────────── operator sets an end_date >= today ───────────────────────────┘
```

The state is never stored.
One pure function, `subscriptionState({endDate, graceDays}, today)`, computes it, where `today` is the database's current date in `Asia/Riyadh`, returned by the query that loads the subscription.
A derived state needs no midnight job (the job runner arrives in Phase 7) and is never stale, so renewal takes effect on the next request (R1.8).
A `grace_days` of 0 moves a tenant from Active straight to Read-only.

#### Create a tenant (operator)

1. Validate the body.
2. In one transaction:
   1. Load the plan; unknown → 400.
   2. Insert the admin user (Sara), unverified and with no password.
   3. Insert the tenant with `owner_id` = Sara (Phase 0, P0.10), then its subscription with copied terms.
   4. `assertSeatAvailable`, then insert Sara's `tenant_members` row with role `admin`.
   5. Insert the verification row (hash only).
   6. Audit `tenant.created`, `subscription.assigned`, `user.created`.
3. A unique violation on email or slug rolls everything back with 409.
4. After commit, send the verification email with the raw token in the link. A send failure is logged, the 201 is still returned, and Omar can resend.

#### Verify email and set password (first Tenant Admin)

1. Validate `{token, password}`; the password is 12-256 characters.
2. In one transaction: hash the token and load the verification row with `FOR UPDATE`; unknown, used, or expired → 400 `VERIFICATION_INVALID`.
3. Hash the password (argon2id), set `password_hash` and `email_verified_at`, mark the row used, and audit `user.email_verified`.
4. Return 204. Sara then logs in normally; no tokens are issued by verify.

`FOR UPDATE` makes a double-submitted link verify once: the second request waits, then sees `used_at` set.

#### Resend verification (operator)

In one transaction: load the tenant's owner (none → 404; already verified → 409 `ALREADY_VERIFIED`), mark every unused verification row of that user as used, insert a new one, and audit `user.verification_resent`.
After commit, send the email.
Only the newest link works, so an old email found later cannot be used.

#### Login before verification

Login treats an unverified user like a wrong password: 401 `INVALID_CREDENTIALS` (Q8).
The dummy-hash check runs when `password_hash` is null, so timing does not reveal that the account exists.

#### Change a subscription (operator)

In one transaction: load the plan, take the tenant's seat lock, load the subscription (none → 404), update it with the plan's current terms and the new dates, and audit `subscription.changed` with the old and new terms.
Renew, extend, change plan, and end early are all this one operation.

#### Email delivery (P1.18)

- `EmailSenderType` has one method, `send({ to, subject, text })`. The tenants service depends only on this interface.
- The SMTP sender (`nodemailer`) is built in `app.ts` from configuration and passed to the modules that send email; tests pass a fake that records what was sent.
- Local development runs Mailpit from Docker Compose: SMTP on `127.0.0.1:1025`, inbox on `http://localhost:8025`. Omar creates Al-Noor, and the email to Sara appears in that inbox.
- Production uses the same sender with the chosen KSA provider's SMTP settings, so choosing the provider is a configuration change.
- The link is `${APP_BASE_URL}/verify-email?token=<token>`: a web-app page that posts the token and the new password to `/auth/verify`.
- The email is sent after the transaction commits (P1.14); the token never appears in logs.

New configuration keys:

| Key | Default | Meaning |
| --- | ------- | ------- |
| `SMTP_HOST`, `SMTP_PORT` | none | SMTP server. Locally Mailpit (`localhost`, `1025`). |
| `SMTP_USER`, `SMTP_PASSWORD` | none | Optional; Mailpit needs none. |
| `SMTP_SECURE` | `false` | TLS from the first byte (port 465 style). |
| `EMAIL_FROM` | none | Sender address, for example `Watheeq <no-reply@watheeq.sa>`. |
| `APP_BASE_URL` | none | Web-app origin used to build links, for example `http://localhost:5173`. |
| `VERIFICATION_TOKEN_TTL_SECONDS` | `259200` | Verification link lifetime (72 hours). |

#### Subscription guard (tenant routes)

A middleware after `authenticate()` on every tenant router loads the subscription by the token's `tenant.id` and attaches the state to the request.

- Read-only: unsafe methods are rejected with 403 `SUBSCRIPTION_READ_ONLY`; `/auth/*` is not behind the guard.
- `requireActiveSubscription`: route-level, for routes that need Active (Phase 6 submission).

Default-deny by method means every future write route is blocked in Read-only without its author having to remember.

### 4.4 Module structure

Every module follows the Phase 0.5 per-module file rules: its routes file composes its layers, and constants, schemas, and types live in their own files.

```
src/
  db/schema/plans.ts, subscriptions.ts, email-verifications.ts
  email/                                 EmailSenderType, the SMTP sender (nodemailer), email.config.ts, email.types.ts (P1.18)
  types/express.ts                       (changed) adds req.subscription
  modules/
    platform/
      platform.config.ts                 PLATFORM_PERMISSIONS
      platform.types.ts                  PlatformPermissionType, ...
      shared/middlewares.ts              requirePlatformPermission(permission)
      plans/                             plans.routes.ts (composes), .controller.ts, .service.ts, .repository.ts,
                                         .config.ts, .schemas.ts, .types.ts
      tenants/                           same files; tenant creation, list, detail, subscription change, resend
    subscriptions/
      subscriptions.routes.ts (composes), .controller.ts, .service.ts, .repository.ts   GET /subscription
      subscriptions.config.ts, .schemas.ts, .types.ts
      shared/subscription-state.ts       pure state function
      shared/seats.ts                    assertSeatAvailable(tx, tenantId)
      shared/middlewares.ts              subscription guard and requireActiveSubscription
    auth/                                (changed) /auth/verify; login refuses unverified users; /auth/me carries the state
```

`app.ts` gains one line per new router: `/operator/plans`, `/operator/tenants`, and `/subscription`.
HTTP bodies are named per the type rule, for example `CreatePlanRequestType`, `CreatePlanResponseType`, `CreateTenantRequestType`, `VerifyEmailRequestType`.

## 5. Edge Cases and Failure Behavior

| Scenario | Expected behavior |
| -------- | ----------------- |
| Omar creates Al-Noor with an email that already exists. | Unique violation; full rollback; 409 `EMAIL_TAKEN`; nothing remains (R1.3). |
| Omar double-clicks "Create tenant". | The second request hits the same email or slug and gets 409; one tenant exists. |
| Two concurrent member additions for Al-Noor's last seat. | The seat lock serializes them; the second gets 409 `USER_LIMIT_REACHED` (R1.12). |
| Omar downgrades Al-Noor while an admin adds a user. | Both take the seat lock; whichever runs second sees the other's result. |
| Two operators change Al-Noor's subscription at once. | The seat lock runs them one after the other; both are audited (R1.5, R1.6). |
| A request arrives at 23:59 Riyadh time on the end date. | `today` is computed in `Asia/Riyadh`, so the state is Active. |
| Omar sets a start date in the future. | 400; there is no "not yet started" state. |
| Sara (tenant user) calls an operator endpoint. | 403 `FORBIDDEN` from `requireRole('operator')` (R1.15). |
| Al-Noor is Read-only; Sara logs in, logs out, or opens `GET /subscription`. | Allowed. |
| The verification email fails to send after the tenant is created. | The tenant exists; the failure is logged; Omar resends. |
| Sara uses a verification link twice, or after it expires. | 400 `VERIFICATION_INVALID`. |
| Sara double-clicks the verify button. | The row lock serializes the two requests; the first sets the password, the second gets 400 `VERIFICATION_INVALID`. |
| Omar resends; Sara then opens the first, older email. | The older row was marked used at resend; 400 `VERIFICATION_INVALID`. |
| Sara tries to log in before verifying. | 401 `INVALID_CREDENTIALS`, identical to a wrong password. |
| `GET /operator/tenants/not-a-uuid`. | 404 `NOT_FOUND`. |

## 6. Security and Authorization

- **Trust boundaries:** every body validated with zod; plan and subscription values also have database checks.
- **Tenant isolation:** application-level (T2). Tenant endpoints take the tenant from the access token. Only `src/modules/platform/` reads across tenants, and only behind `requireRole('operator')`.
- **Authorization:** every route declares its permission. Operators hold every platform permission in the MVP.
- **Verification tokens:** random, stored only as a hash, single use, with an expiry.
- **Audit:** every operator write audited in the same transaction (T8).

## 7. Implementation Steps

Phase 0 steps 0.3-0.5 must be complete first.

| Step | Objective | Delivers | Acceptance criteria | Verification |
| ---- | --------- | -------- | ------------------- | ------------ |
| 1.1 Operator permissions | Every operator route declares a permission. | `requirePlatformPermission`, platform permission list. | A route with a permission rejects a tenant user with 403 and accepts an operator; a forced-false check returns 403. | Integration tests. |
| 1.2 Plans | Operators manage plans. | `plans` table; plan routes, controller, service, repository; audit. | R1.1: CRUD works; duplicate name (any case) 409; invalid values 400; each write leaves one platform-level audit row with before and after values. | Integration tests. |
| 1.3 Tenants, subscriptions, verification | Operators create tenants; the first admin verifies. | `subscriptions`, `email_verifications`, `users` changes, state function, `assertSeatAvailable`, tenant routes, `/auth/verify`, resend endpoint, the `email/` SMTP sender and its configuration; Mailpit in Docker Compose (tests use a fake sender, plus one integration test against Mailpit started by Testcontainers). | R1.3, R1.4, R1.7: atomic creation; taken email or slug leaves nothing; Sara cannot log in before verifying, then verifies with a password and logs in; a used, expired, or replaced link is rejected; the list shows state and usage; the state function matches R1.7 at every boundary, including Riyadh midnight. | Unit tests for the state function; integration tests with a fake email sender. |
| 1.4 Subscription changes | Renew, extend, change, end. | `PUT /operator/tenants/:tenantId/subscription`, audit. | R1.2, R1.5, R1.6, R1.8. | Integration tests, including concurrent changes on two connections. |
| 1.5 User-limit enforcement | The limit holds under concurrency and after a downgrade. | Seat lock in subscription changes; tests of `assertSeatAvailable`. | R1.12, R1.13; one tenant's lock never blocks another. | Integration tests on two connections with a controlled interleaving. |
| 1.6 Tenant-side state | Tenants see and are governed by their subscription. | Subscription guard, `requireActiveSubscription`, `GET /subscription`, state in `/auth/me`. | R1.9-R1.11. | Integration tests with dates set to reach each state. |

Suggested rounds: 1.1; then 1.2; then 1.3; then 1.4, 1.5, and 1.6 in parallel.

## 8. Test Plan

Integration tests run against real PostgreSQL; dates are controlled by writing subscription dates relative to the database's Riyadh date.

| Requirement | Test | Step |
| ----------- | ---- | ---- |
| R1.1, R1.2 | Plan CRUD, duplicates, validation, audit; plan edits leave subscriptions unchanged. | 1.2, 1.4 |
| R1.3, R1.4 | Atomic creation, rollback, verification, first login. | 1.3 |
| R1.5, R1.6, R1.8 | Changes, audit of terms, concurrency, renewal from Read-only. | 1.4 |
| R1.7 | Unit: state function at each boundary. | 1.3 |
| R1.9-R1.11 | Guard per state, auth routes unaffected, Active-only route, responses. | 1.6 |
| R1.12, R1.13 | Limit, concurrent last seat, reactivation, downgrade over-limit. | 1.5 |
| R1.14 | Each operator write leaves the expected audit row and `tenant_id`. | 1.2-1.4 |
| R1.15, R1.16 | Tenant user on operator routes; tenant endpoints with two seeded tenants; forced permission failure. | 1.1-1.6 |

## 9. Open Questions

| #  | Question | Options | Resolution |
| -- | -------- | ------- | ---------- |
| Q1 | How does the application create tenants, and how do operators read across tenants? | | **Resolved 2026-10-21:** operator routes guarded by role and permission; platform repositories query across tenants; no database platform mode (T2). |
| Q2 | Where are operator actions audited? | | **Resolved 2026-10-20:** one `audit_log`; `tenant_id IS NULL` marks platform-level entries. |
| Q3 | Grace period length and where it is defined. | | **Resolved 2026-10-20:** per plan, copied into the subscription. |
| Q4 | Which users count against the limit? | | **Resolved 2026-10-20:** active users only (now: active members). |
| Q5 | Operator suspension independent of the subscription? | | **Resolved 2026-10-20:** deferred. |
| Q6 | How does the first Tenant Admin get a password, now that `/auth/verify` exists (MVP D16)? | | **Resolved 2026-10-21:** Sara sets her own password in the verification step (P1.15). Replaces the earlier "generated, shown once". |
| Q7 | What happens if the verification email fails or expires? | | **Resolved 2026-10-21:** the operator can resend; older links stop working (P1.16). |
| Q8 | Can an unverified user log in? | | **Resolved 2026-10-21:** no; 401 `INVALID_CREDENTIALS` (P1.17). |
| Q9 | How are verification emails delivered before the email provider is chosen (deferred decision; must keep data in KSA)? Example: Omar creates Al-Noor today; Sara needs her link. | (a) **Recommended:** an `EmailSenderType` interface with two implementations: a development sender that writes the email (with the link) to the log, allowed only when `NODE_ENV` is `development` or `test`, and the real provider added when it is chosen. In production the app refuses to start without a provider. Tests use a fake that records emails. (b) Choose the provider now, as part of Phase 1. (c) Return the link to the operator in the API response until a provider exists, and Omar passes it on. | **Resolved 2026-10-21:** an `EmailSenderType` interface with one SMTP implementation (`nodemailer`); Mailpit is the SMTP server for local development, and production points the same sender at the chosen KSA provider (P1.18). |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #     | Decision | Rationale |
| ----- | -------- | --------- |
| P1.1  | Operator endpoints are protected by `authenticate()`, `requireRole('operator')`, and a declared platform permission; only `src/modules/platform/` queries across tenants. | Replaces the database platform mode under T2. |
| P1.2  | `plans` is platform data without `tenant_id`. | Tenant code reads its copied terms from `subscriptions`. |
| P1.3  | One subscription row per tenant, updated in place; the history is the audit log. | "Exactly one subscription" is a database fact. |
| P1.4  | Subscription state is derived from dates and the database's Riyadh date, never stored. | No job before Phase 7; never stale. |
| P1.5  | `assertSeatAvailable(tx, tenantId)` under a per-tenant advisory lock, called by every path that adds an active member; subscription changes take the same lock. | Concurrent additions cannot exceed the limit. |
| P1.6  | Read-only blocks all unsafe tenant requests outside `/auth/*` by default; Active-only routes opt in. | Future write routes are protected without per-route effort. |
| P1.7  | A subscription's start date is never after today; a past end date is allowed. | No "not yet started" state; ending early needs no separate feature. |
| P1.8  | The first Tenant Admin is created as a user and a member with role `admin` (Phase 0, P0.13); Phase 3 maps `admin` to the tenant's Tenant Admin role. | Tenant-defined roles do not exist before Phase 3. |
| P1.9  | One `audit_log` for both levels; `tenant_id IS NULL` is platform-level. | One audit history to query. |
| P1.10 | Grace period per plan, copied into each subscription. | Consistent with D14. |
| P1.11 | Only active members count against the limit. | Deactivating a leaver frees the seat. |
| P1.12 | Operator suspension is deferred. | Ending a subscription early covers the MVP. |
| P1.13 | Every route declares a permission; operator permissions use the `platform.` prefix. | Permissions explicit per resource. |
| P1.14 | Verification tokens are random, stored as a hash, single use, and expire after 72 hours (configurable); the email is sent after commit. | A database leak yields no usable links; a rolled-back tenant never sends email. |
| P1.15 | The first Tenant Admin is created without a password and sets it (12-256 characters) in `/auth/verify`. | Owner decision (Q6): nobody but Sara ever knows her password. |
| P1.16 | The operator can resend the verification link; a resend invalidates every older link. Requires `platform.tenant.create`. | Owner decision (Q7): recovers from a lost or expired email without recreating the tenant. |
| P1.17 | An unverified user cannot log in, with the same 401 as a wrong password. | Owner decision (Q8); no account enumeration. |
| P1.18 | Email goes through an `EmailSenderType` interface with one SMTP implementation (`nodemailer`); Mailpit is the local development SMTP server and inbox; production uses the chosen KSA provider's SMTP settings. | Owner decision (Q9): real email locally from day one, and the provider choice reduces to configuration. |

Promote these to `MVP_SCOPE.md` or `TECHNICAL_DECISIONS.md` when the phase is implemented.

## 11. Change Log

| Date       | Change | Reason |
| ---------- | ------ | ------ |
| 2026-10-19 | Initial draft. | Phase 1 spec requested. |
| 2026-10-20 | Resolved Q1-Q6; simplified the data layer; added permissions per endpoint. | Owner review. |
| 2026-10-21 | Rewritten for the simplified MVP: no RLS or platform transactions; membership through `tenant_members`; tenant `slug`; first Tenant Admin verifies email (`/auth/verify`); Q6 reopened; Q7 and Q8 added; steps renumbered; status back to Draft. | Owner simplified the codebase. |
| 2026-10-21 | The first Tenant Admin's membership is created with role `admin` (Phase 0, P0.13). | Owner added `tenant_members.role`. |
| 2026-10-21 | Resolved Q6-Q8: password set at verification, operator resend, no login before verification; added the verify, resend, and login-before-verification flows, `ALREADY_VERIFIED`, and P1.15-P1.17. | Owner review. |
| 2026-10-21 | The first Tenant Admin is created with a `userName`; the guard reads `tenant.id` from the token (Phase 0, P0.18, P0.20). | Phase 0 refactor. |
| 2026-10-21 | Aligned with the Phase 0 refactor: module layout per the per-module file rules, guard in the subscriptions module, central constraint map for 409 codes, `req.subscription` in `src/types/`; added Q9 (email delivery before a provider). | Phase 0 conventions. |
| 2026-10-21 | Resolved Q9: SMTP sender behind `EmailSenderType`, Mailpit for local development (P1.18); added the email delivery section and configuration keys. | Owner decision. |
