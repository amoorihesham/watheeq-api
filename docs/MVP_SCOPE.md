# MVP Scope

## Watheeq - Legal Affairs Management System

**Status:** Agreed scope baseline (last updated 2026-10-25). Implementation progress is tracked in `ROADMAP_AND_STATUS.md`.
**Relationship to other docs:** `PRODUCT_VISION.md` describes the long-term product. This document defines what the first release must do. When they differ, this document governs the MVP.

---

### 1. MVP Goal

A platform operator can create a tenant and assign it a subscription plan; the tenant can configure its organization and legal department; and one legal request can be carried end-to-end from submission to completion or rejection - with SLA tracking, escalation, in-app notifications, and an auditable history.

---

### 2. Actors

| Actor                 | Description                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Platform Operator** | Operates the platform; exists outside any tenant. Manages plans, creates tenants and their first Tenant Admin, and manages tenant subscriptions. |
| **Tenant Admin**      | Configures the organization: structure, users, roles, working calendar. Can view the tenant's subscription and usage.                            |
| **Head of Legal**     | Holds the legal-operations permissions through their role (D20). Configures legal operations.                                                   |
| **Legal Staff**       | Members of the Legal department who own requests and complete workflow stages.                                                                   |
| **Requester**         | Any employee who submits a legal request and responds to information requests.                                                                   |

Within a tenant, what an actor can do is determined by the permissions of their role; where they can do it is determined by their place in the organization structure.

---

### 3. In Scope

#### 3.1 Platform, Plans, and Subscriptions (Platform Operator)

**Tenants**

- Create a tenant.
- Create the tenant's first Tenant Admin, who holds every tenant-level permission.
- The first Tenant Admin verifies their email address before using the tenant (D16).

**Plans**

- The operator creates and edits plans.
- In the MVP, a plan's enforced limits are the **maximum number of users** and the **storage** for uploaded files, in whole GB (D35).
- A customer who needs more than the largest plan gets a custom plan of their own, with its own limits and price (D35).
- A plan has a **price** in SAR per **payment period** (monthly or yearly) and may carry a **discount** percentage. The price is a record for offline billing; nothing is charged (D11).

**Subscriptions**

- The operator assigns a plan to a tenant for a defined period (start and end date). Subscriptions are managed manually by the operator; there is no payment integration.
- A tenant has one current subscription at a time.
- A subscription **keeps a copy of the plan's terms at the time it is assigned**. Later edits to a plan apply to new subscriptions only.
- A subscription may carry an additional **customer discount** negotiated for that tenant. There is no minimum subscription term.
- The operator can renew, extend, or change a tenant's subscription.

**Subscription states and their effect**

| State         | When                                           | Effect                                                                                                                         |
| ------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Active**    | Within the subscription period                 | Full use.                                                                                                                      |
| **Grace**     | After the end date, for a defined grace period | New request submission is blocked. Requests already in progress can be worked through to closure. Tenant Admins see a warning. |
| **Read-only** | After the grace period ends                    | Users can view data but cannot submit, act on, or configure anything.                                                          |

Renewal by the operator returns the tenant to Active.

**User limit enforcement**

- Creating a user beyond the subscription's user limit is rejected with a clear message.
- The limit check must hold under concurrent user creation (two admins creating the last allowed user simultaneously must not exceed the limit).
- **Over-limit after downgrade:** if a tenant is moved to a plan with a lower limit than its current user count, existing users keep working; creating new users is blocked until the count is within the limit. No users are removed automatically.
- **Storage:** an upload that would pass the subscription's storage limit is refused, including under concurrent uploads; after a downgrade below current usage, files stay and only new uploads are refused (D35).

#### 3.2 Organization Configuration (Tenant Admin)

- **Organization structure:** departments and sections under the organization (the tenant itself): a department sits directly under the organization, and a section sits under a department.
  - Each department and section has zero or more managers, all equal; a manager is a member of the unit they manage (D18).
  - Each user belongs to at most one unit (department or section); a user with no unit sits directly under the organization (D19).
  - The department that handles legal affairs is an ordinary department; legal responsibilities come from permissions, not from the structure (D20).
- **Users:** create and manage users within the tenant, subject to the subscription's user limit (3.1).
- **Roles:** create and manage roles (see 3.3).
- **Working calendar:** working hours (a default span for every working weekday, and an optional own span or day off for any weekday), seasonal hours such as Ramadan, and holidays, one-off or recurring every year on Gregorian or Hijri (Umm al-Qura) dates, with one-year adjustments for announced dates; used for all SLA calculations (D24-D27).

#### 3.3 Roles and Permissions

- Each user holds exactly one role within the organization.
- A role is a set of permissions selected from the system permission catalog.
- A permission defines an operation on a resource, and is granted at a scope: own (the user), section (the user's own unit), department (the user's department and its sections), or organization. Concrete scope resolution comes from the user's current position in the organization structure; a user with no unit reaches only themselves below organization scope.
- Every tenant has a protected Tenant Admin role, held by the owner, that always holds every permission (D21).
- **Anti-privilege-escalation rules:**
  - Anyone holding `role.manage` may create a role, but only with permissions (and scopes) they themselves hold.
  - The same subset rule applies to editing and deleting a role (its current and its new permissions) and to assigning a role to a user (the user's current role and the new one); deactivating or reactivating a user also requires the user's role to be within the actor's (D22).
  - Changing a user's role is its own permission, `role.assign` (D23).
  - A user cannot change their own role.

#### 3.4 Legal Operations Configuration (Head of Legal)

- **Service catalog:** services offered to requesters; each service lists the workflows it allows, one of them the default (D28).
- **Request forms:** each service defines the form a requester fills in: text, number, date, choice, yes or no, and file fields, each optional or required (D34).
- **Positions:** named responsibilities placed in a department or section and held by members of that unit, independent of roles; a person holds at most one. Six built-in positions are relative to the request: the handler, the requester, and the managers of either one's unit or department (D29).
- **Legal roles:** created under the rules in 3.3.
- **Priority levels:** priority and SLA are a single concept - a named level with a deadline in working days (e.g. _High = 5 working days_).
- **Workflows:** ordered, linear stages; no branching or parallel stages. Each stage names a position and the builder's choices for it (D30).
- **Escalation settings:** for each of R0-R2: on or off, its threshold, and its recipients as positions, applied equally to all priorities (see 3.7, D32). Nothing is seeded; requests cannot be submitted until a tenant has saved them (D33).
- Services, priorities, workflows, and positions are edited or retired, never deleted.

#### 3.5 Request Lifecycle

1. **Submission** - the requester selects a service, fills in its form with any required documents, and submits a request, choosing a priority. The answers are kept as submitted, with a copy of each field, so later form edits never change a submitted request (D34).
2. **Review** - legal reviews the request and may adjust its priority.
3. **Decision** - legal accepts or rejects the request.
   - On acceptance, an overall request owner (the **handler**) is assigned, the reviewer picks one of the service's allowed workflows (D28), and the SLA clock starts.
   - On acceptance, priority is **locked**. Priority changes before acceptance are audited with a reason.
4. **Execution** - the request moves through its workflow's ordered stages.
   - When a stage starts, its position is resolved to people automatically; any one of them completes it, and may return it to the previous stage (D30, D31).
   - Where the stage allows it, the handler may narrow the assignees to some of them, or escalate the stage to the next level, with a reason (D30).
   - Legal may request additional information from the requester at any point during execution.
   - If the requester does not respond, legal may close the request as _Rejected - no response_.
5. **Closure** - the request ends as **Completed** or **Rejected**.

Workflow-stage assignment does not transfer overall request ownership.

#### 3.6 SLA and Closure Record

- The SLA clock starts at acceptance and runs continuously in working time until closure; every working day counts as one day whatever its length, and a deadline is an exact moment (D24, D25).
- **The clock does not pause** while awaiting requester information, nor during requester-side stages.
- The closure record states: outcome, SLA deadline, actual elapsed time, met or breached, breach duration, and time spent awaiting information (informational only - it does not affect the SLA result).

#### 3.7 Escalation

Escalation is notification-only in the MVP.

| Rule                    | Fires when                                                              | Notifies                                      |
| ----------------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| **R0 - Review overdue** | A submitted request is not accepted or rejected within _N_ working days | Its configured recipients; no handler-side positions, since no handler exists yet |
| **R1 - At risk**        | _X%_ of the SLA has elapsed                                             | Its configured recipients                     |
| **R2 - Breached**       | The SLA deadline passes before closure                                  | Its configured recipients                     |

- Each rule can be turned on or off, and _N_, _X%_, and the recipients (as positions) are configurable per tenant (D32).
- Each rule fires **at most once per request**; firing is recorded.
- Built-in managers positions (for example, the handler's unit managers) never include the handler or requester they are relative to (D30).

#### 3.8 Notifications

- In-app only, with read/unread status.
- Delivered for escalations, key request lifecycle events, and subscription warnings to Tenant Admins (exact event list to be finalized during design).

#### 3.9 Audit

Important actions are recorded with: actor, timestamp, affected resource, action, and reason where available. At minimum: request lifecycle transitions, priority changes, ownership and stage assignments, role and permission changes, role assignments, escalations, and plan and subscription changes.

---

### 4. Out of Scope for the MVP

- Payment integration, invoicing, and tax / e-invoicing.
- Self-service sign-up or plan changes by tenants.
- Plan limits other than the user count and storage; feature gating by plan.
- Trial plans.
- Delegation of permissions.
- Workflow routing policies.
- Tenant positions shared across units ("the Approver of the requester's department"); only the built-in positions are relative.
- Escalation thresholds per priority, additional escalation rules.
- Branching, conditional, or parallel workflow stages.
- Positions / job titles.
- Email, SMS, or push notifications. (Transactional email for account verification is in scope, D16.)
- Document management beyond request attachments (folders, versions, templates).
- Retention terms, and deleting a tenant's data after its subscription ends (D36).
- Virus scanning of uploads (deferred hardening, before production).
- Pausing the SLA clock.
- Repeated reminders after breach; automatic reassignment on escalation.
- Reporting and analytics.
- All long-term capabilities listed in `PRODUCT_VISION.md` §10.

---

### 5. Decision Log

| #   | Decision                                                                                      | Rationale                                                                                              |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| D1  | One role per user; scope derived from org structure                                           | Single authorization model; role defines _what_, structure defines _where_.                            |
| D2  | Create/edit/assign roles only with permissions you hold; no self role change                  | Prevents privilege escalation.                                                                         |
| D3  | Fixed org tree: departments under the organization, sections under departments; no job titles | Sufficient for MVP. Positions that work is routed to are a separate concept (D29).                    |
| D4  | Priority = SLA level, in working days                                                         | One concept instead of two.                                                                            |
| D5  | Requester sets priority; legal may adjust until acceptance; locked after                      | Prevents post-acceptance changes that would hide SLA breaches.                                         |
| D6  | Linear workflow stages                                                                        | Simplest correct workflow model.                                                                       |
| D7  | Information requests in scope; clock keeps running                                            | Gives an unambiguous closure outcome; supersedes the pause behavior in the original Product Vision §8. |
| D8  | Escalation rules R0, R1, R2; thresholds configurable per tenant                               | R0 covers requests nobody reviews; percentage thresholds work across priorities.                       |
| D9  | Each escalation rule fires once per request                                                   | Prevents duplicate notifications from periodic checks.                                                 |
| D10 | In-app notifications only                                                                     | Avoids external mail-provider dependency in the MVP.                                                   |
| D11 | Subscriptions managed manually by the operator; no payment integration                        | B2B sales are typically settled offline; avoids payment-gateway and tax dependencies in the MVP.       |
| D12 | Plan limits in the MVP are the user count and storage (D35); feature gating deferred          | Smallest limit set that supports differentiated plans.                                                 |
| D13 | Expiry: grace period (new submissions blocked, in-progress requests workable), then read-only | Keeps legal records accessible and lets in-flight requests close fairly against their SLA.             |
| D14 | Subscriptions copy plan terms at assignment; plan edits apply to new subscriptions only       | Prevents plan edits from silently changing existing customers' terms.                                  |
| D15 | Downgrade below current user count creates an over-limit state, not removal                   | Avoids destructive automatic changes to a tenant's users.                                              |
| D16 | The first Tenant Admin verifies their email after the tenant is created, setting their own password through the link; until then they cannot log in | Confirms the address belongs to the customer before it controls the tenant. Adds one email provider dependency (must keep data in KSA); notifications stay in-app only (D10). |
| D17 | Plans carry price, payment period (monthly or yearly), and discount; subscriptions copy them and may add a customer discount; no minimum term | Records the commercial terms agreed offline, per customer, without payment integration (D11). |
| D18 | A department or section has zero or more managers, all equal; a manager is a member of the unit they manage | Real units are often run by more than one person; a unit exists before anyone can manage it, and managers leave. Replaces "exactly one manager" (Phase 2 spec, P2.12). |
| D19 | A user belongs to at most one unit; a user with no unit sits directly under the organization | The first Tenant Admin exists before any unit, and some people (a CEO, an IT admin) belong to no department (Phase 2 spec, P2.13). |
| D20 | No department is marked as Legal; legal responsibilities (configuring legal operations, reviewing and owning requests, receiving R0) are permissions; escalation climbs the owner's own units | Authorization stays with roles (D1), and organization administration and legal operations stay separable (Phase 2 spec, P2.14). |
| D21 | Every tenant has one protected Tenant Admin role, created with the tenant and held by the owner; it always holds every permission, including those added later, and cannot be edited or deleted. A new tenant starts with no other role | The first Tenant Admin holds every permission (3.1) without migrations as the catalog grows; more than one person can be a full admin; no seeded roles drift from what later phases add (Phase 3 spec, P3.8, P3.9). |
| D22 | The subset rule also protects the target: editing, deleting, or assigning a role requires its current permissions to be within the actor's, and deactivating or reactivating a user requires the user's role to be within the actor's | Nobody can take away powers they do not hold, such as demoting a Tenant Admin or emptying a role with more permissions; extends D2 (Phase 3 spec, P3.11). |
| D23 | Changing a user's role needs its own permission, `role.assign` | A Head of Legal can give legal roles without being able to rename or move other departments' people (Phase 3 spec, P3.12). |
| D24 | The calendar has working hours; deadlines and elapsed times are exact moments in Riyadh time | Resolves the precision half of open question 3 (Phase 4 spec, P4.1). |
| D25 | Every working day counts as one day whatever its length; a deadline keeps the start's fraction of its working day, and a start outside working hours counts from the next opening | SLAs are promised in days (D4), so shorter Ramadan days do not stretch them, and every SLA is exactly N days (Phase 4 spec, P4.2, P4.3). |
| D26 | The calendar's past is fixed: a change to hours, holidays, or seasons affects only days after today | A calendar edit can never erase a breach or rewrite a closed record, yet a holiday announced the day before still helps open requests (Phase 4 spec, P4.7). |
| D27 | Where seasons overlap, the one with the higher explicit rank sets the hours | Ramadan moves through the Gregorian year, so seasons overlap only in some years; one ranking holds every year (Phase 4 spec, P4.9). |
| D28 | A service lists one or more allowed workflows, one of them the default; the reviewer picks one at acceptance | One service can offer a standard and a complex path; resolves open question 1 (Phase 5 spec, P5.1). |
| D29 | Positions are named responsibilities in one unit, held by members of that unit, independent of roles and permissions, at most one per person; six built-in positions are relative to the handler and the requester | Work is routed to responsibilities, not people or roles: one edit of a position updates every workflow that names it (Phase 5 spec, P5.3). |
| D30 | A workflow stage names a position, resolved to people when the stage starts. The builder sets per stage what happens when nobody is eligible (escalate to the managers of the unit, then of the department, where the chain ends; skip; or hold), whether the handler may narrow or escalate, and whether the handler and requester are excluded; built-in managers positions always exclude their anchor | Nobody assigns routine work by hand, and nobody approves their own request or work; resolves open question 2 (Phase 5 spec, P5.2, P5.6, P5.12). |
| D31 | Acting on a stage is authorized by being one of its current resolved assignees, not by a permission; the first action wins | A requester with no legal permissions can confirm their stage, and a Tenant Admin cannot sign a sign-off assigned to others (Phase 5 spec, P5.8). |
| D32 | Escalation per tenant: each rule on or off, its threshold (R0 1-30 working days, R1 1-99%), and its recipients as positions | Replaces the fixed recipients and chain of 3.7 (Phase 5 spec, P5.10). |
| D33 | Escalation settings are not seeded; requests cannot be submitted until a tenant saves them | No request exists without escalation monitoring, and no threshold is a guess made for the tenant (Phase 5 spec, P5.11). |
| D34 | Each service has a request form; a submission's answers, including documents, are checked against it and stored with a copy of each field definition | Requests carry the information legal needs from the start; a form edit never rewrites a submitted request (Phase 5.5 spec, P5.5.1, Q2). Amends section 4, which kept attachments out of scope. |
| D35 | Plans carry a storage limit in whole GB, copied by subscriptions; usage is every stored file; over the limit only uploads are refused; a customer beyond the largest plan gets a custom plan | Storage is the main cost a tenant drives; refusing only uploads never loses data, as D15 does for users (Phase 5.5 spec, P5.5.6, Q15). |
| D36 | Removing an attachment deletes the file; there is no retention term, and deleting a tenant's data is a future scope | Unused files cost the customer nothing, while the audit keeps the name, size, and SHA-256 of what was removed (Phase 5.5 spec, P5.5.7, P5.5.8). |

---

### 6. Known Limitations (Accepted)

- Time spent awaiting requester information counts against the legal team's SLA.
- The organization structure is limited to departments and sections.
- Users only see escalations and subscription warnings when they open the application.
- Subscription renewals depend on the operator acting manually.

---

### 7. Open Questions (to resolve during design)

1. ~~How services map to workflows (one workflow per service, or chosen at acceptance).~~ Resolved in Phase 5: a service lists its allowed workflows with one default, and the reviewer picks one at acceptance (D28).
2. ~~Who a workflow stage is assigned to (a legal role, a specific person, or chosen by the owner).~~ Resolved in Phase 5: a stage names a position, resolved to people automatically when it starts (D29, D30).
3. ~~Deadline calculation precision (end of working day vs. exact time) and whether calendar changes affect already-accepted requests.~~ Resolved in Phase 4: deadlines are exact moments, placed proportionally within working days (D24, D25); calendar changes affect only days after today, so the future deadlines of open requests follow them and past outcomes never change (D26).
4. Whether a requester can withdraw a request.
5. ~~Length of the grace period, and whether it is a platform-wide setting or defined per plan.~~ Resolved in Phase 1: defined per plan (`grace_days`, 0-365) and copied into each subscription.
6. In the read-only state, whether SLA clocks and escalations for still-open requests continue, stop, or are marked as affected by the subscription state.
7. ~~Whether the operator can suspend a tenant independently of its subscription (e.g. for abuse or contract disputes).~~ Resolved in Phase 1: deferred; ending a subscription early (a past end date, with a reason) covers the MVP.
8. The exact list of notification-triggering events.
