# Phase 11 Spec: Operator Console Requests

| Field                  | Value                                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**             | Implemented                                                                                                                                                                                |
| **Approved by / date** | _Amr - 2/11/2026 - 22.33 pm_                                                                                                                                                       |
| **Depends on**         | Phase 1 (`phase-1-platform-subscriptions.md`) for plans, tenants, and verification; Phase 2 for invitations; Phase 8 for lists and filters; Phase 10 for endpoint declarations and `openapi.json` |
| **Related decisions**  | MVP D16; Technical T15-T20, T25, T52-T56, T60, T61, T64; Phase 1 P1.13, P1.14, P1.16, P1.20                                                                                              |
| **Frontend issues**    | `#1` (B4), `#2` (B6), `#4` (B9), `#5` (B10), `#6` (B11), `#7` (B12)                                                                                                                     |

---

## 1. Objective

Give the operator console (frontend feature F1) what its tenant and plan pages need: who a tenant's first admin is and whether their verification email went out, filtering and search on the tenant list, a plan's price after its discount, plans newest first, and the platform permissions of the signed-in operator.
All six requests were accepted in the triage of 2026-11-02 and are needed by F1, the first frontend feature.

## 2. Scope

**In scope:**

- `Tenant.owner` (id, email, name, verification time, outcome of the last verification email) in place of `Tenant.ownerId` (#1, #6).
- Recording whether each invitation link email was accepted by the mail server (#6).
- The resend of the first admin's verification link answering the tenant (Q2).
- `state` and `q` on `GET /operator/tenants` (#2).
- `Plan.discountedPriceHalalas` (#4).
- `GET /operator/plans` newest first, and every list's order stated in its operation's description in `openapi.json` (#5).
- `AuthUser.platform`, the platform permissions of an operator's session (#7), with the platform permission code moved into a `platform-access` module.

**Out of scope (and where it is handled instead):**

- Bilingual names, including searching a tenant by its Arabic or English name: Phase 12 (#3).
- Showing the invitation email outcome on `GET /users` for Tenant Admins: recorded from this phase (Q1), shown when the frontend asks for it.
- Operator roles, so that one operator holds fewer than six platform permissions: after the MVP (Phase 1, 4.2). Until then #7's "Done when" with only `platform.tenant.view` cannot be shown (triage of #7).
- Telling whether an email was delivered, opened, or bounced: `sent` means only that the mail server accepted it (#6).
- A `sort` parameter on any list: each list keeps one server-side order (Phase 8, R8.6).

## 3. Requirements

Example people: **Omar**, a platform operator; **Sara**, the first Tenant Admin of **Al-Noor** (slug `al-noor`); **Khalid**, a user at **Al-Rashid**.

| ID           | Requirement                                                                                                                                                                                                                                                                                                                                                               | Example                                                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R11.1 (#1)   | `Tenant` carries `owner: {id, email, userName, verifiedAt, verificationEmail}` and no longer `ownerId`. `owner` is never `null`. `verifiedAt` is when the owner verified their email and set a password, or `null` before that. It appears wherever `TenantDetail` does: create, get, each list item, a subscription change, and the resend (R11.3).                    | _`GET /operator/tenants/<al-noor>` answers `tenant.owner: {id: <sara>, email: "sara@alnoor.sa", userName: "Sara Al-Qahtani", verifiedAt: null, verificationEmail: "sent"}`; after Sara verifies, `verifiedAt` is that moment._   |
| R11.2 (#6)   | `owner.verificationEmail` is `sent` when the mail server accepted the last verification link sent to the owner, `failed` when it refused it or could not be reached, and `null` once the owner has verified, or when no outcome is recorded (a link sent before this phase). Creating a tenant still succeeds when the email fails, and its answer shows `failed`.          | _Mailpit is stopped; Omar creates Al-Noor: 201, the tenant exists, `owner.verificationEmail: "failed"`. Omar sees it on the tenant page and on every later read, without waiting for Sara to report a missing email._          |
| R11.3 (#6)   | Resending the owner's verification link answers 200 with the tenant (`TenantDetail`), whose `owner.verificationEmail` is the outcome of this send. A send failure is not an error: it answers 200 with `failed`. An owner who already verified is still 409 `ALREADY_VERIFIED`, and no email is sent.                                                                 | _With Mailpit down, Omar resends: 200, `verificationEmail: "failed"` (it was 500). Mailpit comes back; he resends: 200, `"sent"`, and only the newest link works._                                                                  |
| R11.4 (#6)   | Every invitation link email records its outcome on the invited user: the first admin's email on tenant creation, the operator's resend, a Tenant Admin's invitation of a user, and its resend (Q1). Issuing a new link clears the previous outcome, so an outcome always belongs to the newest link. Password reset emails record nothing.                                | _Sara invites Khalid and the mail server refuses: Khalid's row records `failed`; no response shows it yet. Sara resends and it is accepted: `sent`._                                                                                 |
| R11.5 (#2)   | `GET /operator/tenants?state=` keeps the tenants whose subscription is in that state today (Riyadh date), as `subscription.state` shows it: `active`, `grace`, `read_only`, or `all` (the default). Another value is 400 `VALIDATION_FAILED` with `{path: "state", code: "invalid_value"}`.                                                                               | _On 2026-11-10, Al-Noor's subscription ended on 2026-11-05 with 14 grace days: `?state=grace` lists it, `?state=active` does not. `?state=expired` is 400 `invalid_value`._                                                          |
| R11.6 (#2)   | `GET /operator/tenants?q=` keeps the tenants whose name or slug contains the text, ignoring case; `%`, `_`, and `\` match literally. `q` is trimmed, at most 100 characters, and a blank `q` is no filter (as on `GET /users`).                                                                                                                                         | _`?q=noor` and `?q=NOOR` find Al-Noor by its name; `?q=al-n` finds it by its slug; `?q=%` finds only tenants with `%` in the name or slug; `?q=%20%20` lists every tenant._                                                     |
| R11.7 (#2)   | The tenant list keeps its order by name, then ID. `state` and `q` combine with AND; `page.total` counts the filtered list; the cursor carries the filters (after defaults), so a cursor used with other filters is 400 `invalid_cursor` (R8.7).                                                                                                                          | _`?state=grace&q=noor` lists only Al-Noor; `total: 1`. Omar changes `q` while on page 2 and the app sends the old cursor: 400 `invalid_cursor`, and the app restarts the list._                                                    |
| R11.8 (#4)   | `Plan` carries `discountedPriceHalalas`: `priceHalalas` after `discountPercent`, in integer arithmetic, rounded half up to the halala, the same rule as `pricing.effectivePriceHalalas` (P1.20). It is computed when read, never stored.                                                                                                                                  | _Basic, `priceHalalas: 100000`, `discountPercent: 10`: `discountedPriceHalalas: 90000`. `999` at `12.5`: `874`. A 100% discount: `0`._                                                                                            |
| R11.9 (#5)   | `GET /operator/plans` lists plans newest first: `createdAt` descending, then `id` descending. Paging with the cursor keeps that order.                                                                                                                                                                                                                                    | _Omar creates "Pilot" and then "Enterprise": page 1 starts with Enterprise, then Pilot. With `limit=1`, page 2 is Pilot._                                                                                                            |
| R11.10 (#5)  | Every list endpoint states its order in its operation's `description` in `openapi.json`, in one sentence naming its sort keys and direction. A list endpoint declared without an order does not compile.                                                                                                                                                                 | _`GET /priorities` in `/docs` reads "Ordered by display order, then by name, then by ID; retired priorities, which have no display order, come last."_                                                                            |
| R11.11 (#7)  | `AuthUser` carries `platform: {permissions}` for an operator and `null` for a tenant user. `permissions` lists the platform permissions the operator holds, in catalog order. It is in every session answer: `GET /auth/me`, login, and refresh. The access token is unchanged.                                                                                         | _Omar's `GET /auth/me`: `user.platform.permissions: ["platform.plan.view", "platform.plan.create", "platform.plan.update", "platform.tenant.view", "platform.tenant.create", "platform.subscription.update"]`; Sara's: `platform: null`._ |
| R11.12 (#7)  | `user.platform.permissions` and the operator route checks come from one function, so the list can never offer an action a route refuses.                                                                                                                                                                                                                                 | _A test replaces the function with one that grants only `platform.tenant.view`: `/auth/me` lists only it, and `POST /operator/tenants` is 403._                                                                                     |

## 4. Design

### 4.1 Data model

Migration `0024` adds one column and one enum:

```sql
create type email_send_outcomes as enum ('sent', 'failed');
alter table users add column invitation_email email_send_outcomes;
```

`users.invitation_email` is the outcome of the email that carried the user's newest invitation link (R11.4).
It is `null` while that email is being sent, when it was sent before this phase, and it is never read once the user has verified.
Existing rows stay `null`; there is no backfill, since nobody knows how their emails went.

Why on `users` and not on the link (`password_tokens`): expired links are deleted by the housekeeping job, so an owner who never verified would lose the outcome after 72 hours.
Why not on `tenants`: the outcome belongs to an invitation, and Tenant Admins invite users the same way (Q1).

No index: the column is read only through the owner of one tenant.
The tenant list's `q` and `state` filters use no index either; the list is operator-wide and small (hundreds of tenants), and a `%text%` search cannot use a b-tree index.

### 4.2 API

See [phase-11-operator-console.API.md](phase-11-operator-console.API.md).

**Contract impact** (`docs/FRONTEND_COLLABORATION.md`, section 5):

Contract changes, announced together in one `be:contract-change` issue on the frontend repo, "Phase 11: tenant owner, resend answer, plan order", filed before the first push to `dev` that carries any of them; each commit that makes one names it in a `Contract-change:` trailer:

| Change                                                                                                                       | Seen by `pnpm contract:check` |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `Tenant.ownerId` removed; `Tenant.owner` replaces it                                                                         | Yes                           |
| `POST /operator/tenants/{tenantId}/admin/resend-verification` answers 200 `{data: TenantDetail}` instead of 204, and a failed send is 200 with `failed` instead of 500 | Yes (the 204 response is removed) |
| `GET /operator/plans` is ordered newest first instead of by name                                                             | No: stated in the issue, checked by hand in the review |

Additions for the `be:heads-up` issue filed at the Done step:

- `Tenant.owner` with `verifiedAt` and `verificationEmail`.
- `state` and `q` on `GET /operator/tenants`.
- `Plan.discountedPriceHalalas`.
- `AuthUser.platform`.
- Every list operation's `description` states its order.

No new error code or detail code.

### 4.3 Key flows

#### Creating a tenant (changed)

1. The transaction is today's (R1.3), and `issuePasswordToken` sets the user's `invitation_email` to `null`.
2. After commit, the email is sent (P1.14).
3. Its outcome is written in its own statement: `update users set invitation_email = 'sent' | 'failed' where id = <owner>`.
   A failure is still logged as `verification email failed` with the tenant ID, never the token.
4. The answer is read again with `get`, so it is exactly what `GET /operator/tenants/:id` answers now (R8.2).

If the write of step 3 fails (the database went away after the commit), the call answers 500 as any database failure does; the tenant exists, its outcome reads `null`, and Omar can resend.

#### Resending the owner's link (changed)

1. Today's transaction: find the owner, 409 `ALREADY_VERIFIED` if verified, issue a new link (retiring the older ones and clearing the outcome), and audit `user.verification_resent`.
2. After commit, send; write `sent` or `failed`; a failure is logged as `verification email failed`.
3. Answer 200 with the tenant read again.

Why not an error on failure any more: Omar asked for an email; the answer must tell him it did not go out, and `verificationEmail: "failed"` does, on the tenant he is looking at.
A 500 says "server fault" (R8.12), which an unreachable mail server is not from the API's point of view, and it left nothing on the tenant page to explain it.

#### Inviting a user, and resending an invitation (changed, Q1)

The same steps 1-3 as creating a tenant, through the same helper; the answers are unchanged (the user's `GET /users/:id` shape, and the resend's 204 or 500).
Only the recording is new.

The helper lives in `auth/shared/onboarding.ts` next to `issuePasswordToken`:

```ts
/** Sends an invitation link email and records whether the mail server accepted it (R11.4). Never throws for a send failure. */
export async function sendInvitationLink(db: Executor, userId: string, message: EmailMessageType, emailSender: EmailSenderType, onSendError: (err: unknown) => void): Promise<'sent' | 'failed'>;
```

`onSendError` receives a send failure, so each caller keeps its own warning (`verification email failed` with the tenant ID, `invitation email failed` with the user ID); the token is never passed to it.
The tenant user resend keeps answering 500 on failure: its `onSendError` keeps the error, and it is thrown once the outcome is recorded, so its contract does not change in this phase.

#### Owner in the tenant detail

The tenant detail query joins `users` on `tenants.owner_id` and selects the owner's `id`, `email`, `user_name`, `email_verified_at`, and `invitation_email`.
`verificationEmail` is `null` when `email_verified_at` is set, otherwise `invitation_email`.
A tenant row without an owner is impossible after its creation transaction (P0.10), so the join is an inner join and `owner` is not nullable.

#### Tenant list filters

`state` is computed in SQL with the same rule as `subscriptionState` (R1.7), against `riyadhToday`:

| `state`     | Condition                                                         |
| ----------- | ----------------------------------------------------------------- |
| `active`    | `today <= end_date`                                               |
| `grace`     | `today > end_date and today <= end_date + grace_days`             |
| `read_only` | `today > end_date + grace_days`                                   |

The SQL lives in the subscriptions module next to the TypeScript rule (`subscriptionStateIs(state)`), and a test runs both over the boundary dates (the end date, the last grace day, the day after) with grace days of 0 and 14, so the filter and `subscription.state` can never disagree.
The list's page and count run in one read-only snapshot (Phase 8), and `now()` is fixed for a transaction, so a page and its total use the same "today".

`q` reuses `GET /users`' search: the `containing` helper moves from `users.repository.ts` to `src/db/search.ts`, and both lists use it.

#### Plan view

The plans repository keeps reading rows; a `toPlanView(row)` adds `discountedPriceHalalas` with `effectivePrice({priceHalalas, planDiscountPercent: discountPercent, customerDiscountPercent: 0})`, the subscriptions module's function, so there is one rounding rule.
The audit entries keep the stored row, not the view.

The plan list's sort keys become `created_at desc, id desc` (`timestamptz`, `uuid`).
Cursors issued before the change carry a name, not a timestamp, so they are refused as `invalid_cursor`, and the app restarts the list (R8.7); the `list` name in the fingerprint stays `plans`.

#### List orders in the document

The `page` response declaration gains a required `order`:

```ts
response: { kind: 'page', schema: planResponseSchema, order: 'Newest first: by creation time, then by ID, both descending.' },
```

The OpenAPI generator writes it as the operation's `description`.
Making it part of the `page` kind, instead of an optional `description` on every endpoint, is what makes R11.10 a compile error rather than a review item.
The texts are:

| Endpoint                   | `order`                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /operator/plans`      | Newest first: by creation time, then by ID, both descending.                                                |
| `GET /operator/tenants`    | By name (case-insensitive), then by ID.                                                                      |
| `GET /users`               | By user name (case-insensitive), then by ID.                                                                 |
| `GET /roles`               | By name (case-insensitive), then by ID.                                                                      |
| `GET /permissions`         | In catalog order, which groups each resource's permissions together.                                         |
| `GET /positions`           | By name (case-insensitive), then by ID.                                                                      |
| `GET /workflows`           | By name (case-insensitive), then by ID.                                                                      |
| `GET /services`            | By name (case-insensitive), then by ID.                                                                      |
| `GET /priorities`          | By display order, then by name, then by ID; retired priorities, which have no display order, come last.     |
| `GET /requests`            | Newest submission first: by submission time, then by ID, both descending.                                    |
| `GET /notifications`       | Newest first: by creation time, then by ID, both descending.                                                |

No test can read prose against SQL, so the review checks each text against its list's sort keys, and a change to a list's sort keys changes its text in the same commit.
"Case-insensitive" names the ICU root collation of `byName`; Phase 12 changes the name lists to the `Accept-Language` name and updates these texts.

#### Platform permissions in the session

Today the platform permission list and `platformPermissionsOf` live in `modules/platform`, which imports `auth`; `auth` cannot import `platform` back without a cycle through the tenants service.
They move to a new `modules/platform-access`, the platform counterpart of `tenant-access` (which `auth` already imports): `PLATFORM_PERMISSIONS`, `PlatformPermissionType`, `platformPermissionsOf`, and `requirePlatformPermission`.
`platform` keeps plans and tenants.

The auth service builds the session's user with `platform: user.role === 'operator' ? { permissions } : null`, where `permissions` are those `platformPermissionsOf(user)` holds, in `PLATFORM_PERMISSIONS` order.
The function reaches both the auth service and the operator routers from app composition (`buildApp` takes an optional `platformPermissionsOf`, defaulting to the real one), so a test can replace it in one place (R11.12); `buildRouter` refuses to build a router with a platform permission when it was not given the function.
The access token payload is unchanged: platform permissions follow from the role, and carrying them in the token would only make them stale when operator roles arrive.
`AuthUserType` (the principal read from the token) stays as it is; the session's user shape gains `platform`.

### 4.4 Module structure

| Path                                                         | Change                                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `src/modules/platform-access/` (new)                         | Platform permission catalog, `platformPermissionsOf`, `requirePlatformPermission` (moved) |
| `src/modules/platform/`                                      | Loses the moved files; `index.ts` stops exporting them                                   |
| `src/modules/auth/auth.responses.ts`, `auth.service.ts`       | `AuthUser.platform`                                                                      |
| `src/modules/auth/shared/onboarding.ts`                      | `sendInvitationLink`; `issuePasswordToken` clears `invitation_email` for invitation links |
| `src/modules/platform/tenants/*`                             | `owner`, filters, resend answer                                                          |
| `src/modules/users/users.service.ts`                         | Invite and resend through `sendInvitationLink`                                           |
| `src/modules/subscriptions/shared/subscription-state.ts`      | `subscriptionStateIs(state)` SQL beside the TypeScript rule                              |
| `src/modules/platform/plans/*`                               | `toPlanView`, `discountedPriceHalalas`, newest-first keys                                |
| `src/db/search.ts` (new)                                     | `containing`, moved from the users repository                                            |
| `src/db/schema/users.ts`, `db/migrations/0024_*.sql`         | `invitation_email`                                                                       |
| `src/http/endpoint.ts`, `src/http/openapi.ts`                 | `order` on `page` responses, written as the operation description                        |
| Every `*.endpoints.ts` with a list                           | Its `order` text                                                                         |
| `docs/api/conventions.md`, `docs/api/auth.md`                | Lists name their order in `openapi.json`; the session's `platform`                       |
| `docs/api/openapi.json`                                      | Regenerated                                                                              |

## 5. Edge Cases and Failure Behavior

| Scenario                                                                                                              | Expected behavior                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Omar resends twice at once; the first send is accepted, the second fails, and the first's write lands last            | Both links were issued in order; only the second link works, yet the owner shows `sent`. Accepted: the window is one SMTP round trip, a second resend fixes it, and a lock around an SMTP call would hold a database connection for seconds. |
| Sara verifies while Omar's resend is between its commit and its send                                                  | The send goes out with a link that no longer works; the outcome is written, but `verificationEmail` reads `null` because `verifiedAt` is set. Nothing wrong is shown.                    |
| The mail server accepts the email, then the database write of the outcome fails                                       | 500; the tenant (or the new link) exists; `verificationEmail` reads `null` (cleared when the link was issued); Omar can resend.                                                            |
| A tenant created before this phase, owner unverified                                                                  | `verificationEmail: null`, `verifiedAt: null`: the console shows the resend action without an outcome.                                                                                    |
| Omar pages `?state=active` across midnight in Riyadh and Al-Noor moves to Grace between page 1 and page 2              | Al-Noor drops out of page 2 and `total` decreases, as a deleted item would; no tenant repeats (R8.6). Each page is consistent in itself (one snapshot, one `now()`).                     |
| `?q=` is 101 characters                                                                                               | 400 `VALIDATION_FAILED`, `{path: "q", code: "too_big"}`, as on `GET /users`.                                                                                                              |
| `?state=Grace` (capital)                                                                                              | 400 `invalid_value`: filter values are exact (Phase 8, R8.9).                                                                                                                            |
| Two plans created in one transaction (same `createdAt`)                                                               | Ordered by ID descending; paging never skips or repeats one (R8.6).                                                                                                                       |
| The frontend sends a plan-list cursor issued before the deploy                                                        | 400 `invalid_cursor`; the app restarts the list.                                                                                                                                          |
| Plan with `priceHalalas: 0`                                                                                           | `discountedPriceHalalas: 0`.                                                                                                                                                              |
| A tenant user calls `GET /auth/me`                                                                                    | `user.platform: null`; nothing else changes.                                                                                                                                              |
| An operator's session after operator roles exist (later)                                                              | Only `platformPermissionsOf` changes; the session and the routes follow it (R11.12).                                                                                                      |

## 6. Security and Authorization

- No new routes; every changed route keeps its realm and permission: tenant reads `platform.tenant.view`, the resend `platform.tenant.create`, plans `platform.plan.view`.
- `owner.email` and `owner.userName` reach only operators (realm `operator`), who already see them in the creation request; a tenant user never reaches `/operator/*` (R1.15).
- `verificationEmail` reveals only whether a mail server accepted an email, never the token or the link; the token is still never logged (P1.14).
- `user.platform` shows an operator what they hold, which the routes already enforce; hiding an action in the frontend is a convenience, and the route check stays the authority.
- `q` is passed as a bound parameter with `%`, `_`, and `\` escaped, so it can neither inject SQL nor widen the match.
- Audit: the resend keeps `user.verification_resent`; the email outcome is not audited, since it is delivery state, not a change someone made, and it is visible on the tenant and in the logs.

## 7. Implementation Steps

Two sub-agents build the spec, each in its own worktree:

- **Agent A:** 11.1, 11.2, 11.3 (auth, http, plans, every endpoints file's `order` line).
- **Agent B:** 11.4, 11.5 (tenants, users, subscriptions, the migration).

Both touch `tenants.endpoints.ts` (A adds its `order`, B changes the resend) and regenerate `docs/api/openapi.json`; on merge the conflicts in that file are resolved by running `pnpm openapi` again, never by hand.
11.6 runs after both are merged.

| Step | Objective                                    | Delivers                                                                                                                        | Acceptance criteria                                                                                                                                                                                                                                | Verification                                                                                                                       |
| ---- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 11.1 | Platform permissions in the session (#7)     | `platform-access` module; `AuthUser.platform`                                                                                   | R11.11, R11.12; no import of `modules/platform` from `auth`; the access token payload is byte-identical to before for the same user                                                                                                                | HTTP tests for an operator and a tenant user on me, login, refresh; the replaced-function test; existing platform permission tests pass |
| 11.2 | Every list states its order; plans newest first (#5) | `order` on `page` responses, written as `description`; the eleven texts; plan keys `created_at desc, id desc`                  | R11.9, R11.10; a `page` endpoint without `order` fails `tsc`; each operation in `openapi.json` has its text                                                                                                                                         | Plan paging test with `limit=1` and a shared `createdAt`; old cursor refused; document test reads every list's description         |
| 11.3 | Discounted plan price (#4)                   | `discountedPriceHalalas` on every plan answer                                                                                   | R11.8 for 100000 at 10, 999 at 12.5, 0, and 100%; audit details unchanged                                                                                                                                                                          | Unit test of `toPlanView`; HTTP tests on create, get, list, update                                                                 |
| 11.4 | Tenant owner and email outcome (#1, #6)      | Migration `0024`; `sendInvitationLink`; `Tenant.owner`; resend answers the tenant; users' invite and resend record the outcome | R11.1-R11.4; with the fake sender failing: create is 201 with `failed`, resend is 200 with `failed`; after verification `null`; `ALREADY_VERIFIED` unchanged; tenant user invitation answers unchanged                                            | HTTP tests with the failing fake sender; a row check of `users.invitation_email` after each of the four paths and after a re-issue |
| 11.5 | Tenant list filters (#2)                     | `state`, `q`; `subscriptionStateIs`; `src/db/search.ts`                                                                        | R11.5-R11.7; the SQL and TypeScript state rules agree on every boundary date; `GET /users` search unchanged                                                                                                                                        | Filter tests per state with fixed dates; `q` by name, slug, case, and literal `%`; cursor with changed filters refused; total counts the filtered list |
| 11.6 | Contract and docs                            | `openapi.json` regenerated; `docs/api/` updated; Phase 1 `.API.md` purposes reworded                                           | `pnpm contract:check` lists exactly the two contract changes of 4.2 seen by the diff, and the additions; the full suite, lint, and `tsc` pass                                                                                                        | Output of `pnpm contract:check` in the report; end-to-end check against a running server with Mailpit stopped and started          |

## 8. Test Plan

- **Unit:** `toPlanView` rounding (R11.8); `subscriptionStateIs` against `subscriptionState` over boundary dates (R11.5); `containing` escaping (R11.6).
- **Integration (real PostgreSQL):**
  - Tenants: owner on create, get, list, and subscription change (R11.1); create and resend with a failing and a working fake sender (R11.2, R11.3); `verificationEmail` `null` after `/auth/verify` (R11.2); the four invitation paths and a re-issue on the `users` row (R11.4); `state` per value, `q` by name, slug, case, escapes, blank, too long, combined with `state`, total, and cursor (R11.5-R11.7).
  - Plans: `discountedPriceHalalas` on all four answers (R11.8); order and paging with equal `createdAt` (R11.9).
  - Auth: `platform` for an operator and a tenant user on me, login, and refresh; the replaced-function test (R11.11, R11.12).
  - Document: every `page` operation has its order text; drift and validity tests (R11.10).
- **Contract:** `pnpm contract:check` against `origin/dev` (11.6).
- **Mutation checks:** remove the outcome write and see the create and resend tests fail; flip the `grace` condition's `>` to `>=` and see the boundary test fail; drop `platformPermissionsOf` from the session and see R11.12 fail.
- **End to end:** with a running server and Mailpit, log in as an operator, create a tenant (sent), stop Mailpit, create another (failed) and resend (failed), start Mailpit and resend (sent), verify the admin through the Mailpit link, and read the tenant (`verifiedAt` set, `verificationEmail: null`); filter and search the list; read the plans; read `/auth/me`; and check the order descriptions in `/docs`.

## 9. Open Questions

| #   | Question                                                                                                                                                                                                                                                       | Options                                                                                                                                                                                                                                                                                       | Resolution |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Q1  | Which emails record their outcome? Example: Sara invites Khalid and the mail server refuses; today Sara is told nothing, exactly the problem #6 describes for Omar.                                                                                              | (a) **Recommended:** every invitation link (tenant creation, operator resend, user invitation, user resend) through one helper, shown only on `Tenant.owner` now; a later request can show it on `GET /users` with no migration. (b) Only the owner's links, stored on `tenants`. (c) Also password resets. | **Resolved 2026-11-02:** every invitation link records its outcome (tenant creation, operator resend, user invitation, user resend) through `sendInvitationLink`, stored on `users.invitation_email`; only `Tenant.owner` shows it in this phase; password resets record nothing (R11.4, P11.3). |
| Q2  | What does the operator's resend answer? Today it is 204, or 500 when the mail server fails, and the tenant page cannot show why.                                                                                                                                | (a) **Recommended:** 200 with the tenant, `verificationEmail` showing the outcome; a failure is not an error. A contract change (4.2). (b) Keep 204 and 500, record the outcome, and the frontend reads the tenant again. (c) 204 on success, a new 502 `EMAIL_NOT_SENT` on failure.           | **Resolved 2026-11-02:** the resend answers 200 with the tenant, and `owner.verificationEmail` shows this send's outcome; a failed send is 200 with `failed`, not 500; `ALREADY_VERIFIED` is unchanged (R11.3). A contract change (4.2). |
| Q3  | Is the plan order change announced as a contract change, though the frontend asked for it (#5)? The old order ("by name") is documented in the Phase 1 `.API.md`, and the frontend sorts by name today.                                                       | (a) **Recommended:** yes, in the same `be:contract-change` issue as the owner and the resend, so every behavior change of the phase is in one place. (b) No: the Final shape comment on #5 announces it.                                                                                      | **Resolved 2026-11-02:** yes; the plan order change is announced in the same `be:contract-change` issue as the owner and the resend changes, so every behavior change of the phase is in one place (4.2). |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #     | Decision                                                                                                                                         | Rationale                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P11.1 | `Tenant.owner` replaces `Tenant.ownerId`, is never `null`, and carries `verifiedAt` and `verificationEmail`.                                     | The console names the admin and decides whether to offer the resend from one read (#1, #6); a tenant always has its owner after creation (P0.10).                  |
| P11.2 | `verificationEmail` is `sent`, `failed`, or `null`; `sent` means the mail server accepted it; `null` once verified or when unknown.               | It answers the only question the console has (did it go out?) without claiming delivery; one field instead of a `meta` envelope keeps responses `{data}` only (T52). |
| P11.3 | The outcome is stored on `users.invitation_email`, cleared when a link is issued and written after each send.                                    | Survives the deletion of expired links; always belongs to the newest link; works for every invitation.                                                            |
| P11.4 | Concurrent resends may leave the outcome of the older send; no lock.                                                                             | A lock would span an SMTP call; the window is one round trip and a resend corrects it.                                                                            |
| P11.5 | The tenant list's `state` filter is computed in SQL from the same rule as `subscription.state`, tested together.                                 | The state is never stored (P1.4); two copies of the rule must not drift.                                                                                          |
| P11.6 | `q` on tenants matches name or slug with the `GET /users` search, moved to `src/db/search.ts`.                                                    | One search behavior across lists.                                                                                                                                 |
| P11.7 | `discountedPriceHalalas` uses `effectivePrice` with no customer discount.                                                                        | One rounding rule for every price.                                                                                                                                |
| P11.8 | A `page` response declares its `order`, written as the operation's `description`.                                                                | Each list's order is a contract the diff cannot see; declaring it beside the endpoint makes a missing one a compile error.                                         |
| P11.9 | Platform permissions live in `platform-access`; the session's `platform` comes from `platformPermissionsOf`; the token does not carry them.       | One source for routes and session (R11.12), no import cycle, and nothing to go stale in tokens when operator roles arrive.                                         |

Promoted on 2026-11-02 to `TECHNICAL_DECISIONS.md` as T65 (P11.2-P11.4), T66 (P11.5), T67 (P11.8), and T68 (P11.9). P11.1, P11.6, and P11.7 are detail that stays authoritative here.

## 11. Change Log

| Date       | Change                                                    | Reason                                                  |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------- |
| 2026-11-02 | Draft created from the accepted issues #1, #2, #4-#7.     | Owner asked for the Phase 11 spec after the triage.     |
| 2026-11-02 | Resolved Q1-Q3 with the recommended options: every invitation link records its outcome, the resend answers the tenant, and the plan order change is a contract change. | Owner review. |
| 2026-11-02 | Implemented and reviewed; two implementation choices approved and folded into 4.3: `sendInvitationLink` takes an `onSendError` callback, and `platformPermissionsOf` is passed from app composition with `buildRouter` refusing an operator router without it. Status set to `Implemented`; decisions promoted (T65-T68); the `.API.md` trimmed to its index. | Owner approved the report. |
