# Phase 6 Spec: Request Lifecycle

| Field                  | Value                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Status**             | In Implementation                                                                                                                                                                                                                    |
| **Approved by / date** | _Amr - 25/10/2026 - 19:17 pm_                                                                                                                                                                                                        |
| **Depends on**         | Phase 1 (`phase-1-platform-subscriptions.md`), Phase 3 (`phase-3-roles-authorization.md`), Phase 4 (`phase-4-working-calendar.md`), Phase 5 (`phase-5-legal-configuration.md`), Phase 5.5 (`phase-5.5-service-forms-attachments.md`) |
| **Related decisions**  | MVP 3.1, 3.5, 3.6, 3.9, D4, D5, D6, D7, D24-D26, D28-D36; open question 4; Technical T2, T8, T11, T15-T17, T21, T22, T24-T26, T29, T30, T33-T39, T41                                                                                 |

---

## 1. Objective

Carry one legal request from submission to closure: the requester submits it with the service's form, legal reviews and accepts or rejects it, the workflow's stages run with the people the positions resolve to, information is requested from the requester when needed, and the request closes with its SLA record.
It is needed now because every earlier phase exists to support this one, and Phase 7 cannot escalate or notify about requests that do not exist.

## 2. Scope

**In scope:**

- Request numbers `REQ-<n>-<year>`, restarting each year (Q12).
- The requester-facing catalog: active services with their forms, and active priorities.
- Submission with form answers and documents, under the Active subscription and configured escalation.
- Five permissions, and who sees which requests (Q3, Q4).
- Review: priority changes with a reason, information requests, acceptance with a handler and a workflow, rejection, and withdrawal by the requester before acceptance (Q9).
- Stage execution: stage runs with recorded assignees, complete, return, narrow, escalate, refresh assignees, and the skip, hold, and escalate fallbacks (Q16-Q21).
- Reassigning the handler.
- Information requests during review and execution (Q7) and closure as "Rejected - no response" (Q8).
- Attachments on a request: attach, remove, download (Q22, Q23).
- The SLA deadline computed live and the closure record frozen at closure (Q6).
- Audit of every action in the same transaction (T8).

**Out of scope (and where it is handled instead):**

- Firing R0-R2, the background job, and notifications: Phase 7, which reads the timestamps and the live deadline this phase provides (4.3, "Contract with Phase 7").
- MVP open question 6 (SLA clocks and escalations in Read-only) and open question 8 (notification events): Phase 7.
- Numbering other records (`INV`, `CAS`, `MAT` were named for later, Q13): the numbering table takes a prefix so they can be added without a migration of its shape.
- Editing a request after submission (Q14): corrections go through information requests.
- Rejecting an accepted request for any reason other than no response (Q10).
- Parallel or conditional stages, routing policies: later phases (MVP section 4).
- Reports and analytics, and search beyond the list filters below.

## 3. Requirements

Example tenant **Al-Noor**, with the structure, people, and configuration of the Phase 5 spec (section 3):

```
Al-Noor (the tenant; not a unit)                no unit: Sara (owner), Lina (IT admin)
├── Legal Affairs (department)                  managers: Huda, Ahmed
│   ├── Contracts (section)                     managers: Faisal; member: Nora
│   └── Litigation (section)                    no manager
└── Finance (department)                        managers: Majed
    └── Procurement (section)                   managers: Reem; member: Khalid
```

- Service "Vendor contract review" allows the workflows "Vendor contract" (default) and "Complex contract", and has the Phase 5.5 form (vendor name, contract value, contract type, start date, draft contract file).
- "Vendor contract" v1 has four stages: 1 Business approval (Requester's department managers, hold); 2 Drafting (Handler, hold); 3 Procurement check (Procurement Reviewer, skip, excluding the parties); 4 Supervisor sign-off (Contracts Supervisor, escalate, excluding the parties; the handler may escalate).
- Priorities: Urgent 2 days, High 5 days, Normal 10 days. Escalation is configured.
- Roles: Sara gives every member `request.submit` at own scope and `request.view` at own scope.
  Huda and Ahmed (Head of Legal) also hold `request.view` at organization scope, `request.review`, `request.handle`, and `request.reassign`.
  Faisal and Nora (Legal Staff) also hold `request.view` at department scope and `request.handle`.
  Majed (Finance manager) holds `request.view` at department scope.

The two sides of a request are the **requester** and the **handler** (the request owner, MVP 3.5).

| ID    | Requirement                                                                                                                                                                                                                                                                                                            | Example                                                                                                                                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R6.1  | Every submitted request gets a number unique in its tenant and year: `REQ-<n>-<year>`, where the year is the Gregorian year of submission in Riyadh time and `n` counts from 1 each year, with no gaps and no zero padding.                                                                                            | _Khalid's request is the 42nd of 2026: `REQ-42-2026`. The first request submitted on 2027-01-01 at 00:05 Riyadh time is `REQ-1-2027`._                                                                                                   |
| R6.2  | A requester sees the active services with their forms and the active priorities, under `request.submit`.                                                                                                                                                                                                               | _Khalid opens the catalog and sees "Vendor contract review" with its five fields, and Urgent, High, Normal._                                                                                                                             |
| R6.3  | Submission takes a service, a priority, a title, the form answers, and optional extra files. The answers are checked against the service's current form and stored as a snapshot; the form's files and the extra files are attached.                                                                                   | _Khalid submits #42 with "Gulf Supplies", 480,000, Supply, and his uploaded draft contract. Leaving "Vendor name" empty: 400 `required` at `answers.<field ID>`._                                                                        |
| R6.4  | Submission needs an Active subscription and configured escalation settings.                                                                                                                                                                                                                                            | _In Grace: 403 `SUBSCRIPTION_NOT_ACTIVE`. Before Al-Rashid saves its escalation settings: 409 `ESCALATION_NOT_CONFIGURED`._                                                                                                              |
| R6.5  | A request copies, at submission, the service's name and the priority's name and days, and records the requester's unit. Later edits to the service, the priority, or the requester's unit do not change it.                                                                                                            | _Huda renames the service and changes High to 3 days; #42 still shows "Vendor contract review" and High, 5 days. Khalid moves to Finance; #42 stays with Procurement._                                                                   |
| R6.6  | Nothing in a submitted request can be edited by the requester.                                                                                                                                                                                                                                                         | _Khalid cannot change the contract value; Faisal asks for the corrected value through an information request._                                                                                                                           |
| R6.7  | A person sees a request when they are its requester, its handler, a current assignee of its active stage, a reviewer while it is in review, or when `request.view` covers the requester's recorded unit or the handler's recorded unit at their scope. Anyone else gets 404.                                           | _Majed (department scope) sees Finance's requests, #42 included. Huda (organization) sees all. Nora (department scope, Legal Affairs) sees #42 once Faisal handles it. Reem sees #42 only while she is an assignee of its active stage._ |
| R6.8  | Lists can be filtered to "waiting on me" (I am an assignee of an active stage, or the requester of an open information request), "I handle", "I requested", and "review queue" (in review, for reviewers), and by state and service.                                                                                   | _Majed's "waiting on me" shows #42 while Business approval waits on him._                                                                                                                                                                |
| R6.9  | While a request is in review, a reviewer may change its priority with a reason; at acceptance it is locked.                                                                                                                                                                                                            | _Huda raises #42 from High to Urgent with "board meeting on Thursday"; the audit holds both levels and the reason._                                                                                                                      |
| R6.10 | A reviewer accepts a request in review by choosing a handler and one of the service's allowed active workflows; the request takes that workflow's current version, the SLA clock starts, and the first stage starts.                                                                                                   | _Huda accepts #42 with Faisal and "Vendor contract"; #42 is in progress on v1 and Business approval waits on Majed._                                                                                                                     |
| R6.11 | The handler is an active member who holds `request.handle` and is not the requester. A reviewer may choose themselves.                                                                                                                                                                                                 | _Choosing Khalid for his own request: 400 `handler_is_requester`. Choosing Reem (no `request.handle`): 400 `handler_not_eligible`._                                                                                                      |
| R6.12 | A reviewer may reject a request in review with a reason; the requester may withdraw it before acceptance with a reason. Neither is possible after acceptance.                                                                                                                                                          | _Khalid withdraws #42 before review ends: it closes as Withdrawn. After acceptance: 409 `INVALID_REQUEST_STATE`._                                                                                                                        |
| R6.13 | When a stage starts, its target is resolved and the assignees are recorded. If nobody is found, the stage's fallback applies: skip records the stage as skipped and starts the next; escalate climbs levels; hold waits with no assignees.                                                                             | _Procurement check on #42 resolves to nobody and is skipped. Supervisor sign-off escalates to Huda and Ahmed._                                                                                                                           |
| R6.14 | Any one recorded assignee who still qualifies at that moment may complete or return the active stage; the first action wins.                                                                                                                                                                                           | _Huda and Ahmed both press complete on Supervisor sign-off; Huda's arrives first and Ahmed gets 409 `STAGE_NOT_ACTIVE`. Khalid, moved out of Procurement, can no longer act on a stage that recorded him._                               |
| R6.15 | Completing takes an optional comment. Completing the last stage completes the request.                                                                                                                                                                                                                                 | _Huda completes Supervisor sign-off; #42 is Completed and its closure record is written._                                                                                                                                                |
| R6.16 | Returning takes a reason and goes back to the nearest earlier stage that ran (not one that was skipped); that stage starts again from its position, without earlier narrowing or escalation. The first stage that ran cannot be returned.                                                                              | _Huda returns Supervisor sign-off; Procurement check was skipped, so Drafting starts again for Faisal._                                                                                                                                  |
| R6.17 | Where the stage allows it, the handler may narrow the assignees to some of them, or escalate to the next level, each with a reason.                                                                                                                                                                                    | _Faisal escalates Supervisor sign-off from Huda and Ahmed: the chain has ended, 409 `NO_HIGHER_LEVEL`._                                                                                                                                  |
| R6.18 | The handler may refresh the active stage's assignees: the target is resolved again and the fallback applies if nobody is found.                                                                                                                                                                                        | _Business approval holds because Finance has no manager; Sara makes Majed its manager; Faisal refreshes and the stage waits on Majed._                                                                                                   |
| R6.19 | A holder of `request.reassign` may change the handler of a request in progress, with a reason; the new handler meets R6.11, and the active stage is refreshed.                                                                                                                                                         | _Faisal is deactivated; Ahmed makes Nora the handler; Drafting now waits on Nora._                                                                                                                                                       |
| R6.20 | An information request asks the requester a question. It may be asked by a reviewer in review, and by the handler or a current assignee of the active stage in progress. At most one is open per request. The requester answers with text and optional files, which closes it; its asker or the handler may cancel it. | _Majed asks Khalid "Is this within the Q4 budget?" while approving; Faisal's later question: 409 `INFORMATION_REQUEST_OPEN`._                                                                                                            |
| R6.21 | While an information request is open, the handler may close the request as "Rejected - no response" with a reason.                                                                                                                                                                                                     | _Khalid never answers; on 11-20 Faisal closes #42 as Rejected - no response._                                                                                                                                                            |
| R6.22 | The SLA deadline is the acceptance time plus the priority's days in working time (D24, D25), computed from the current calendar whenever it is read (D26), and frozen at closure.                                                                                                                                      | _#42 accepted Sunday 11-01 10:00 as High (5): deadline Sunday 11-08 10:00. Sara declares 11-05 a holiday on 11-03: the deadline becomes Monday 11-09 10:00._                                                                             |
| R6.23 | The closure record of an accepted request holds the outcome, the deadline, the elapsed working time, met or breached, the breach duration, and the working time spent awaiting information. A request closed before acceptance has an outcome and no SLA.                                                              | _#42 completed Tuesday 11-10 at 10:00: deadline Monday 11-09 10:00, breached by 1 working day; Khalid's answer took half a working day, shown as 0.5 days awaiting information._                                                         |
| R6.24 | While a request is open, the requester, the handler, the current stage assignees, and reviewers in review may attach files; anyone who sees the request may download them; at most 50 files per request.                                                                                                               | _Majed attaches the signed budget approval while approving. Nora downloads it._                                                                                                                                                          |
| R6.25 | Whoever attached a file, or the handler, may remove it while the request is open, with a reason; the file is deleted, and the audit keeps its name, size, and SHA-256.                                                                                                                                                 | _Khalid removes the draft that shows a colleague's ID card, reason "wrong file"; the file is gone, the audit keeps what it was._                                                                                                         |
| R6.26 | Every action is audited in the same transaction; in Grace everything except submission works; in Read-only every action is refused.                                                                                                                                                                                    | _In Read-only, Huda's accept: 403 `SUBSCRIPTION_READ_ONLY`._                                                                                                                                                                             |
| R6.27 | Every endpoint reads and writes only the caller's tenant.                                                                                                                                                                                                                                                              | _Huda sends an Al-Rashid user as handler: 400 `handler_not_eligible`; an Al-Rashid request ID in a path: 404._                                                                                                                           |

## 4. Design

### 4.1 Data model

#### Numbers

**`number_sequences`** (new, tenant data): `tenant_id`, `prefix` (`text`, check `prefix in ('REQ')`), `year` (`smallint`), `last_value` (`integer`); primary key `(tenant_id, prefix, year)`.

`nextNumber(tx, tenantId, prefix)` runs one statement inside the submission's transaction:

```sql
insert into number_sequences (tenant_id, prefix, year, last_value)
values ($1, $2, extract(year from now() at time zone 'Asia/Riyadh'), 1)
on conflict (tenant_id, prefix, year) do update set last_value = number_sequences.last_value + 1
returning year, last_value
```

The row lock it takes makes two concurrent submissions take 42 and 43, and a submission that rolls back also rolls back its increment, so numbers have no gaps (a PostgreSQL sequence would leave gaps on rollback).
The year comes from the database clock in Riyadh time, as subscription state does (T15).
Why a prefix column now (Q13): the owner named `INV`, `CAS`, and `MAT` for later; adding one is then a new allowed value, not a new table.

#### Requests

**`request_states`** enum: `in_review`, `in_progress`, `completed`, `rejected`, `rejected_no_response`, `withdrawn`; the last four are closed.

**`requests`** (new, tenant data):

| Column                                              | Type                          | Notes                                                                                                                               |
| --------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                | `uuid` PK                     |                                                                                                                                     |
| `tenant_id`                                         | `uuid`                        | FK to `tenants`.                                                                                                                    |
| `year`, `number`                                    | `smallint`, `integer`         | Unique `(tenant_id, year, number)`; shown as `REQ-<number>-<year>`.                                                                 |
| `state`                                             | `request_states`              |                                                                                                                                     |
| `title`                                             | `text`                        | Trimmed, 1-200 characters (Q24).                                                                                                    |
| `service_id`                                        | `uuid`                        | Composite FK to `services`.                                                                                                         |
| `service_name`                                      | `text`                        | Copied at submission (R6.5).                                                                                                        |
| `form_revision`                                     | `integer`                     | The form revision the answers were checked against.                                                                                 |
| `answers`                                           | `jsonb`                       | The snapshot from `snapshotAnswers` (Phase 5.5, 4.2).                                                                               |
| `requester_id`                                      | `uuid`                        | Composite FK `(tenant_id, requester_id)` → `tenant_members`.                                                                        |
| `requester_unit_id`                                 | `uuid`                        | Recorded at submission (Q4); composite FK to `org_units`, `on delete set null (requester_unit_id)`.                                 |
| `priority_id`                                       | `uuid`                        | Composite FK to `priorities`.                                                                                                       |
| `priority_name`, `priority_days`                    | `text`, `smallint`            | Copied at submission and at each priority change in review (Phase 5 contract).                                                      |
| `handler_id`                                        | `uuid`                        | Null in review; composite FK to `tenant_members`.                                                                                   |
| `handler_unit_id`                                   | `uuid`                        | Recorded at acceptance and reassignment (Q4); FK as for the requester's unit.                                                       |
| `workflow_id`, `workflow_version_id`                | `uuid`                        | Set at acceptance; composite FK `(tenant_id, workflow_id, workflow_version_id)` → `workflow_versions (tenant_id, workflow_id, id)`. |
| `submitted_at`                                      | `timestamptz`                 |                                                                                                                                     |
| `accepted_at`, `accepted_by`                        | `timestamptz`, `uuid`         | The SLA clock starts at `accepted_at`.                                                                                              |
| `closed_at`, `closed_by`, `close_reason`            | `timestamptz`, `uuid`, `text` | `close_reason` for rejection, withdrawal, and no response.                                                                          |
| `sla_deadline`                                      | `timestamptz`                 | Null until closure; frozen at closure (Q6).                                                                                         |
| `elapsed_days`, `breach_days`, `awaiting_info_days` | `numeric(12,6)`               | Working days, frozen at closure.                                                                                                    |
| `sla_met`                                           | `boolean`                     | Frozen at closure.                                                                                                                  |

Checks keep the state and the columns consistent:

- `in_review`: no handler, no workflow, not accepted, not closed.
- `in_progress`: handler, workflow version, and `accepted_at` set; not closed.
- `completed`, `rejected_no_response`: accepted and closed, with the SLA columns set.
- `rejected`, `withdrawn`: closed, never accepted, SLA columns null.

Unique `(tenant_id, id)` and `(tenant_id, id, workflow_version_id)` are the targets of the stage and attachment keys.
Indexes: `(tenant_id, state)`, `(tenant_id, requester_id)`, `(tenant_id, handler_id)`, `(tenant_id, requester_unit_id)`, `(tenant_id, handler_unit_id)`.

Why the units are recorded (Q4): Khalid's old requests stay with Procurement when he moves.
Why `on delete set null` on the units: Phase 2 deletes only empty units, but a unit with old requests would otherwise become undeletable; after a deletion those requests are visible by the remaining unit, by party, or at organization scope.
Why the deadline is not stored while open (Q6): it must follow later calendar changes (D26); a stored value would go stale on every calendar write.

#### Stage runs

A **run** is one start of one workflow stage on one request: returning to a stage starts a new run, so the history of #42 shows Drafting twice.

**`stage_run_states`** enum: `active`, `held`, `completed`, `returned`, `skipped`, `cancelled` (the request closed while it was active or held).

**`request_stage_runs`** (new, tenant data):

| Column                                           | Type               | Notes                                                                                                                                                              |
| ------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                             | `uuid` PK          |                                                                                                                                                                    |
| `tenant_id`, `request_id`, `workflow_version_id` | `uuid`             | Composite FK `(tenant_id, request_id, workflow_version_id)` → `requests`.                                                                                          |
| `workflow_stage_id`                              | `uuid`             | Composite FK `(tenant_id, workflow_version_id, workflow_stage_id)` → `workflow_stages (tenant_id, version_id, id)`: a run always belongs to its request's version. |
| `ordinal`                                        | `smallint`         | Copied from the stage, for ordering.                                                                                                                               |
| `state`                                          | `stage_run_states` |                                                                                                                                                                    |
| `level`                                          | `jsonb`            | The resolver level the assignees came from (Phase 5 `AssigneeLevelType`); null while held.                                                                         |
| `narrowed`, `escalated`                          | `boolean`          |                                                                                                                                                                    |
| `started_at`, `ended_at`, `ended_by`             |                    |                                                                                                                                                                    |
| `comment`                                        | `text`             | Completion comment or return reason, up to 2,000 characters.                                                                                                       |

Partial unique index `(request_id) where state in ('active', 'held')`: one live run per request.

**`request_stage_assignees`**: `tenant_id`, `run_id` (composite FK), `user_id` (composite FK to `tenant_members`); primary key `(run_id, user_id)`; index `(tenant_id, user_id)`.
The rows of ended runs are kept, so the history shows who a stage waited on.

Why assignees are recorded (Q16): "who is #42 waiting on" is a stored fact, "waiting on me" is one indexed query, and narrowing has a list to narrow.

#### Information requests

**`information_requests`** (new, tenant data): `id`, `tenant_id`, `request_id` (composite FK), `asked_by`, `asked_in` (`review` or `execution`), `question` (1-4,000 characters), `asked_at`, `state` (`open`, `answered`, `cancelled`, `closed`), `answer` (1-10,000 characters, set when answered), `ended_at`, `ended_by`.
Partial unique index `(request_id) where state = 'open'`: one open per request.
`closed` marks one still open when the request closed.

#### Request files

**`request_files`** (new, tenant data): `tenant_id`, `request_id` (composite FK), `file_id` (composite FK `(tenant_id, file_id)` → `files (tenant_id, id)`, primary key), `field_id` (`uuid`, set for a form answer), `information_request_id` (composite FK, set for an answer's files), `attached_by`, `attached_at`.
Index `(request_id)`.
Removing a file deletes its link row and marks the file `discarded` (Phase 5.5, `discardFiles`); the history of the removal is the audit entry (Q22).
A form answer that named a removed file keeps the file ID in its snapshot, and the response shows that file as removed.

#### Migrations

Generated `0015_requests` (numbers, requests), `0016_stage_runs`, `0017_information_requests`, `0018_request_files`, one per step (section 7); parallel steps are renumbered when merged.

#### Audit actions

| Action                                                                                           | Resource | `details`                                                                    |
| ------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------- |
| `request.submitted`                                                                              | request  | number, service, priority, title, file IDs                                   |
| `request.priority_changed`                                                                       | request  | `{before, after, reason}` (name and days)                                    |
| `request.accepted`                                                                               | request  | handler, workflow and version, priority, and the stage transitions it caused |
| `request.rejected`, `request.withdrawn`                                                          | request  | `{reason}`                                                                   |
| `request.handler_changed`                                                                        | request  | `{before, after, reason}` and the refreshed stage                            |
| `request.stage_completed`, `request.stage_returned`                                              | request  | run, stage, comment or reason, and the stage transitions it caused           |
| `request.stage_narrowed`, `request.stage_escalated`, `request.stage_refreshed`                   | request  | run, `{before, after}` assignees and levels, reason                          |
| `request.information_requested`, `request.information_answered`, `request.information_cancelled` | request  | information request ID, question or answer, file IDs                         |
| `request.completed`, `request.closed_no_response`                                                | request  | the closure record; `{reason}` for no response                               |
| `request.files_attached`, `request.file_removed`                                                 | request  | file IDs; for a removal the name, size, SHA-256, and reason                  |

A **stage transition** is `{run, stage, state, assignees, level}`: every start, skip, hold, escalation by fallback, and completion an action causes is listed in that action's entry, so stage assignments are audited (MVP 3.9) without an entry per automatic step.

### 4.2 API

Tenant routes run `authenticate()`, `requireRole('user')`, and the subscription guard (T16).
Routes for parties (requester, handler, assignees) declare no permission: being the party is the authorization, re-checked in the database (D31; recorded exception to T24, as Phase 5 records).

| Method | Path                                                | Who                                   | Request                                                                                                       | Responses                                                                                              |
| ------ | --------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/requests/catalog`                                 | `request.submit`                      |                                                                                                               | 200 `{services:[{id, name, description, form}], priorities:[{id, name, days}]}`                        |
| POST   | `/requests`                                         | `request.submit`, Active subscription | `{serviceId, priorityId, title, answers, fileIds?}`                                                           | 201 `{request}`; 400; 403 `SUBSCRIPTION_NOT_ACTIVE`; 409 `ESCALATION_NOT_CONFIGURED`, `TOO_MANY_FILES` |
| GET    | `/requests`                                         | anyone; rows by R6.7                  | `view?` (`waiting_on_me`, `handling`, `requested`, `review_queue`), `state?`, `serviceId?`, `limit`, `offset` | 200 `{requests:[summary], total}`                                                                      |
| GET    | `/requests/:id`                                     | R6.7                                  |                                                                                                               | 200 `{request}`; 404                                                                                   |
| PUT    | `/requests/:id/priority`                            | `request.review`, in review           | `{priorityId, reason}`                                                                                        | 200; 400; 404; 409 `INVALID_REQUEST_STATE`                                                             |
| POST   | `/requests/:id/accept`                              | `request.review`, in review           | `{handlerId, workflowId}`                                                                                     | 200; 400; 404; 409 `INVALID_REQUEST_STATE`                                                             |
| POST   | `/requests/:id/reject`                              | `request.review`, in review           | `{reason}`                                                                                                    | 200; 404; 409                                                                                          |
| POST   | `/requests/:id/withdraw`                            | the requester, in review              | `{reason}`                                                                                                    | 200; 404; 409                                                                                          |
| PUT    | `/requests/:id/handler`                             | `request.reassign`, in progress       | `{handlerId, reason}`                                                                                         | 200; 400; 404; 409                                                                                     |
| POST   | `/requests/:id/stages/:runId/complete`              | an assignee                           | `{comment?}`                                                                                                  | 200; 403; 404; 409 `STAGE_NOT_ACTIVE`                                                                  |
| POST   | `/requests/:id/stages/:runId/return`                | an assignee                           | `{reason}`                                                                                                    | 200; 403; 404; 409 `STAGE_NOT_ACTIVE`, `NO_EARLIER_STAGE`                                              |
| POST   | `/requests/:id/stages/:runId/narrow`                | the handler, if the stage allows      | `{userIds, reason}`                                                                                           | 200; 400 `not_assignee`; 403; 404; 409                                                                 |
| POST   | `/requests/:id/stages/:runId/escalate`              | the handler, if the stage allows      | `{reason}`                                                                                                    | 200; 403; 404; 409 `NO_HIGHER_LEVEL`                                                                   |
| POST   | `/requests/:id/stages/:runId/refresh`               | the handler                           | `{reason?}`                                                                                                   | 200; 403; 404; 409                                                                                     |
| POST   | `/requests/:id/information-requests`                | R6.20                                 | `{question}`                                                                                                  | 201; 403; 404; 409 `INFORMATION_REQUEST_OPEN`, `INVALID_REQUEST_STATE`                                 |
| POST   | `/requests/:id/information-requests/:infoId/answer` | the requester                         | `{answer, fileIds?}`                                                                                          | 200; 403; 404; 409                                                                                     |
| POST   | `/requests/:id/information-requests/:infoId/cancel` | its asker or the handler              |                                                                                                               | 200; 403; 404; 409                                                                                     |
| POST   | `/requests/:id/close-no-response`                   | the handler, in progress              | `{reason}`                                                                                                    | 200; 403; 404; 409 `NO_OPEN_INFORMATION_REQUEST`                                                       |
| POST   | `/requests/:id/files`                               | R6.24                                 | `{fileIds}`                                                                                                   | 200; 400; 403; 404; 409 `TOO_MANY_FILES`                                                               |
| POST   | `/requests/:id/files/:fileId/remove`                | R6.25                                 | `{reason}`                                                                                                    | 200; 403; 404; 409                                                                                     |
| GET    | `/requests/:id/files/:fileId/content`               | R6.7                                  |                                                                                                               | 200 the bytes as a download (Phase 5.5 headers); 404                                                   |

Shapes:

- **Summary:** `{id, number: "REQ-42-2026", title, state, service: {id, name}, priority: {name, days}, requester: {id, name}, handler, submittedAt, acceptedAt, closedAt, deadline, activeStage: {name, waitingOn:[{id, name}]}}`.
- **Request:** the summary plus `answers` (with removed files marked), `files`, `stages` (every run in order, with assignees, state, times, and comments), `informationRequests`, `sla`, and `allowedActions` (the actions the caller may take now, so the web app shows only valid buttons).
- **SLA:** `{deadline, elapsedDays, met, breachDays, awaitingInfoDays}`: live while in progress, the frozen record once closed, null before acceptance.

Lists are ordered by `submitted_at` descending, then `id`; `limit` is 1-100, default 25, with `offset`, as `GET /users`.
`deadline` in lists is computed in memory with one `loadCalendar` per request (Q6).
Reasons are trimmed, 1-2,000 characters; comments up to 2,000.
`fileIds` are the caller's pending uploads (Phase 5.5); refusals come from `attachFiles` at `fileIds.<index>`.

#### New error codes

| HTTP | Code                          | When                                                              |
| ---- | ----------------------------- | ----------------------------------------------------------------- |
| 403  | `SUBSCRIPTION_NOT_ACTIVE`     | Submitting in Grace (Phase 1's `requireActiveSubscription`).      |
| 409  | `ESCALATION_NOT_CONFIGURED`   | Submitting before the tenant saved its escalation settings (D33). |
| 409  | `INVALID_REQUEST_STATE`       | The action is not allowed in the request's state.                 |
| 409  | `STAGE_NOT_ACTIVE`            | The run is not the request's live run, or no longer active.       |
| 409  | `NO_EARLIER_STAGE`            | Returning from the first stage that ran.                          |
| 409  | `NO_HIGHER_LEVEL`             | Escalating past the department's managers.                        |
| 409  | `INFORMATION_REQUEST_OPEN`    | A second information request while one is open.                   |
| 409  | `NO_OPEN_INFORMATION_REQUEST` | "No response" closure without an open information request.        |
| 409  | `TOO_MANY_FILES`              | More than 50 files on one request.                                |

Validation detail codes: `unknown_service`, `service_retired`, `unknown_priority`, `priority_retired`, `unknown_workflow`, `workflow_not_allowed`, `workflow_retired`, `handler_not_eligible`, `handler_is_requester`, `not_assignee`, `same_handler`, plus the answer codes of Phase 5.5 and the `attachFiles` codes.

#### Permissions

Five catalog keys (T26); the Tenant Admin role holds them at once (D21):

| Key                | Scopes                                 | Grants                                                                             |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `request.submit`   | own                                    | the catalog and submission                                                         |
| `request.view`     | own, section, department, organization | requests whose recorded requester or handler unit is within scope (R6.7)           |
| `request.review`   | organization                           | the review queue, priority changes, information requests in review, accept, reject |
| `request.handle`   | organization                           | being eligible as a handler (checked on the chosen person, not the caller)         |
| `request.reassign` | organization                           | changing the handler                                                               |

### 4.3 Key flows and state transitions

#### States

```
                 submit
                   │
                   ▼
   withdraw ◄── in_review ──► reject
 (withdrawn)       │         (rejected)
                   │ accept (handler, workflow; clock starts)
                   ▼
              in_progress ──► close no response (rejected_no_response)
                   │
                   │ last stage completed
                   ▼
               completed
```

Every action locks the request row `FOR UPDATE` first and then checks the state, so two actions on one request are serialized and the second sees the first's result.
Example: Huda accepts #42 while Khalid withdraws it; whichever locks first wins, and the other gets 409 `INVALID_REQUEST_STATE`.

#### Submitting

In one transaction:

1. `requireActiveSubscription` (route) and `isEscalationConfigured` (409 `ESCALATION_NOT_CONFIGURED`).
2. Lock the service and the priority `FOR SHARE` and check they are active (as T36 for configuration writes), so a retire cannot slip in between.
3. `validateAnswers(service.form, answers)`; on failure 400 with the details.
4. `nextNumber(tx, tenantId, 'REQ')`.
5. Insert the request with the copies of R6.5 and `snapshotAnswers(...)`; record the requester's current unit.
6. `attachFiles` for the files named in file answers and in `fileIds` (Phase 5.5), then insert the `request_files` rows with their `field_id`; more than 50: 409 `TOO_MANY_FILES`.
7. Audit `request.submitted`.

#### Accepting

1. Lock the request; it must be in review.
2. Check the handler (R6.11): an active member of the tenant, not the requester, holding `request.handle` by their role read from the database (not anybody's token).
3. Lock the workflow `FOR SHARE`; it must be active and in the service's current allowed list.
4. Set the handler, the handler's current unit, the workflow and its current version, `accepted_at = now()`, `accepted_by`, state `in_progress`.
5. Start the first stage (below).
6. Audit `request.accepted` with the transitions.

#### Starting a stage

`startStage(tx, request, ordinal)`:

1. Resolve the stage's target with `resolveAssignees(tx, tenantId, target, {handlerId, requesterId}, {excludeParties})`.
2. Found people: insert an `active` run with the level and the assignees.
3. Nobody, fallback **skip**: insert a `skipped` run (started and ended now) and start the next stage; after the last stage, complete the request.
4. Nobody, fallback **escalate**: `nextLevel`; found: an `active` run with `escalated = true`; null: a `held` run.
5. Nobody, fallback **hold**: a `held` run.

All of it runs in the caller's transaction and is listed as transitions in the caller's audit entry.
A workflow whose stages all skip completes the request at acceptance.

#### Acting on a stage

Complete and return:

1. Lock the request; it must be in progress, and the run must be its live run and `active` (else 409 `STAGE_NOT_ACTIVE`).
2. The caller must be a recorded assignee **and** still be among the people at the run's level now (`peopleAtLevel`, below); else 403 `FORBIDDEN`.
3. **Complete:** the run becomes `completed`; start the next stage, or complete the request after the last.
4. **Return:** find the latest earlier run that is `completed` (skipped stages are passed over, Q18); none: 409 `NO_EARLIER_STAGE`; the run becomes `returned` and that stage starts again from its target (Q19).

The check in step 2 is why Khalid, moved out of Procurement after the stage recorded him, can no longer act (Phase 5 contract), and why Nora, newly made Contracts Supervisor, cannot act until a refresh (Q16).

Handler actions (the caller must be the current handler):

- **Narrow** (`handlerMayNarrow`): `userIds` must be a non-empty subset of the current assignees (`not_assignee` otherwise); the other rows are deleted; `narrowed = true`.
- **Escalate** (`handlerMayEscalate`): `nextLevel` from the run's level; null: 409 `NO_HIGHER_LEVEL`; otherwise the assignees and level are replaced; `escalated = true`.
- **Refresh** (an active or held run): resolve the stage's target again as in "Starting a stage" and replace the run's assignees and level in place, clearing `narrowed` and `escalated`; if nobody is found and the fallback is skip, the run becomes `skipped` and the next stage starts.

#### Reassigning the handler

Lock the request; in progress; the new handler meets R6.11 and differs from the current one (`same_handler`); set the handler and the handler's current unit; refresh the live run, since handler-relative targets and "exclude the parties" depend on who the handler is (Q20); audit.
If Faisal is deactivated, nobody can act as handler until a holder of `request.reassign` does this (Q17).

#### Information requests

- **Ask:** lock the request; in review the caller must hold `request.review`; in progress the caller must be the handler or a current assignee of the active run who still qualifies; no other open one (409 `INFORMATION_REQUEST_OPEN`, also enforced by the partial unique index).
- **Answer:** the requester only; text and optional pending files, attached with `information_request_id`; state `answered`.
- **Cancel:** its asker or the handler; state `cancelled` (Q25).
- An open information request stays open across acceptance (Q26) and is set to `closed` when the request closes.
- Nothing pauses: the SLA clock and stage work continue (D7).

#### Closing

`closeRequest(tx, request, outcome, actor, reason?)`, used by every closing path:

1. End the live run as `cancelled` (no response) or confirm none is live (completion).
2. Set any open information request to `closed`.
3. For an accepted request, load the calendar and freeze the closure record:
   - `sla_deadline = addWorkingDays(calendar, accepted_at, priority_days)`;
   - `elapsed_days = workingDaysBetween(calendar, accepted_at, closed_at)`;
   - `sla_met = closed_at <= sla_deadline`; `breach_days = workingDaysBetween(calendar, sla_deadline, closed_at)` when breached, else 0;
   - `awaiting_info_days`: the sum of `workingDaysBetween` over each information request's open time, clipped to `[accepted_at, closed_at]` (Q27).
4. Set the state, `closed_at`, `closed_by`, `close_reason`; audit.

Because the calendar's past never changes (D26), the record computed at closure is the one the calendar implied all along; freezing it means a later calendar rule never rewrites a closed record.

#### Attachments

- **Attach:** lock the request; open; the caller is a party allowed by R6.24 (a stage assignee must still qualify); `attachFiles`; at most 50 per request; audit.
- **Remove:** lock the request; open; the caller attached the file or is the handler (Q22); delete the link row and call `discardFiles` in the same transaction; audit the file's name, size, SHA-256, and the reason.
- **Download:** R6.7 visibility, the link row exists, then stream from the store with the Phase 5.5 download headers.

#### Visibility

`visibleRequests(tenantId, callerId)` is one SQL condition, used by the list, the read, and every action's lookup (anything not visible is 404):

```
requester_id = caller or handler_id = caller
or exists (an active or held run of this request with the caller among its assignees)
or (state = 'in_review' and the caller holds request.review)
or withinScope(request.view, owner = requester_id, unit = requester_unit_id)
or withinScope(request.view, owner = requester_id, unit = handler_unit_id)
```

`withinScope` is Phase 3's condition (T29), resolved from the caller's current unit and role, so a move or a role edit applies on the next request.

#### Changes to Phase 5 modules

- `positions` exports `peopleAtLevel(executor, tenantId, level, context, options)`, the function the resolver already uses internally, so stage actions can re-check a recorded level.
- `tenant-access` exports a check that a member's role, read from the database, holds a permission (for the handler check), if none suitable exists.

#### Contract with Phase 7

- R0 measures from `submitted_at` while `in_review`; R1 and R2 use the live deadline from `slaOf(request, calendar)`, exported by the requests module, while `in_progress`.
- Phase 7 resolves recipients with the request's requester and handler as the context.
- Firing is recorded by Phase 7, at most once per rule and request (D9).

### 4.4 Module structure

```
src/
  db/schema/requests.ts               new: number_sequences, requests, request_states enum
  db/schema/request-stages.ts         new: request_stage_runs, request_stage_assignees, stage_run_states enum
  db/schema/information-requests.ts   new
  db/schema/request-files.ts          new
  http/errors.ts                      (changed) new codes
  modules/
    requests/                         new: routes, controller, service, repository, config, schemas, types
      shared/numbers.ts               nextNumber
      shared/visibility.ts            visibleRequests
      shared/sla.ts                   slaOf, closeRequest
      shared/stages.ts                startStage and the stage actions
      index.ts                        slaOf and the readers Phase 7 needs
    positions/                        (changed) peopleAtLevel exported
    tenant-access/                    (changed) five permissions; a role-holds-permission check if needed
db/migrations/0015_requests.sql ... 0018_request_files.sql
```

`app.ts` gains `/requests`.
One module, because every action locks the same request row and shares its state rules; information requests and attachments are files inside it, not modules of their own.

## 5. Edge Cases and Failure Behavior

| Scenario                                                                                 | Expected behavior                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Khalid and Nora submit at the same moment on 2026-12-31 23:59:59.                        | The sequence row lock serializes them; they get consecutive numbers; a submission that fails validation after numbering rolls the number back.        |
| A submission at 2027-01-01 00:00:30 Riyadh time (2026-12-31 21:00:30 UTC).               | `REQ-1-2027`: the year is Riyadh's.                                                                                                                   |
| Huda retires the priority "High" while Khalid submits with it.                           | `FOR SHARE` versus `FOR UPDATE`: either the submission gets `priority_retired` or the retire waits and succeeds after; #42 keeps its copy either way. |
| Huda edits the form while Khalid fills it in.                                            | Answers are checked against the current form; a removed field is `unknown_field`, a new required one `required`; Khalid reloads the form.             |
| Huda accepts #42 while Khalid withdraws it.                                              | The request row lock serializes them; the second gets 409 `INVALID_REQUEST_STATE`.                                                                    |
| Huda and Ahmed complete Supervisor sign-off together.                                    | The row lock serializes them; the second finds the run `completed`: 409 `STAGE_NOT_ACTIVE`.                                                           |
| Majed is deactivated while Business approval waits only on him.                          | He can no longer act (step 2 re-check); the stage waits until Faisal refreshes it; R1 and R2 still show the delay (Phase 7).                          |
| Faisal (handler) is deactivated.                                                         | Handler actions are impossible until Ahmed reassigns; assignee actions on the stage continue.                                                         |
| Faisal escalates a stage that the fallback already escalated to Legal Affairs' managers. | `nextLevel` is null: 409 `NO_HIGHER_LEVEL`.                                                                                                           |
| The handler narrows to someone not assigned.                                             | 400 `not_assignee`.                                                                                                                                   |
| Returning from Drafting, the first stage that ran after Business approval was skipped.   | No earlier completed run: 409 `NO_EARLIER_STAGE`.                                                                                                     |
| All four stages resolve to nobody with skip.                                             | The request completes at acceptance; the closure record shows 0 elapsed days, met.                                                                    |
| Majed asks Khalid a question; Faisal tries to ask another.                               | 409 `INFORMATION_REQUEST_OPEN`, also enforced by the partial unique index.                                                                            |
| Faisal closes #42 as no response five minutes after asking.                              | Allowed (Q8); the closure record shows the minutes awaiting information and the audit shows who closed it and why.                                    |
| A calendar holiday is added after #42 closed.                                            | The frozen record does not change.                                                                                                                    |
| Khalid attaches a file that expired an hour ago.                                         | `file_expired` at `fileIds.0` (Phase 5.5).                                                                                                            |
| Khalid removes a form file the form required.                                            | Allowed with a reason; the answer shows the file as removed; the form is not re-checked (the snapshot is history).                                    |
| A 51st file.                                                                             | 409 `TOO_MANY_FILES`; nothing attached.                                                                                                               |
| Lina (no unit) submits.                                                                  | `requester_unit_id` is null; she, the handler, assignees, and organization-scope viewers see it.                                                      |
| A unit holding old requests is deleted.                                                  | Its ID becomes null on those requests; they stay visible by the other unit, by party, and at organization scope.                                      |
| Al-Noor enters Grace with #42 in progress.                                               | Stage actions, information requests, and attachments continue; submissions get 403 `SUBSCRIPTION_NOT_ACTIVE`.                                         |
| Read-only.                                                                               | Every write 403 `SUBSCRIPTION_READ_ONLY`; reads and downloads work.                                                                                   |

## 6. Security and Authorization

- **Trust boundaries:** every body is a zod strict object (T25); answers are checked by `validateAnswers`; file IDs pass through `attachFiles`, which accepts only the caller's own pending uploads.
- **Tenant isolation:** every query filters by tenant (T2); every link between rows is a composite foreign key with `tenant_id` (T21), including a run's stage, which must belong to the request's version.
- **Authorization:** five permissions (T26); party actions are authorized by being the party, re-checked in the database at the moment of the action, never from the token (D31, T27's reasoning); the handler check reads the chosen person's role from the database.
- **No information leak:** a request outside the caller's visibility is 404 for every route, including its files.
- **Separation of duties:** the handler is never the requester (Q5); stage exclusions come from Phase 5.
- **Audit:** every action in its transaction (T8), with reasons, the stage transitions it caused, and the removed files' fingerprints.

## 7. Implementation Steps

| Step                     | Objective                                                                      | Delivers                                                                                                                                                                                                                                                                                                                               | Acceptance criteria                                                                                    | Verification                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 Requests core        | A request can be submitted, seen, reviewed, accepted, rejected, and withdrawn. | Migration `0015`, the five permissions, `nextNumber`, the catalog, submission, `GET /requests` with views and filters, `GET /requests/:id`, `visibleRequests`, priority change, accept (handler and workflow; until 6.2 adds `startStage`, an accepted request has no stage run), reject, withdraw, `slaOf` and `closeRequest`, audit. | R6.1-R6.12, R6.22, R6.26, R6.27: every example in section 3 for these.                                 | Integration tests; mutation checks: removing the sequence upsert's conflict update, the request row lock, or a `withinScope` branch fails a test.   |
| 6.2 Stages               | The workflow runs.                                                             | Migration `0016`, `peopleAtLevel`, `startStage` wired into accept, complete, return, narrow, escalate, refresh, reassign, completion with the closure record.                                                                                                                                                                          | R6.13-R6.19, R6.23 for completed requests; the worked example of Phase 5 (4.3) runs end to end on #42. | Integration tests; mutation checks: removing the assignee re-check, the live-run unique index, or the skipped-run pass-over in return fails a test. |
| 6.3 Information requests | Questions to the requester and the no-response closure.                        | Migration `0017`, ask, answer, cancel, close no response, awaiting time in the closure record.                                                                                                                                                                                                                                         | R6.20, R6.21, R6.23 for no response.                                                                   | Integration tests; mutation check: removing the open-request check (with the index) fails a test.                                                   |
| 6.4 Attachments          | Files on a request.                                                            | Migration `0018`, attach, remove, download, the 50-file cap, files in submission and answers.                                                                                                                                                                                                                                          | R6.24, R6.25.                                                                                          | Integration tests; end-to-end check of the whole phase against a running server: #42 from submission to closure with files.                         |

Order: agent A builds 6.1, then 6.2.
Agent B starts after 6.1 is merged and builds 6.4, then 6.3, because answer files need 6.4's `request_files` table.
Migration numbers are fixed when the branches are merged.

## 8. Test Plan

Integration tests against real PostgreSQL and the S3-compatible server, with Al-Noor's configuration from section 3 and Al-Rashid for isolation.

| Requirement  | Test                                                                                                                                                | Step          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| R6.1         | Numbers per year, consecutive under concurrent submissions, rollback leaves no gap, the Riyadh year boundary.                                       | 6.1           |
| R6.2-R6.6    | Catalog; submission with every answer type; refusals; copies unchanged after configuration edits and moves.                                         | 6.1           |
| R6.7, R6.8   | Visibility matrix for each person in section 3 and each scope; views and filters; 404 for invisible requests.                                       | 6.1, 6.2      |
| R6.9-R6.12   | Priority change, accept, reject, withdraw; handler eligibility; the accept-versus-withdraw race.                                                    | 6.1           |
| R6.13-R6.19  | Every fallback; complete and return including skipped stages; the double-complete race; re-check after a move; narrow, escalate, refresh, reassign. | 6.2           |
| R6.20, R6.21 | Askers in each state; one open; answer with files; cancel; no-response closure.                                                                     | 6.3           |
| R6.22, R6.23 | Live deadline follows a new holiday; frozen record after closure; breach and awaiting-information times.                                            | 6.1, 6.2, 6.3 |
| R6.24, R6.25 | Who may attach and remove; cap; download headers; the removed file is swept.                                                                        | 6.4           |
| R6.26, R6.27 | Grace and Read-only for each route; audit rows; Al-Rashid IDs everywhere.                                                                           | all           |

## 9. Open Questions

Q1-Q11 are round 1 and Q12-Q23 round 2 of the pre-spec discussion; Q24-Q27 were raised by the draft. All are resolved.

| #   | Question                                                                                                                                                              | Options                                                                                                                                                                                                      | Resolution                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | What does a request contain?                                                                                                                                          | (a) A title and a description. (b) Description only.                                                                                                                                                         | **Resolved 2026-10-25: per-service fields and attachments**, built first as Phase 5.5 (P5.5.1); the request carries the form answers and files. Whether a title stays is Q24. |
| Q2  | Should requests have readable numbers?                                                                                                                                | (a) A number per tenant. (b) UUID only.                                                                                                                                                                      | **Resolved 2026-10-25: (a), in the format `REQ-42-2026`** (P6.1).                                                                                                             |
| Q3  | Which request permissions?                                                                                                                                            | (a) `request.submit`, `request.view`, `request.review`, `request.handle`, `request.reassign`; parties act without a permission. (b) Fold handle into review, no reassign.                                    | **Resolved 2026-10-25: (a)**, the five permissions of 4.2; requester, handler, and stage assignees act as parties (P6.4).                                                     |
| Q4  | Which unit does a request belong to for scoped viewing?                                                                                                               | (a) The requester's or the handler's unit, each recorded when set. (b) The requester's unit only. (c) The requester's current unit.                                                                          | **Resolved 2026-10-25: (a)**, `requester_unit_id` at submission and `handler_unit_id` at acceptance and reassignment (P6.5).                                                  |
| Q5  | Who can be the handler?                                                                                                                                               | (a) An active member with `request.handle`, never the requester; a reviewer may pick themselves. (b) The requester allowed.                                                                                  | **Resolved 2026-10-25: (a)** (R6.11).                                                                                                                                         |
| Q6  | Is the SLA deadline stored or computed?                                                                                                                               | (a) Computed when read from the current calendar, frozen at closure. (b) Stored and recomputed on calendar writes.                                                                                           | **Resolved 2026-10-25: (a)** (P6.6).                                                                                                                                          |
| Q7  | How do information requests work?                                                                                                                                     | (a) Reviewer in review, handler in execution, one open at a time, text answers, nothing pauses. (b) Execution only. (c) Stage assignees may also ask.                                                        | **Resolved 2026-10-25: (a) plus (c)**: the current stage assignees may also ask (R6.20).                                                                                      |
| Q8  | When can the handler close as "Rejected - no response"?                                                                                                               | (a) Any time while an information request is open, with a reason. (b) After a minimum open time.                                                                                                             | **Resolved 2026-10-25: (a)** (R6.21).                                                                                                                                         |
| Q9  | Can a requester withdraw? (MVP open question 4)                                                                                                                       | (a) Any time before closure. (b) Before acceptance only. (c) No.                                                                                                                                             | **Resolved 2026-10-25: (b)**, before acceptance only, with a reason; outcome `withdrawn` (P6.7).                                                                              |
| Q10 | Can the handler reject an accepted request for other reasons?                                                                                                         | (a) Yes, with a reason. (b) No.                                                                                                                                                                              | **Resolved 2026-10-25: (b)**: an accepted request ends only by completion or "Rejected - no response".                                                                        |
| Q11 | What happens when the last stage completes?                                                                                                                           | (a) The request completes automatically. (b) The handler closes it separately.                                                                                                                               | **Resolved 2026-10-25: (a)** (R6.15).                                                                                                                                         |
| Q12 | Does the number restart each year?                                                                                                                                    | (a) Yes, per Gregorian year of submission in Riyadh time. (b) No, one counter.                                                                                                                               | **Resolved 2026-10-25: (a)** (R6.1).                                                                                                                                          |
| Q13 | Which records are numbered?                                                                                                                                           | (a) Requests only. (b) Others too.                                                                                                                                                                           | **Resolved 2026-10-25: requests today; `INV`, `CAS`, and `MAT` later**, so the numbering table takes a prefix (P6.1).                                                         |
| Q14 | Can the requester edit after submitting?                                                                                                                              | (a) No; corrections through information requests. (b) Until review starts.                                                                                                                                   | **Resolved 2026-10-25: (a)** (R6.6).                                                                                                                                          |
| Q15 | (round 2 S1) Who can act on a stage?                                                                                                                                  | (a) Assignees recorded at start and re-checked against current data on action. (b) Resolved live each time.                                                                                                  | **Resolved 2026-10-25: (a)** (P6.8).                                                                                                                                          |
| Q16 | (S2) How does a stuck stage get going again?                                                                                                                          | (a) The handler's "refresh assignees", audited; a departed handler is first replaced by `request.reassign`. (b) Automatic refresh on structure changes.                                                      | **Resolved 2026-10-25: (a)** (R6.18, R6.19).                                                                                                                                  |
| Q17 | (S2, handler gone) Who unblocks a request whose handler left?                                                                                                         | As Q16.                                                                                                                                                                                                      | **Resolved 2026-10-25 with Q16: (a)**: a holder of `request.reassign` replaces the handler.                                                                                   |
| Q18 | (S3) Where does "return" go when the previous stage was skipped?                                                                                                      | (a) The nearest earlier stage that ran. (b) The previous stage, resolved again.                                                                                                                              | **Resolved 2026-10-25: (a)** (R6.16).                                                                                                                                         |
| Q19 | (S4) Does a returned-to stage keep its narrowing or escalation?                                                                                                       | (a) No, it starts again from its position. (b) Yes.                                                                                                                                                          | **Resolved 2026-10-25: (a)** (R6.16).                                                                                                                                         |
| Q20 | (S5) How does someone see their work?                                                                                                                                 | (a) Filters on `GET /requests`. (b) A separate `/inbox`.                                                                                                                                                     | **Resolved 2026-10-25: (a)** (R6.8). Reassignment refreshing the live run follows from Q16 (4.3).                                                                             |
| Q21 | (S6) What does each stage action take?                                                                                                                                | (a) Complete: optional comment; return, escalate, narrow: a reason. (b) Complete also requires a comment.                                                                                                    | **Resolved 2026-10-25: (a)** (4.2).                                                                                                                                           |
| Q22 | (A4) Who can remove an attachment, and when?                                                                                                                          | (a) Whoever attached it, or the handler, while open, with a reason; the file is deleted and the audit keeps its fingerprint. (b) Only whoever attached it.                                                   | **Resolved 2026-10-25: (a)** (R6.25; deletion decided in Phase 5.5, D36).                                                                                                     |
| Q23 | (A5) Who can attach and download?                                                                                                                                     | (a) Download: anyone who sees the request; attach while open: requester, handler, current stage assignees, reviewers in review; the requester also with information answers. (b) Requester and handler only. | **Resolved 2026-10-25: (a)** (R6.24).                                                                                                                                         |
| Q24 | Does a request keep a title besides the form answers? A list needs one line per request: "REQ-42-2026 · Vendor contract review · Gulf Supplies contract".             | (a) yes, a required title of 1-200 characters typed by the requester. (b) No title; lists show the number, service, and requester only. (c) The builder marks one form field as the title.                   | **Resolved 2026-10-25: (a)**, a required title of 1-200 characters typed by the requester, shown in lists with the number and the service.                                    |
| Q25 | Can an information request be cancelled? Majed asks Khalid about the budget, then finds the answer himself; without cancel, nobody else can ask until Khalid answers. | (a) yes, by its asker or the handler. (b) No; it stays open until answered or the request closes.                                                                                                            | **Resolved 2026-10-25: (a)**, its asker or the handler may cancel it, which frees the request for a new question.                                                             |
| Q26 | What happens to an information request open at acceptance? Huda asks Khalid a question in review, then accepts before he answers.                                     | (a) it stays open; Khalid can still answer; the handler may close as no response. (b) Acceptance is refused while one is open. (c) Acceptance cancels it.                                                    | **Resolved 2026-10-25: (a)**, it stays open across acceptance; the requester can still answer, and the handler may close the request as no response.                          |
| Q27 | How is "time awaiting information" in the closure record measured?                                                                                                    | (a) in working days, like the SLA, counting only time after acceptance. (b) In calendar time, from each question to its answer.                                                                              | **Resolved 2026-10-25: (a)**, in working days like the SLA, counting only time between acceptance and closure.                                                                |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #    | Decision                                                                                                                                                         | Rationale                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| P6.1 | Request numbers are `REQ-<n>-<year>` from a per-tenant, per-prefix, per-year counter row incremented in the submission's transaction.                            | Owner decisions (Q2, Q12, Q13); a row, not a sequence, so a rollback leaves no gap; the prefix makes later record types a value, not a table. |
| P6.2 | A request copies the service name and the priority's name and days, and snapshots the answers.                                                                   | A configuration edit never changes what a submitted request says (D34, Phase 5 contract).                                                     |
| P6.3 | One live stage run per request, with recorded assignees; each return starts a new run.                                                                           | Q15: a stored "waiting on", a simple "waiting on me", and a full history of who acted.                                                        |
| P6.4 | Party actions need no permission and are re-checked in the database at the moment of the action.                                                                 | D31 and Q3: Majed approves without legal permissions; a move takes effect at once.                                                            |
| P6.5 | Visibility is one SQL condition: parties, live-run assignees, reviewers for requests in review, and `withinScope` over the recorded requester and handler units. | Q4 and T29: scope follows the caller's current unit and role, the request's units are fixed when set.                                         |
| P6.6 | The deadline is computed when read, the closure record frozen at closure.                                                                                        | Q6 and D26: never stale while open, never rewritten once closed.                                                                              |
| P6.7 | Outcomes: completed, rejected (review only), rejected - no response (in progress only), withdrawn (before acceptance only).                                      | Q8-Q11; resolves MVP open question 4.                                                                                                         |
| P6.8 | Every action locks the request row first.                                                                                                                        | One rule serializes accept versus withdraw, two completes, and attach versus close, with no lost update.                                      |

Promote at close-out: P6.1, P6.3 with P6.4, P6.6, and P6.7 to `MVP_SCOPE.md` (3.5, 3.6, open question 4); P6.1 (storage), P6.3, P6.5, and P6.8 to `TECHNICAL_DECISIONS.md`.

## 11. Change Log

| Date       | Change                                                                                                                                                                            | Reason                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 2026-10-25 | Initial draft from the owner's round 1 and round 2 answers (Q1-Q23), with Q24-Q27 open.                                                                                           | Phase 5.5 implemented; Phase 6 spec drafted. |
| 2026-10-25 | Resolved Q24-Q27 with option (a): a required title, cancelable information requests, information requests open across acceptance, awaiting time in working days after acceptance. | Owner answering round.                       |
