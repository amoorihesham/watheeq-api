# MVP Scope

## Watheeq - Legal Affairs Management System

**Status:** Agreed scope baseline (last updated 2026-10-21). Implementation progress is tracked in `ROADMAP_AND_STATUS.md`.
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
- In the MVP, a plan's only enforced limit is the **maximum number of users**.
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

#### 3.2 Organization Configuration (Tenant Admin)

- **Organization structure:** departments and sections under the organization (the tenant itself): a department sits directly under the organization, and a section sits under a department.
  - Each department and section has zero or more managers, all equal; a manager is a member of the unit they manage (D18).
  - Each user belongs to at most one unit (department or section); a user with no unit sits directly under the organization (D19).
  - The department that handles legal affairs is an ordinary department; legal responsibilities come from permissions, not from the structure (D20).
- **Users:** create and manage users within the tenant, subject to the subscription's user limit (3.1).
- **Roles:** create and manage roles (see 3.3).
- **Working calendar:** working days and holidays, used for all SLA calculations.

#### 3.3 Roles and Permissions

- Each user holds exactly one role within the organization.
- A role is a set of permissions selected from the system permission catalog.
- A permission defines an operation on a resource, and may carry a scope (e.g. own / section / department / organization). Concrete scope resolution comes from the user's position in the organization structure.
- **Anti-privilege-escalation rules:**
  - Anyone holding `role.create` may create a role, but only with permissions (and scopes) they themselves hold.
  - The same subset rule applies to editing a role and to assigning a role to a user.
  - A user cannot change their own role.

#### 3.4 Legal Operations Configuration (Head of Legal)

- **Service catalog:** services offered to requesters.
- **Legal roles:** created under the rules in 3.3.
- **Priority levels:** priority and SLA are a single concept - a named level with a deadline in working days (e.g. _High = 5 working days_).
- **Workflows:** ordered, linear stages. No branching or parallel stages.
- **Escalation settings:** tenant-level, configurable thresholds used by rules R0-R2 (see 3.7), applied equally to all priorities.

#### 3.5 Request Lifecycle

1. **Submission** - the requester selects a service and submits a request, choosing a priority.
2. **Review** - legal reviews the request and may adjust its priority.
3. **Decision** - legal accepts or rejects the request.
   - On acceptance, an overall request owner is assigned and the SLA clock starts.
   - On acceptance, priority is **locked**. Priority changes before acceptance are audited with a reason.
4. **Execution** - the request moves through its workflow's ordered stages.
   - Legal may request additional information from the requester at any point during execution.
   - If the requester does not respond, legal may close the request as _Rejected - no response_.
5. **Closure** - the request ends as **Completed** or **Rejected**.

Workflow-stage assignment does not transfer overall request ownership.

#### 3.6 SLA and Closure Record

- The SLA clock starts at acceptance and runs continuously in working days until closure.
- **The clock does not pause** while awaiting requester information.
- The closure record states: outcome, SLA deadline, actual elapsed time, met or breached, breach duration, and time spent awaiting information (informational only - it does not affect the SLA result).

#### 3.7 Escalation

Escalation is notification-only in the MVP.

| Rule                    | Fires when                                                              | Notifies                                      |
| ----------------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| **R0 - Review overdue** | A submitted request is not accepted or rejected within _N_ working days | Users who may review requests across the organization |
| **R1 - At risk**        | _X%_ of the SLA has elapsed                                             | Request owner                                 |
| **R2 - Breached**       | The SLA deadline passes before closure                                  | Owner, the managers of the owner's section and department |

- _N_ and _X%_ are configurable per tenant.
- Each rule fires **at most once per request**; firing is recorded.
- Escalation chain: the managers of the owner's section, then the managers of the owner's department (D20). Every active manager of a level is notified. A level with no manager, or whose only manager is the owner, is skipped.

#### 3.8 Notifications

- In-app only, with read/unread status.
- Delivered for escalations, key request lifecycle events, and subscription warnings to Tenant Admins (exact event list to be finalized during design).

#### 3.9 Audit

Important actions are recorded with: actor, timestamp, affected resource, action, and reason where available. At minimum: request lifecycle transitions, priority changes, ownership and stage assignments, role and permission changes, role assignments, escalations, and plan and subscription changes.

---

### 4. Out of Scope for the MVP

- Payment integration, invoicing, and tax / e-invoicing.
- Self-service sign-up or plan changes by tenants.
- Plan limits other than the user count; feature gating by plan.
- Trial plans.
- Delegation of permissions.
- Workflow routing policies.
- Branching, conditional, or parallel workflow stages.
- Positions / job titles.
- Email, SMS, or push notifications. (Transactional email for account verification is in scope, D16.)
- Attachments and document management.
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
| D3  | Fixed org tree: departments under the organization, sections under departments; no positions | Sufficient for MVP; positions add no MVP behavior.                                                     |
| D4  | Priority = SLA level, in working days                                                         | One concept instead of two.                                                                            |
| D5  | Requester sets priority; legal may adjust until acceptance; locked after                      | Prevents post-acceptance changes that would hide SLA breaches.                                         |
| D6  | Linear workflow stages                                                                        | Simplest correct workflow model.                                                                       |
| D7  | Information requests in scope; clock keeps running                                            | Gives an unambiguous closure outcome; supersedes the pause behavior in the original Product Vision §8. |
| D8  | Escalation rules R0, R1, R2; thresholds configurable per tenant                               | R0 covers requests nobody reviews; percentage thresholds work across priorities.                       |
| D9  | Each escalation rule fires once per request                                                   | Prevents duplicate notifications from periodic checks.                                                 |
| D10 | In-app notifications only                                                                     | Avoids external mail-provider dependency in the MVP.                                                   |
| D11 | Subscriptions managed manually by the operator; no payment integration                        | B2B sales are typically settled offline; avoids payment-gateway and tax dependencies in the MVP.       |
| D12 | The only plan limit in the MVP is the user count; feature gating deferred                     | Smallest limit set that supports differentiated plans.                                                 |
| D13 | Expiry: grace period (new submissions blocked, in-progress requests workable), then read-only | Keeps legal records accessible and lets in-flight requests close fairly against their SLA.             |
| D14 | Subscriptions copy plan terms at assignment; plan edits apply to new subscriptions only       | Prevents plan edits from silently changing existing customers' terms.                                  |
| D15 | Downgrade below current user count creates an over-limit state, not removal                   | Avoids destructive automatic changes to a tenant's users.                                              |
| D16 | The first Tenant Admin verifies their email after the tenant is created, setting their own password through the link; until then they cannot log in | Confirms the address belongs to the customer before it controls the tenant. Adds one email provider dependency (must keep data in KSA); notifications stay in-app only (D10). |
| D17 | Plans carry price, payment period (monthly or yearly), and discount; subscriptions copy them and may add a customer discount; no minimum term | Records the commercial terms agreed offline, per customer, without payment integration (D11). |
| D18 | A department or section has zero or more managers, all equal; a manager is a member of the unit they manage | Real units are often run by more than one person; a unit exists before anyone can manage it, and managers leave. Replaces "exactly one manager" (Phase 2 spec, P2.12). |
| D19 | A user belongs to at most one unit; a user with no unit sits directly under the organization | The first Tenant Admin exists before any unit, and some people (a CEO, an IT admin) belong to no department (Phase 2 spec, P2.13). |
| D20 | No department is marked as Legal; legal responsibilities (configuring legal operations, reviewing and owning requests, receiving R0) are permissions; escalation climbs the owner's own units | Authorization stays with roles (D1), and organization administration and legal operations stay separable (Phase 2 spec, P2.14). |

---

### 6. Known Limitations (Accepted)

- Time spent awaiting requester information counts against the legal team's SLA.
- The organization structure is limited to departments and sections.
- Users only see escalations and subscription warnings when they open the application.
- Subscription renewals depend on the operator acting manually.

---

### 7. Open Questions (to resolve during design)

1. How services map to workflows (one workflow per service, or chosen at acceptance).
2. Who a workflow stage is assigned to (a legal role, a specific person, or chosen by the owner).
3. Deadline calculation precision (end of working day vs. exact time) and whether calendar changes affect already-accepted requests.
4. Whether a requester can withdraw a request.
5. ~~Length of the grace period, and whether it is a platform-wide setting or defined per plan.~~ Resolved in Phase 1: defined per plan (`grace_days`, 0-365) and copied into each subscription.
6. In the read-only state, whether SLA clocks and escalations for still-open requests continue, stop, or are marked as affected by the subscription state.
7. ~~Whether the operator can suspend a tenant independently of its subscription (e.g. for abuse or contract disputes).~~ Resolved in Phase 1: deferred; ending a subscription early (a past end date, with a reason) covers the MVP.
8. The exact list of notification-triggering events.
