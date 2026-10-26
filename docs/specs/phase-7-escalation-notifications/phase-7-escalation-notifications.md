# Phase 7 Spec: Escalation and Notifications

| Field                  | Value                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Status**             | Implemented                                                                                                                                                                                                                                                                    |
| **Approved by / date** | _Amr - 26/10/2026 - 13:42 pm_                                                                                                                                                                                                                                                  |
| **Depends on**         | Phase 1 (`phase-1-platform-subscriptions.md`), Phase 3 (`phase-3-roles-authorization.md`), Phase 4 (`phase-4-working-calendar.md`), Phase 5 (`phase-5-legal-configuration.md`), Phase 5.5 (`phase-5.5-service-forms-attachments.md`), Phase 6 (`phase-6-request-lifecycle.md`) |
| **Related decisions**  | MVP 3.1, 3.6, 3.7, 3.8, 3.9, D7-D10, D13, D20, D24-D26, D30, D32, D33, D35, D39; open questions 6 and 8; Technical T2, T8, T11, T14-T17, T21, T25, T26, T29, T33, T34, T41, T42, T46; deferred decision "Background job runner"                                                |

---

## 1. Objective

Watch every open request in the background and fire R0, R1, and R2 when their thresholds pass, and tell people what needs them through in-app notifications: escalations, the key lifecycle events of a request, and subscription and storage warnings.
It is needed now because Phase 6 records the timestamps and computes the live deadline, but nothing runs when nobody calls the API, so a request nobody looks at is never escalated.
It also runs the housekeeping jobs that earlier phases left for "the Phase 7 job runner", and resolves MVP open questions 6 (Read-only) and 8 (notification events).

## 2. Scope

**In scope:**

- A shared in-process scheduler that runs jobs behind one interface, chosen per process, so any job can later move to a worker of its own (Q1, Q9).
- The escalation check: R0, R1, and R2 fired at most once per request, recorded, audited, and notified to their resolved recipients (Q2-Q4).
- Escalation and the SLA clock during Grace and Read-only (Q5, MVP open question 6).
- In-app notifications: one row per recipient, read and unread, list, unread count, mark read, mark all read, retention (Q6).
- The notification event list (Q7, MVP open question 8).
- Subscription warnings (ends in 14 days, Grace, Read-only) and the storage warning (Q8).
- Housekeeping on the shared scheduler: the file sweep (moved, unchanged), expired refresh and password tokens, and old read notifications (Q9).

**Out of scope (and where it is handled instead):**

- A separate worker process: the interface is built now, the split is deferred (Q1); see "Deferred" in section 10.
- Email, SMS, or push notifications; live push to the browser (WebSocket or SSE): out of MVP scope (D10); the client polls the unread count.
- Repeated reminders after a breach, automatic reassignment on escalation, thresholds per priority: out of MVP scope (section 4).
- Pausing the SLA clock, including during Read-only: out of MVP scope (section 4).
- Notification preferences (muting a kind): not in the MVP.
- Notifying a user that their role changed (Phase 3 left it to this list; not chosen, Q7).

## 3. Requirements

Example tenant **Al-Noor**, with the structure, people, and configuration of the Phase 6 spec (section 3):

```
Al-Noor (the tenant; not a unit)                no unit: Sara (owner), Lina (IT admin)
├── Legal Affairs (department)                  managers: Huda, Ahmed
│   ├── Contracts (section)                     managers: Faisal; member: Nora
│   └── Litigation (section)                    no manager
└── Finance (department)                        managers: Majed
    └── Procurement (section)                   managers: Reem; member: Khalid
```

- Calendar: Sunday to Wednesday 08:00-16:00, Thursday 08:00-13:00, Friday and Saturday off (Phase 4).
- Position "Legal Intake" sits in Legal Affairs and is held by Ahmed.
- Escalation: R0 on, 2 working days, to Legal Intake; R1 on, 75%, to the Handler; R2 on, to the Handler, the Handler's unit managers, and the Handler's department managers.
- Sara and Majed hold the Tenant Admin role, so they hold `subscription.view` and `escalation.manage` (D21).
- **#42** (`REQ-42-2026`, Khalid, High = 5 working days) is accepted on Sunday 2026-11-01 at 10:00 with Faisal as handler: its deadline is Sunday 2026-11-08 at 10:00.
- **#43** (Khalid, Normal) is submitted on Monday 2026-11-02 at 09:00 and not yet reviewed.

| ID    | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                             | Example                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R7.1  | The escalation check runs in the background every minute, whether or not anyone uses the application, and looks at every open request of every tenant.                                                                                                                                                                                                                                                                                                  | _Nobody opens Watheeq on Wednesday afternoon; #42's R1 still fires at 16:00._                                                                                                                                                                                                                                                                                                                                  |
| R7.2  | **R0** fires when a request is still in review N working days after submission (N from the current settings). A request accepted, rejected, or withdrawn before then never gets R0.                                                                                                                                                                                                                                                                     | _#43's R0 is due Wednesday 2026-11-04 at 09:00; by 09:01 Ahmed (Legal Intake) is notified. Had Huda accepted #43 on Tuesday, R0 would never fire._                                                                                                                                                                                                                                                             |
| R7.3  | **R1** fires when X% of an in-progress request's SLA has passed and its deadline has not (Q2). The moment is `addWorkingDays(acceptedAt, priorityDays × X / 100)`.                                                                                                                                                                                                                                                                                      | _#42: 75% of 5 days is 3.75 working days after Sunday 10:00, which is Wednesday 2026-11-04 at 16:00; Faisal is notified._                                                                                                                                                                                                                                                                                      |
| R7.4  | **R2** fires when an in-progress request's deadline has passed.                                                                                                                                                                                                                                                                                                                                                                                         | _#42 is still open at Sunday 2026-11-08 10:00; by 10:01 Faisal, Huda, and Ahmed are notified._                                                                                                                                                                                                                                                                                                                 |
| R7.5  | Each rule fires at most once per request (D9), however many API instances run the check and however often the server restarts. The firing and its time are recorded and shown on the request. A firing is never undone, even if a later calendar change moves the moment it was due.                                                                                                                                                                    | _Two instances check #42 at 10:01; one firing, one notification each. `GET /requests/<#42>` shows `escalations: [{rule: "r1", firedAt: "2026-11-04T13:00:00Z"}, {rule: "r2", ...}]`. Sara adds a holiday on 11-05 after R1 fired: R1 stays fired._                                                                                                                                                             |
| R7.6  | A rule that became due while the check was not running fires on the first check after; once the deadline has passed, R1 no longer fires (Q2).                                                                                                                                                                                                                                                                                                           | _The server is down from Wednesday 11-04 15:00 to Sunday 11-08 11:00. The first check fires R2 for #42, not R1._                                                                                                                                                                                                                                                                                               |
| R7.7  | The check uses the current settings (Q3): turning a rule on fires it for every open request it is already due for; changing a threshold moves the rules that have not fired yet; a rule that is off never fires.                                                                                                                                                                                                                                        | _Huda turns R2 on Monday 11-09 while #42 is a day late: R2 fires within a minute. On Tuesday 11-03 Huda changes R0 from 2 to 5 days: #43's R0 moves to Monday 11-09 at 09:00._                                                                                                                                                                                                                                 |
| R7.8  | Recipients are resolved when the rule fires, from each configured target with the request's requester and handler as context (Phase 5 resolver). A target that resolves to nobody climbs to the next level, as a stage's escalate fallback does. The people found are deduplicated and only active members are notified. If nobody is found for any target, the holders of `escalation.manage` are told that the rule fired with nobody to notify (Q4). | _R2 on #42: the Handler is Faisal; the Handler's unit managers are Contracts' managers, only Faisal, excluded as the anchor, so the target climbs to Legal Affairs' managers, Huda and Ahmed; the Handler's department managers are Huda and Ahmed. Notified: Faisal, Huda, Ahmed, once each. Ahmed is deactivated on Tuesday: #43's R0 climbs from Legal Intake to Legal Affairs' managers and reaches Huda._ |
| R7.9  | The SLA clock and the escalation check continue unchanged in Grace and Read-only (Q5).                                                                                                                                                                                                                                                                                                                                                                  | _Al-Noor is Read-only from 2027-01-15 with #42 still open: R2 fires when due, and its notifications reach Faisal, Huda, and Ahmed, who can read them but cannot act on #42._                                                                                                                                                                                                                                   |
| R7.10 | Every firing is audited as `request.escalated` by the system, with the rule, the moment it was due, and the people notified.                                                                                                                                                                                                                                                                                                                            | _The audit shows `request.escalated`, actor `system`, `{rule: "r2", dueAt, recipients: [Faisal, Huda, Ahmed]}`._                                                                                                                                                                                                                                                                                               |
| R7.11 | A notification belongs to one user, is unread until that user marks it read, and is written in the same transaction as the event it reports. Nobody is notified of their own action, and inactive members are never notified.                                                                                                                                                                                                                           | _Faisal completes Drafting and the next stage resolves to him again: he gets no notification. Huda's accept rolls back on an error: Khalid gets no "accepted" notification._                                                                                                                                                                                                                                   |
| R7.12 | The lifecycle events of section 4.3 ("Lifecycle notifications") notify the people listed there (Q7).                                                                                                                                                                                                                                                                                                                                                    | _Huda accepts #42: Khalid gets "accepted", Faisal gets "you are the handler", and Majed gets "waiting on you" for Business approval._                                                                                                                                                                                                                                                                          |
| R7.13 | The holders of `subscription.view` are notified when the subscription ends in 14 days, when Grace starts, and when Read-only starts; each once per subscription end date, and only the current one when several have passed at once (Q8).                                                                                                                                                                                                               | _Al-Noor's subscription ends 2026-12-31 with 14 grace days: Sara and Majed are notified on 12-17, on 2027-01-01, and on 2027-01-15. On 12-20 the operator extends it to 2027-12-31: the next "ends in 14 days" comes on 2027-12-17._                                                                                                                                                                           |
| R7.14 | The holders of `subscription.view` are notified when an upload takes storage usage to 90% of the limit or more; not again until usage has been seen below 80% (Q8, Q10).                                                                                                                                                                                                                                                                                | _Al-Noor has 20 GB; Khalid's upload takes usage from 17.9 GB to 18.1 GB: Sara and Majed are notified. Later uploads at 18.5 GB notify nobody. After cleanup Nora uploads at 15 GB, which re-arms the warning._                                                                                                                                                                                                 |
| R7.15 | A user lists their notifications (newest first, optionally unread only), reads the unread count, marks one read, and marks all read up to the newest one they have seen. These work in every subscription state, including Read-only. Nobody sees another user's notifications.                                                                                                                                                                         | _Faisal's badge shows 3; he opens the list and marks all read up to the newest; an R2 that arrived a second later stays unread. Huda asks for Faisal's notification by ID: 404._                                                                                                                                                                                                                               |
| R7.16 | Read notifications are deleted 90 days after they were read; unread ones are kept.                                                                                                                                                                                                                                                                                                                                                                      | _Khalid read "accepted" on 2026-11-01; it is deleted on or after 2027-01-30._                                                                                                                                                                                                                                                                                                                                  |
| R7.17 | Housekeeping runs on the same scheduler: the file sweep every 15 minutes (unchanged), and once a day the expired refresh tokens, the expired password tokens, and the old read notifications are deleted (Q9).                                                                                                                                                                                                                                          | _A refresh token that expired yesterday is gone after the next daily run; an unexpired revoked one stays until it expires._                                                                                                                                                                                                                                                                                    |
| R7.18 | Each process runs the jobs its configuration names (`JOBS`), all of them by default; every job is safe when several processes run it at once (Q1, Q9).                                                                                                                                                                                                                                                                                                  | _Two API instances run all jobs: no firing or notification is duplicated, and no file is swept twice. A future worker runs `JOBS=all` while the API runs `JOBS=none`._                                                                                                                                                                                                                                         |
| R7.19 | Everything reads and writes only the right tenant's data: the check resolves recipients inside the request's tenant, and notification endpoints only reach the caller's own rows in the caller's tenant.                                                                                                                                                                                                                                                | _An Al-Rashid notification ID sent by Faisal: 404._                                                                                                                                                                                                                                                                                                                                                            |

## 4. Design

### 4.1 Data model

#### Notifications

**`notification_kinds`** enum: the kinds of 4.3 (escalation, lifecycle, subscription and storage).

**`notifications`** (new, tenant data):

| Column       | Type                 | Notes                                                                                                                                                       |
| ------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `uuid` PK            |                                                                                                                                                             |
| `tenant_id`  | `uuid`               | FK to `tenants`.                                                                                                                                            |
| `user_id`    | `uuid`               | The recipient; composite FK `(tenant_id, user_id)` → `tenant_members`.                                                                                      |
| `kind`       | `notification_kinds` |                                                                                                                                                             |
| `request_id` | `uuid`               | Null for subscription and storage kinds; composite FK `(tenant_id, request_id)` → `requests`.                                                               |
| `data`       | `jsonb`              | The values the client needs to word the notification (T11): always `{number, title}` for request kinds, plus the kind's own values (4.3). Check: an object. |
| `created_at` | `timestamptz`        | The event's transaction time.                                                                                                                               |
| `read_at`    | `timestamptz`        | Null while unread.                                                                                                                                          |

Indexes: `(tenant_id, user_id, created_at desc, id desc)` for the list, `(tenant_id, user_id) where read_at is null` for the unread count, and `(read_at) where read_at is not null` for the cleanup.

Why one row per recipient instead of one event with a recipients table: read state belongs to each recipient, the list and the count are single-table queries, and the largest fan-out (R2) is a handful of rows.
Why `data` keeps the number and title instead of joining the request: a notification stays readable even when its recipient can no longer see the request (they were told when they could), and every kind is rendered from the same shape.

#### Escalation firings

**`request_escalations`** (new, tenant data): `tenant_id`, `request_id` (composite FK `(tenant_id, request_id)` → `requests`), `rule` (`escalation_rules`, from Phase 5), `due_at` (the moment the threshold passed), `fired_at`; primary key `(request_id, rule)`.

The primary key is what makes "at most once" (D9) a database fact: a second instance's insert does nothing (4.3).
`due_at` and `fired_at` differ when the check was not running (R7.6), so the record shows both when the threshold passed and when people were told.

#### Tenant notices

**`tenant_notice_kinds`** enum: `subscription_ending_soon`, `subscription_grace_started`, `subscription_read_only_started`, `storage_nearly_full`.

**`tenant_notices`** (new, tenant data): `tenant_id` (FK), `kind`, `key` (`text`), `sent_at`; primary key `(tenant_id, kind, key)`.
The key is the subscription's end date (`2026-12-31`) for the three subscription kinds, so an extension re-arms them, and the empty string for storage, whose row is deleted to re-arm it (4.3).

Why a table when subscription state is derived and never stored (T15): the state is still derived; this table only remembers which warnings were sent, which is the "fire once" fact D9 needs for escalations, applied to warnings.

#### Migrations

Generated `0020_notifications`, `0021_request_escalations`, `0022_tenant_notices`; numbers are fixed when the branches are merged.

#### Audit actions

| Action              | Resource | Actor    | `details`                                                                                |
| ------------------- | -------- | -------- | ---------------------------------------------------------------------------------------- |
| `request.escalated` | request  | `system` | `{rule, dueAt, recipients: [userId], targets: [{target, level, userIds}], noRecipients}` |

The audit entry's `requestId` is the job run's ID (`job:<name>:<uuid>`), which the run's log lines also carry.
When nobody was found, `recipients` lists the holders of `escalation.manage` who were told instead, and `noRecipients` is true; `targets` shows the level each target ended at.
Notifications themselves are not audited: the action they report is, in the same transaction (T8), and marking read is personal state.

### 4.2 API

See [phase-7-escalation-notifications.API.md](phase-7-escalation-notifications.API.md).

### 4.3 Key flows

#### The scheduler

`src/scheduler/` is infrastructure, like `db` and `http`:

```ts
interface JobType {
  name: string;                 // "requests.escalations"
  intervalMs: number;           // the pause after one run ends and before the next starts
  run(context: JobContextType): Promise<Record<string, number>>; // counts for the log line
}
interface JobContextType { db: Db; logger: Logger; signal: AbortSignal; runId: string }

startScheduler({ jobs, db, logger }): { stop(): Promise<void> }
```

- Each job runs once at start, then again `intervalMs` after each run ends: a `setTimeout` chain per job, as the file sweep does today (T42), so one process never overlaps a job with itself, and a slow sweep never delays the escalation check.
- A failed run is logged with the job name and run ID and never crashes the process or stops the chain.
- A run logs `job finished` with its counts, at `info` when any count is not zero and at `debug` otherwise, so a check every minute does not flood the logs; a failed run logs `job failed`.
- At start the process logs `scheduler started` with the names of the jobs it runs.
- `stop()` aborts the signal, clears the timers, and waits for running jobs; `main.ts` awaits it before closing the pool, as it does for the sweep today.

**The contract every job meets**, which is what makes the later split a configuration change (Q1, Q9):

- It depends only on `JobContextType` and what its factory was given (the file store), never on Express or a request.
- It is safe when several processes run it at the same time: its work is claimed with `FOR UPDATE SKIP LOCKED` or made idempotent by a unique key.
- It works in short transactions and stops between them when the signal is aborted.

`src/jobs.ts` is the composition root of jobs, as `app.ts` is of routes: it builds the list from each module's job factory.
`main.ts` starts the scheduler with the jobs the `JOBS` setting selects: `all` (default), `none`, or a comma-separated list of names.
Configuration parses the setting (an empty value or an empty name is a configuration error); `main.ts` checks the names against the job list before it opens the pool or listens, and an unknown name stops the process with a fatal log that names it and lists the known jobs.
Splitting later: a `worker.ts` entrypoint starts the scheduler without the HTTP server, and the API is deployed with `JOBS=none`; one job can get a worker of its own the same way (`JOBS=requests.escalations`).

| Job                     | Module        | Interval   | Does                                                                                                    |
| ----------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `requests.escalations`  | requests      | 1 minute   | R0-R2 (below)                                                                                           |
| `subscriptions.notices` | subscriptions | 1 hour     | The three subscription warnings (below)                                                                 |
| `files.sweep`           | files         | 15 minutes | Unchanged from Phase 5.5 (T42), including its overdue warning; `startFileSweeps` is replaced by the job |
| `auth.token_cleanup`    | auth          | 24 hours   | Deletes refresh tokens and password tokens whose `expires_at` has passed, in batches of 1,000           |
| `notifications.cleanup` | notifications | 24 hours   | Deletes notifications read more than 90 days ago, in batches of 1,000                                   |

A daily job runs at each process start and every 24 hours after; nothing depends on the time of day it runs.
Why an expired token can be deleted, revoked or not: an expired refresh token or link is refused whether or not its row exists, and the audit keeps who signed in and who used a link.

#### The escalation check

Why it checks every minute instead of scheduling each alert: the deadline of an open request is computed from the current calendar (D39).
If acceptance scheduled "R1 at Wednesday 16:00" and Sara then declared Wednesday a holiday, the scheduled job would fire at the old moment; a check that recomputes each time always uses the calendar as it is.
Deadlines are rounded down to the minute (T33), so a one-minute interval loses nothing.

Each run:

1. Read the database time once (`now`), as the request timestamps use the database clock.
2. Find the **candidates**: open requests of tenants with escalation settings where a rule that is on has not fired:
   - `in_review`, R0 on, no R0 firing;
   - `in_progress`, R1 on, no R1 and no R2 firing;
   - `in_progress`, R2 on, no R2 firing.
3. For each tenant with candidates, load its calendar once (`loadCalendar`) and compute each candidate's due moments in memory:
   - R0: `addWorkingDays(calendar, submitted_at, r0Days)`; due when `now >= ` it.
   - R2: the deadline `addWorkingDays(calendar, accepted_at, priority_days)`; due when `now > ` it (`met` means "not past the deadline yet", Phase 6).
   - R1: `addWorkingDays(calendar, accepted_at, priority_days × r1Percent / 100)` (fractional days, Phase 4 R4.10); due when `now >= ` it **and** R2 is not due (Q2).
4. Fire each due rule in its own transaction (below), and stop starting new ones when the signal is aborted or 50 seconds have passed; the rest waits for the next run.
5. A tenant whose calendar cannot be loaded, or a request whose firing fails, is logged with its tenant (and request) ID and counted as `failed`; the run goes on with the others, and the failed firing, rolled back whole, is tried again on the next run.
   Example: at 10:01 #42's R2 and #50's R1 are due and #42's transaction fails; #50's R1 still fires, and the run logs `{r1: 1, failed: 1}`.

**Firing** one rule on one request, in one transaction:

1. Lock the request `FOR UPDATE SKIP LOCKED`; if someone is acting on it now, skip it until the next run (T46).
2. Re-check under the lock: the request is still in the rule's state (`in_review` for R0, `in_progress` for R1 and R2), and the rule is still on in the settings read now.
3. `insert into request_escalations ... on conflict do nothing returning`; no row returned means another process fired it: stop.
4. Resolve the recipients: for each target of the rule, `resolveAssignees(tx, tenantId, target, {requesterId, handlerId}, {excludeParties: false})`; if nobody, `nextLevel` from that level; union and deduplicate the people found.
5. Nobody at all: the recipients are the active holders of `escalation.manage`, and the kind is `escalation.no_recipients`.
6. `notify` the recipients; audit `request.escalated`.

The race the lock and the re-check prevent: the check reads #42 as open at 10:00:30, Faisal's completion commits at 10:00:31, and without them the check would insert R2 and tell Huda and Ahmed that a completed request is late.
With them, the firing waits for or skips Faisal's lock and then sees `completed`.
The race the primary key prevents: two instances both find #42 due at 10:01; both try the insert, one gets the row, the other stops at step 3, so nobody is told twice.

`due_at` is the computed threshold and `fired_at` the firing transaction's database time, so in production `fired_at` is never before `due_at`; tests that pass a fixed `now` can see it earlier, since `fired_at` stays the real clock.

What the check does not do: it never changes the request, its stages, or its SLA; escalation is notification only (MVP 3.7).

#### Notifying

`notify(tx, {tenantId, recipients, actorId?, kind, requestId?, data})` in `modules/notifications/shared/notify.ts` accepts only a transaction, as `writeAuditEntry` does (T8):

1. Remove the actor and duplicates.
2. Keep only active members of the tenant (one query).
3. Insert one row per remaining recipient.

The caller decides who the recipients are; `notify` never reads requests, so the notifications module depends on nothing above it.
`holdersOf(executor, tenantId, permission)` in `tenant-access` returns the active members whose role grants the permission at any scope or is the Tenant Admin role (T26); it serves `subscription.view` and `escalation.manage`.

#### Lifecycle notifications

Written by the requests module in the action's transaction (Q7):

| Event (Phase 6 action)                                     | Kind                                                            | Notified                       | `data` beyond `{number, title}`        |
| ---------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------ | -------------------------------------- |
| R0 / R1 / R2 fired                                         | `request.review_overdue`, `request.at_risk`, `request.breached` | the resolved recipients        | `{dueAt}`; R1 and R2 also `{deadline}` |
| A rule fired with nobody to notify                         | `escalation.no_recipients`                                      | holders of `escalation.manage` | `{rule}`                               |
| A run becomes active with people not assigned to it before | `request.stage_assigned`                                        | each newly assigned person     | `{stage}`                              |
| A run becomes held                                         | `request.stage_held`                                            | the handler                    | `{stage}`                              |
| Information requested                                      | `request.information_requested`                                 | the requester                  |                                        |
| Information cancelled                                      | `request.information_cancelled`                                 | the requester                  |                                        |
| Information answered                                       | `request.information_answered`                                  | whoever asked                  |                                        |
| Accepted                                                   | `request.accepted`                                              | the requester                  |                                        |
| Accepted, handler reassigned                               | `request.handler_assigned`                                      | the new handler                |                                        |
| Handler reassigned                                         | `request.handler_removed`                                       | the previous handler           |                                        |
| Rejected                                                   | `request.rejected`                                              | the requester                  |                                        |
| Completed                                                  | `request.completed`                                             | the requester                  |                                        |
| Closed as no response                                      | `request.closed_no_response`                                    | the requester                  |                                        |
| Priority changed in review                                 | `request.priority_changed`                                      | the requester                  | `{before, after}` (names)              |

The actor is never notified (R7.11), so the table lists who is told when someone else acts.
Not notified: submission, stage completion (the next assignees are told), withdrawal, attachments, narrowing (it only removes people), role changes.

**Stage notifications** come from the stage transitions Phase 6 already lists for the audit (`TransitionType`): one helper turns an action's transitions into `stage_assigned` for people new to an active run and `stage_held` for a held run.
"New to the run" makes refresh, handler escalation, and reassignment tell only the people the change added: Faisal refreshes Business approval after Sara makes Majed Finance's manager, and only Majed is told.
`stage_held` goes to the handler every time an action leaves a run held, the actor excluded: Faisal's own refresh of a stage that stays held tells nobody, while Ahmed's reassignment of Lina's request to Nora tells Nora that Business approval is held, since she is new to the request.
Handler escalation has no transition list of its own, so it passes the run's new assignees as one active transition, with the earlier assignees as `before`.
A request whose stages all skip at acceptance completes at once; Khalid gets both "accepted" and "completed", which are both true.

#### Subscription warnings

The `subscriptions.notices` job, every hour, in one transaction per tenant:

1. Read the subscription and the Riyadh date (T15) and derive the state.
2. Pick the one current notice: Read-only gives `subscription_read_only_started`; Grace gives `subscription_grace_started`; Active within 14 days of the end date gives `subscription_ending_soon`; otherwise none.
3. `insert into tenant_notices (tenant_id, kind, key = end_date) on conflict do nothing returning`; a new row notifies the holders of `subscription.view`, with `{endDate}` (and `{readOnlyFrom}` for Grace).

Only the current notice is sent, so a tenant first seen already in Read-only gets "Read-only", not three warnings at once (as Q2 does for R1).
A subscription with 0 grace days goes from "ends soon" to "Read-only".
An extension changes the end date and with it the key, so the warnings come again before the new end.

#### Storage warning

In the upload's reservation transaction, which already holds the tenant's upload lock and sums the stored bytes (T41):

- If usage after the reservation is 90% of the limit or more: insert `storage_nearly_full` (key `''`) on conflict do nothing; a new row notifies the holders of `subscription.view` with `{usedBytes, limitBytes}`.
- If usage before the reservation is below 80%: delete that row, so the next crossing warns again (Q10).

The re-arm runs before the insert, so one upload that jumps from below 80% to 90% or more warns afresh.
The uploader is not excluded: the warning reports the tenant's usage, not the uploader's action, so a Tenant Admin whose own upload crosses the line is told too.
Usage only rises through uploads, so the upload is the only place that can see it cross 90%.
A downgrade that puts usage above 90% warns at the next upload.

### 4.4 Module structure

```
src/
  scheduler/                          new: JobType, JobContextType, startScheduler, selectJobs
  jobs.ts                             new: the jobs' composition root (each module's job factory)
  main.ts                             (changed) starts the scheduler with the jobs JOBS selects; awaits stop() on shutdown
  config/config.ts                    (changed) JOBS
  db/schema/notifications.ts          new: notifications, notification_kinds
  db/schema/escalation.ts             (changed) request_escalations
  db/schema/tenant-notices.ts         new: tenant_notices, tenant_notice_kinds
  modules/
    notifications/                    new: routes, controller, service, repository, config, schemas, types
      shared/notify.ts                notify
      shared/cleanup.ts               the notifications.cleanup job
    requests/                         (changed)
      shared/escalations.ts           the requests.escalations job: candidates, due moments, firing
      shared/notices.ts               lifecycle notifications, including the stage-transition helper
                                      the read gains escalations; each action calls notify
    subscriptions/                    (changed) shared/notices.ts: the subscriptions.notices job, recordNotice, clearNotice
    files/                            (changed) the sweep as a job (sweep-schedule.ts removed); the storage warning in reserve
    auth/                             (changed) shared/token-cleanup.ts: the auth.token_cleanup job
    tenant-access/                    (changed) holdersOf
db/migrations/0020_notifications.sql ... 0022_tenant_notices.sql
```

`app.ts` gains `/notifications`.
`subscriptions/shared/notices.ts` imports `notify` from `notifications/shared/notify.ts`, not the module's index, because the index mounts routes through `auth`, which imports `subscriptions`.
The escalation check lives in the requests module because it reads requests and the live deadline (`slaOf`, Phase 6), and requests already imports the escalation settings; putting it in `escalation` would make the two modules import each other.

## 5. Edge Cases and Failure Behavior

| Scenario                                                                                       | Expected behavior                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two API instances check #42 in the same minute.                                                | Both try to insert R2; the primary key lets one through; one set of notifications.                                                                              |
| Faisal completes #42 at 10:00:31 while the check, which read it as open at 10:00:30, fires R2. | The firing locks the row (or skips it while Faisal holds it) and re-checks the state: `completed`, nothing fires.                                               |
| Huda accepts #43 at Wednesday 09:00:20, while the check is firing R0.                          | The same lock decides: R0 either fired before the acceptance (the record shows it, correctly: it was due at 09:00) or sees `in_progress` and does nothing.      |
| The server is down over the weekend.                                                           | The first run fires every rule that became due, with `due_at` showing when; R1 only where the deadline has not passed.                                          |
| Huda turns R1 on while 30 open requests are between 75% and their deadline.                    | All 30 fire on the next run (Q3).                                                                                                                               |
| Huda turns R0 off after it fired on #43.                                                       | The firing stays; nothing else changes.                                                                                                                         |
| Sara declares a holiday that moves #42's deadline after R1 fired.                              | R1 stays fired; R2 waits for the new deadline (D9, D26).                                                                                                        |
| A firing finds the request locked by an action.                                                | Skipped this run; the next run tries again.                                                                                                                     |
| Legal Intake's only holder is deactivated and Legal Affairs has no active manager either.      | Nobody is found; the holders of `escalation.manage` (Sara, Majed) get `escalation.no_recipients`; the firing is recorded and audited with `noRecipients: true`. |
| A recipient cannot see the request (their `request.view` does not cover it).                   | They are notified with the number, title, and deadline; opening the request is 404 (Q11).                                                                       |
| A notification's recipient is later moved out of scope of its request.                         | The notification keeps its number and title; opening the request is 404.                                                                                        |
| The check throws for one tenant (a calendar beyond the ICU range, T31).                        | Logged with the tenant and run ID; other tenants are checked; the next run tries again.                                                                         |
| A run is still working after 50 seconds.                                                       | It stops starting firings; the rest go in the next run.                                                                                                         |
| A run takes longer than its interval.                                                          | The next run starts that interval after this one ends; runs of one job never overlap in a process.                                                              |
| Al-Noor enters Read-only with #42 open.                                                        | The check fires as usual (Q5); Faisal can list and mark read his notifications; acting on #42 is 403 `SUBSCRIPTION_READ_ONLY`.                                  |
| The operator ends a subscription early to a past date.                                         | The next hourly run sends the current notice only (Grace or Read-only).                                                                                         |
| Faisal marks all read while an R2 arrives.                                                     | `upTo` covers only what he had seen; the R2 stays unread.                                                                                                       |
| Faisal is deactivated with unread notifications.                                               | They stay; he gets no new ones; a reactivated Faisal sees the old ones and nothing from the time in between.                                                    |
| Faisal is deactivated while his access token is still valid. | He can still read and mark his own inbox until the token expires (at most 30 minutes, T7); it holds no request data beyond the number and title. |
| One request's firing fails while others are due in the same tenant. | It is logged and counted as `failed` and retried on the next run; the others fire. |
| `notify` with the actor as the only recipient.                                                 | No rows.                                                                                                                                                        |
| An unknown name in `JOBS`, or an empty `JOBS=`. | The process refuses to start: an unknown name is named with the list of known jobs; an empty value is a configuration error. |
| Shutdown during a run.                                                                         | The signal stops the job between transactions; the open transaction commits or rolls back before the pool closes.                                               |

## 6. Security and Authorization

- **Trust boundaries:** `read-all`'s body is a zod strict object (T25); IDs pass through `idSchema` (T37); query parameters stay lenient (T25).
- **Tenant isolation:** every notification query filters by the token's tenant and user (T2); every new link is a composite foreign key with `tenant_id` (T21); the check resolves recipients with the request's tenant, so nobody outside it can be notified.
- **Authorization:** the inbox is the caller's own; another user's notification is 404 (never 403, so IDs reveal nothing). No permission is added. Firings run as the system; escalation remains notification only, so the job never acts on a request.
- **Read-only:** the notification routes skip the subscription guard, and write only `read_at` on the caller's rows (P7.7).
- **No information leak:** a notification carries only the request's number, title, and kind-specific values (stage name, priority names, dates); reasons and answers stay in the request, behind its visibility.
- **Audit:** each firing as `request.escalated` by the system, in its transaction (T8); lifecycle notifications ride on the action's existing audit entry.

## 7. Implementation Steps

| Step                           | Objective                                                                     | Delivers                                                                                                                            | Acceptance criteria  | Verification                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 Scheduler and housekeeping | Jobs run behind one interface, chosen per process.                            | `src/scheduler/`, `src/jobs.ts`, `JOBS`, the file sweep as a job (behavior unchanged), `auth.token_cleanup`, `main.ts` shutdown.    | R7.17, R7.18.        | Unit tests of the scheduler (no overlap, a failure keeps the chain, `stop` waits, `JOBS` selection and refusal); integration tests of token cleanup; the Phase 5.5 sweep tests still pass. Mutation check: removing the chain's "after the run ends" (firing on a fixed interval) fails an overlap test.                                                                      |
| 7.2 Notifications core         | Users have an inbox.                                                          | Migration `0020`, `notify`, `holdersOf`, the four routes, mounted without the subscription guard.                                   | R7.11, R7.15, R7.19. | Integration tests: ordering and `before`, unread count, read and read-all with `upTo`, another user's and another tenant's IDs, Read-only. Mutation check: mounting the guard makes the Read-only test fail.                                                                                                                                                                  |
| 7.3 Escalation check           | R0-R2 fire.                                                                   | Migration `0021`, the `requests.escalations` job, recipient climbing and the last resort, audit, `escalations` on the request read. | R7.1-R7.10.          | Integration tests with a controlled `now` for every example in section 3 and every escalation row of section 5. Mutation checks: removing `on conflict do nothing` (or the key) duplicates notifications in a two-runner test; removing the lock or the state re-check notifies a request closed between scan and firing; removing the R1 window fires R1 after the deadline. |
| 7.4 Lifecycle notifications    | People are told what needs them.                                              | The calls to `notify` in every Phase 6 action of 4.3, the stage-transition helper.                                                  | R7.12.               | Integration tests: each table row, the actor exclusion, refresh telling only new people, a rolled-back action leaving no notification.                                                                                                                                                                                                                                        |
| 7.5 Warnings and retention     | Tenant Admins hear about the subscription and storage; the inbox stays small. | Migration `0022`, the `subscriptions.notices` job, the storage warning in `reserve`, the `notifications.cleanup` job.               | R7.13, R7.14, R7.16. | Integration tests: each state and transition, extension re-arming, the 90/80 re-arm, retention boundary. End-to-end check of the whole phase against a running server: #42 and #43 from section 3 through R0, R1, R2, the inbox, and Read-only.                                                                                                                               |

Order: agent A builds 7.2, then 7.4 after it is merged.
Agent B builds 7.1 in parallel with 7.2, then 7.3 and 7.5 once both are merged.
Migration numbers are fixed when the branches are merged.

## 8. Test Plan

Integration tests against real PostgreSQL and the S3-compatible server, with Al-Noor's configuration from section 3 and Al-Rashid for isolation.
Jobs are tested by calling their `run` with a fixed database time where the check needs one (the check reads `now` once per run, so a test passes it in), never by waiting for timers.

| Requirement  | Test                                                                                                                                                 | Step     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R7.1-R7.4    | Due moments for R0, R1, R2 on #42 and #43, one minute before and at the moment.                                                                      | 7.3      |
| R7.5, R7.6   | Two runners at once; repeated runs; catch-up after a gap; R1 skipped past the deadline; firing kept after a calendar change.                         | 7.3      |
| R7.7         | Turning rules on and off; changing N and X.                                                                                                          | 7.3      |
| R7.8         | Each built-in and position target; climbing; anchor exclusion; deactivated holders; the `escalation.manage` last resort.                             | 7.3      |
| R7.9         | Grace and Read-only tenants are checked.                                                                                                             | 7.3      |
| R7.10        | The audit entry and its run ID.                                                                                                                      | 7.3      |
| R7.11, R7.12 | Each lifecycle row; the actor and inactive members excluded; rollback.                                                                               | 7.2, 7.4 |
| R7.13, R7.14 | Each subscription state and the extension; the storage crossing and re-arm; concurrent uploads crossing together give one warning (the upload lock). | 7.5      |
| R7.15, R7.16 | The four routes; Read-only; retention.                                                                                                               | 7.2, 7.5 |
| R7.17, R7.18 | Scheduler behavior; token cleanup; `JOBS`.                                                                                                           | 7.1      |
| R7.19        | Al-Rashid IDs on every route; recipients never outside the tenant.                                                                                   | all      |

## 9. Open Questions

Q1-Q9 are the pre-spec discussion; Q10 and Q11 were raised by the draft. All are resolved.

| #   | Question                                                                                                                                                                                                   | Options                                                                                                                                                                                                                                                                                                                                             | Resolution                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | How do the background checks run (the deferred "Background job runner" decision)?                                                                                                                          | (a) An in-process periodic check every minute, like the file sweep, safe with several instances. (b) `pg-boss`, a job queue stored in PostgreSQL. (c) A separate worker process now.                                                                                                                                                                | **Resolved 2026-10-26: (a), behind an interface so the check can later move to a worker of its own** (P7.1, P7.2).                                                                                                         |
| Q2  | When R1 and R2 are both due at once (after downtime, or R1 turned on late), which fire?                                                                                                                    | (a) Only R2: R1 fires only between X% and the deadline. (b) Both.                                                                                                                                                                                                                                                                                   | **Resolved 2026-10-26: (a)**, R1 fires only before the deadline (P7.4).                                                                                                                                                    |
| Q3  | Do settings changes apply to open requests?                                                                                                                                                                | (a) The check always uses the current settings, and catch-up firings are allowed. (b) Only requests that pass a threshold after the change.                                                                                                                                                                                                         | **Resolved 2026-10-26: (a)**, current settings, with catch-up (P7.5).                                                                                                                                                      |
| Q4  | What if a recipient target resolves to nobody?                                                                                                                                                             | (a) Climb as a stage's escalate fallback does; if the top is reached with nobody, tell the holders of `escalation.manage`. (b) Skip the empty target silently.                                                                                                                                                                                      | **Resolved 2026-10-26: (a)**, climb, and the holders of `escalation.manage` as the last resort (P7.6).                                                                                                                     |
| Q5  | In Read-only, do SLA clocks and escalations of open requests continue, stop, or get marked? (MVP open question 6)                                                                                          | (a) Both continue; marking notifications read stays possible. (b) Stop firing and catch up after renewal. (c) Mark requests as affected by the subscription state.                                                                                                                                                                                  | **Resolved 2026-10-26: (a)**, the clock and the check continue, and the inbox works in Read-only (P7.7).                                                                                                                   |
| Q6  | How are notifications stored and delivered?                                                                                                                                                                | One row per recipient written in the event's transaction, codes and values instead of text, four routes, polling, read ones deleted after 90 days; or an event table with recipients; or push.                                                                                                                                                      | **Resolved 2026-10-26: the recommendation**: one row per recipient in the event's transaction, `data` with codes and values, list, unread count, read, read-all, polling, read notifications deleted after 90 days (P7.8). |
| Q7  | Which events notify whom? (MVP open question 8)                                                                                                                                                            | The recommended list, or adding submission (to reviewers) and stage completion (to the handler).                                                                                                                                                                                                                                                    | **Resolved 2026-10-26: the recommendation**: the list of 4.3; not submission, stage completion, withdrawal, attachments, or role changes (P7.9).                                                                           |
| Q8  | Which subscription and storage warnings, and to whom?                                                                                                                                                      | Ends in 14 days, Grace, Read-only, each once per end date; storage at 90% checked at upload; all to holders of `subscription.view`.                                                                                                                                                                                                                 | **Resolved 2026-10-26: the recommendation**, as written (P7.10).                                                                                                                                                           |
| Q9  | Do the housekeeping jobs join the runner?                                                                                                                                                                  | (a) One shared scheduler for the file sweep, token cleanup, and notification retention. (b) Leave them out.                                                                                                                                                                                                                                         | **Resolved 2026-10-26: (a), each job behind the same interface so any one of them can later move to a worker of its own** (P7.1, P7.11).                                                                                   |
| Q10 | When does the storage warning repeat? Al-Noor crosses 90%, deletes files down to 85%, and uploads past 90% again; then later cleans up to 50% and, months later, reaches 90% again.                        | (a) Once until usage is seen below 80% at an upload, then again on the next crossing: no repeats while hovering near 90%, a new warning after a real cleanup. (b) Every crossing of 90%: a tenant hovering at the line gets a warning with nearly every upload. (c) Once per storage limit: no warning after a real cleanup until the plan changes. | **Resolved 2026-10-26: (a)**, the warning is sent once at 90% and re-armed only when an upload sees usage below 80% (P7.10).                                                                                               |
| Q11 | Should escalation recipients see the request they are told about? R2 names a position "Contracts Auditor" whose holder has `request.view` only at own scope; he is told #42 is late but opening it is 404. | (a) No change; visibility stays with parties and permissions (T45); the notification carries the number, title, and deadline; whoever configures recipients picks people who can see the requests. (b) Anyone a request was escalated to sees it from then on: changes `visibleRequests` and keeps a recipients table for it.                       | **Resolved 2026-10-26: (a)**, visibility is unchanged; recipients who cannot see the request still get the number, title, and deadline, and choosing recipients who can see it is the configurer's responsibility (P7.12). |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #     | Decision                                                                                                                                                                                                                             | Rationale                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P7.1  | Background work is a list of `JobType` jobs run by one in-process scheduler, a `setTimeout` chain per job; `JOBS` selects which jobs a process runs; every job is safe in several processes at once and depends only on its context. | Owner decisions (Q1, Q9): no new dependency or deployable now, and moving any job to a worker later is an entrypoint and a setting, not a rewrite. Resolves the deferred "Background job runner" decision. |
| P7.2  | The escalation check recomputes due moments every minute from the current calendar and settings; no due time is stored.                                                                                                              | The deadline of an open request follows calendar changes (D39), so a stored or scheduled moment would go stale; deadlines are whole minutes (T33).                                                         |
| P7.3  | A firing is a `request_escalations` row with primary key `(request_id, rule)`, inserted in a transaction that locks the request `FOR UPDATE SKIP LOCKED` and re-checks its state and the rule.                                       | "At most once" (D9) is a database fact across instances; a request closed a second earlier is never reported late (T46).                                                                                   |
| P7.4  | R1 fires only between X% and the deadline.                                                                                                                                                                                           | Owner decision (Q2): no "at risk" and "breached" at the same moment.                                                                                                                                       |
| P7.5  | The check uses the current escalation settings, and a rule that is turned on catches up.                                                                                                                                             | Owner decision (Q3): those requests really are at the threshold; no record of when each rule was turned on.                                                                                                |
| P7.6  | An escalation target that resolves to nobody climbs as a stage's escalate fallback does; nobody at all goes to the holders of `escalation.manage`.                                                                                   | Owner decision (Q4): keeps D33's promise that no request goes unmonitored, and tells the people who can fix the configuration.                                                                             |
| P7.7  | In Read-only, the SLA clock and the escalation check continue; the notification routes are exempt from the subscription guard.                                                                                                       | Owner decision (Q5), resolving MVP open question 6: the record stays truthful, a renewal causes no burst, and people can read and clear their inbox. Exception to T16.                                     |
| P7.8  | One notification row per recipient, written in the event's transaction, holding a kind and values for the client to word; delivered by polling; read ones deleted after 90 days.                                                     | Owner decision (Q6): read state per person, no lost or orphan notifications (as T8), localization in the client (T11), no push infrastructure in the MVP (D10).                                            |
| P7.9  | The notification events and recipients of 4.3; the actor is never notified.                                                                                                                                                          | Owner decision (Q7), resolving MVP open question 8.                                                                                                                                                        |
| P7.10 | Subscription warnings (ends in 14 days, Grace, Read-only) once per end date, and the storage warning at 90%, re-armed below 80%, to holders of `subscription.view`, remembered in `tenant_notices`.                                  | Owner decisions (Q8, Q10); warnings stay permission-based (D1, D20); the state itself stays derived (T15); no repeats while usage hovers near the line, a new warning after a real cleanup.                |
| P7.11 | The file sweep, the token cleanup, and the notification retention run on the shared scheduler.                                                                                                                                       | Owner decision (Q9); closes the cleanup Phase 0 left for this phase.                                                                                                                                       |
| P7.12 | Escalation recipients gain no visibility of the request; visibility stays with parties and permissions.                                                                                                                              | Owner decision (Q11): one definition of who sees a request (T45); escalation is notification only (MVP 3.7).                                                                                               |

Promoted on 2026-10-26: P7.4, P7.5, P7.6, P7.7, P7.9, and P7.12 to `MVP_SCOPE.md` as D41-D46 (with 3.7, 3.8, and Known Limitations updated and open questions 6 and 8 resolved); P7.1, P7.2, P7.3, P7.8, and P7.10 to `TECHNICAL_DECISIONS.md` as T47-T51, resolving the deferred "Background job runner" and adding four deferred hardening items. Decisions not promoted are detail that stays authoritative here.

The plan, as drafted: P7.4-P7.7 and P7.9 to `MVP_SCOPE.md` (resolving open questions 6 and 8, updating 3.7 and 3.8, and adding "time in Read-only counts against the SLA" and "alerts can arrive up to a minute late, or later after downtime" to Known Limitations); P7.1-P7.3, P7.8, and P7.10 to `TECHNICAL_DECISIONS.md` (resolving the deferred "Background job runner", and adding to "Deferred hardening": a separate worker process, stored due times when the check grows slow, live push to the browser, and monitoring that alerts when a job keeps failing).

## 11. Change Log

| Date       | Change                                                                                                                         | Reason                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| 2026-10-26 | Initial draft from the owner's answers to the pre-spec discussion (Q1-Q9), with Q10 and Q11 open.                              | Phase 6 implemented; Phase 7 spec drafted. |
| 2026-10-26 | Resolved Q10 and Q11 with option (a): the storage warning re-arms below 80%; escalation recipients gain no visibility (P7.12). | Owner answering round.                     |
| 2026-10-26 | Implemented and verified: 7.2 then 7.4 by one agent, 7.1 then 7.3 and 7.5 by the other; migrations `0020`-`0022`; full suite, ten mutation checks re-run in review, and an end-to-end run of all ten scenarios against a running server, including two instances and Read-only. Approved by the owner and folded in: `unread=false` as no filter (4.2), the tie order of one transaction's notifications (4.2), the scheduler's log lines and the empty or unknown `JOBS` refusal (4.3), per-request failure isolation and the `failed` count (4.3), `fired_at` from the database clock (4.3), `stage_held` on every held result and the handler escalation's single transition (4.3), the storage re-arm order and the uploader not excluded (4.3), the no-recipients audit (4.1), the `notify` import path (4.4), and two rows of section 5. Also found in review and fixed: the first file test could time out while a fresh SeaweedFS allocated its volumes; the test setup now warms the store up. | Phase 7 implemented. |
| 2026-10-26 | Status set to `Implemented`; decisions promoted (D41-D46, T47-T51). | Phase 7 complete. |
