# Access

Three things decide what a caller can do: the permission of their role, the subscription state of their tenant, and who can see a record.
This file states the rules; the permission each endpoint needs is in its `.API.md` row.

## Permissions

A tenant role holds permission keys such as `user.view` or `request.review`; the catalog of keys and the scopes each allows lives in code (`PERMISSION_CATALOG`), and `GET /permissions` lists it.
Every tenant route declares its permission with `requireTenantPermission(...)`.

| Case | Answer |
| ---- | ------ |
| The caller's role lacks the route's permission | 403 `FORBIDDEN`, `details: []` |
| A tenant user calls an operator route, or the reverse | 403 `FORBIDDEN`, `details: []` |
| A write gives a role, or a user, power the actor does not hold | 403 `PERMISSION_NOT_HELD`, one detail at each entry that asked for it |
| A user changes their own role or deactivates themselves | 403 `SELF_CHANGE_FORBIDDEN` |

Example: Khalid's role holds `org.view` and `user.view` only, so his `POST /org-units` is 403 `FORBIDDEN`.
Huda holds `user.view` at organization scope and saves a role whose fourth permission is `user.create`, which she does not hold: 403 `PERMISSION_NOT_HELD` with `[{path: "permissions.3", code: "permission_not_held"}]`.
A refusal of the route's own permission has no details, because no input asked for it.

- **The subset rule:** an actor can give a role or a user only permissions, at scopes, that the actor holds, and can edit or deactivate only users whose current role is within the actor's.
  Scopes order as `own` < `section` < `department` < `organization`.
- The subset rule reads the actor's role from the database at that moment, not from the token, so a role edit made five minutes ago applies at once (`assertGrantsHeld`, `missingGrants`).
- Every other route is allowed or refused by the permissions in the access token, which a refresh renews within 30 minutes (`auth.md`).

## Scopes

A scope limits which rows a permission reaches, resolved from the caller's current place in the organization.

| Scope | Reaches |
| ----- | ------- |
| `own` | The caller themselves, and their own records |
| `section` | The caller's own unit (a section, or a department for a member placed directly in it) |
| `department` | The caller's department and all its sections |
| `organization` | The whole tenant |

- A user with no unit reaches only themselves with `section` or `department` scope.
- Scope is applied inside each database query (`withinScope`), so a list holds only what the caller may see and its `total` counts only those items.
- Something outside the caller's scope is 404 `NOT_FOUND`, never 403, so an ID reveals nothing.
  Faisal (department scope) opens Khalid in another department: 404.

## Subscription states

A tenant's subscription state is derived from today's date in Riyadh and read on every request, so a renewal takes effect on the next call.

| State | When | What is blocked |
| ----- | ---- | --------------- |
| Active | Through the subscription's end date | Nothing |
| Grace | The grace days after the end date | Routes that need Active: submitting a request (403 `SUBSCRIPTION_NOT_ACTIVE`) |
| Read-only | After the grace days | Every `POST`, `PUT`, `PATCH`, and `DELETE` on a tenant route (403 `SUBSCRIPTION_READ_ONLY`); reads still work |

- Read-only is the default for tenant routes: a new write route is refused without anyone having to remember (`subscriptionGuard`).
  A route that needs Active adds `requireActiveSubscription()`.
- `/auth/*` and `/notifications/*` are not behind the guard, so in Read-only users can still sign in, refresh, sign out, change their password, and read and clear their notifications.
- `/health` is open to everyone.
- A client learns the state from `GET /auth/me` (`subscription.state`) and shows a notice in Grace and Read-only.
- Operator routes are not behind the guard.

Example: Al-Noor's subscription ended 3 days ago and its plan has 7 grace days, so it is in Grace: Khalid's `POST /requests` is 403 `SUBSCRIPTION_NOT_ACTIVE`, while Sara can still edit roles.
After the grace days, Sara's `PATCH /users/<nora>` is 403 `SUBSCRIPTION_READ_ONLY`, and `GET /users` still works.

## Who sees a request

A person sees a request when any of these holds; to anyone else it is 404 `NOT_FOUND`.

| Reason | Example |
| ------ | ------- |
| They are its requester | Khalid sees the requests he submitted |
| They are its handler | Faisal sees the requests he handles |
| They are a current assignee of its active stage | A reviewer of the Legal Opinion stage sees the request while the stage waits on them |
| They are a reviewer, while it is in review | Huda holds `request.review` and sees every request in review |
| `request.view` covers the requester's or the handler's recorded unit at their scope | Majed (department scope) sees Finance's requests; Huda (organization) sees all |

- One SQL condition (`visibleRequests`) decides this for lists, reads, and every action's lookup, so a list and an action never disagree.
- The units are the ones recorded on the request when it was submitted and accepted, so a later move of a person does not change who sees it.
- Every request action checks the caller's party and permission in the database inside the action's transaction, so a deactivated member's still-valid token cannot act.
