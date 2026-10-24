# Phase 5 Spec: Legal Configuration

| Field                  | Value                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**             | In Implementation                                                                                                                                                                                              |
| **Approved by / date** | _Amr 24/10/2026 - 19:27 pm_                                                                                                                                                                              |
| **Depends on**         | Phase 0 (`phase-0-foundations.md`), Phase 0.5 (`phase-0.5-refactor.md`), Phase 2 (`phase-2-org-structure-users.md`), Phase 3 (`phase-3-roles-authorization.md`), Phase 4 (`phase-4-working-calendar.md`) |
| **Related decisions**  | MVP 3.4, 3.5, 3.7, D1, D3, D4, D5, D6, D7, D8, D9, D18, D19, D20, D21; open questions 1 and 2; Technical T2, T8, T14, T16, T20, T21, T22, T24, T25, T26                                                  |

---

## 1. Objective

Let a tenant's legal team configure how it works: the **services** it offers, the **priority levels** requesters choose from, the **workflows** a request moves through, the **positions** that decide who acts on each workflow stage, and the **escalation settings** for R0-R2.
It is needed now because Phase 6 cannot submit, accept, or move a request without a service, a priority, and a workflow, and Phase 7 cannot escalate without thresholds and recipients.

## 2. Scope

**In scope:**

- **Positions:** named responsibilities placed in an org unit, held by members of that unit, independent of roles and permissions (Q8).
  Six built-in positions resolved from the request: the handler, the requester, and the managers of either one's unit or department (Q9).
- **The assignee resolver:** the function that turns a stage's position into people, applies exclusions, and climbs to higher levels; used by Phase 6 for stages and Phase 7 for escalation recipients.
- **Workflows:** ordered, linear stages, each naming a position and the builder's choices for that stage; every save of the stages creates a new, immutable version (Q4).
- **Services:** a name, a description, and a list of allowed workflows, one of them the default (Q1).
- **Priority levels:** a name, a deadline in working days, and a display order (D4).
- **Escalation settings:** for each of R0, R1, R2: on or off, its threshold, and its recipients as positions (Q16); not seeded, so a tenant configures them before requests can be submitted (Q17).
- Edit or retire, never delete, for services, priorities, workflows, and positions (Q6).
- Ten permissions (Q7); audit of every change; Read-only refuses every write.

**Out of scope (and where it is handled instead):**

- Running requests: submission, choosing the workflow at acceptance, starting stages, completing and returning them, the handler's narrow and escalate actions, copying the priority onto the request: Phase 6.
  This spec defines the configuration and the rules Phase 6 must follow (4.3, "Contract with Phase 6").
- Firing R0-R2 and delivering notifications: Phase 7.
- Parallel stages, conditions, branching, and routing policies (MVP section 4): later phases; versions and stage rows are chosen so they can be added (P5.4, P5.5).
- Tenant positions shared across units ("the Approver of the requester's department"): deferred; only the built-in positions are relative (Q9).
- Thresholds per priority, additional escalation rules, repeated reminders: deferred (Q16).
- Limiting a service to some departments, custom request fields: deferred; every active service is offered to every requester.
- Translated names: names are one text in the tenant's own language, as for units and roles.

## 3. Requirements

Example tenant: **Al-Noor**, with the structure and people of Phase 3:

```
Al-Noor (the tenant; not a unit)                no unit: Sara (owner), Lina (IT admin)
├── Legal Affairs (department)                  managers: Huda, Ahmed
│   ├── Contracts (section)                     managers: Faisal; member: Nora
│   └── Litigation (section)                    no manager
└── Finance (department)                        managers: Majed
    └── Procurement (section)                   managers: Reem; member: Khalid
```

Sara and Majed hold the Tenant Admin role, which holds every Phase 5 permission the moment it is added (D21).
Sara gives the Head of Legal role (Huda, Ahmed) all ten Phase 5 permissions.

Al-Noor's legal configuration after Huda sets it up:

| Item                             | Definition                                                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Position "Contracts Supervisor"  | in Contracts; held by Faisal                                                                                                                                                                                                                                              |
| Position "Procurement Reviewer"  | in Procurement; held by Khalid                                                                                                                                                                                                                                            |
| Position "Legal Intake"          | in Legal Affairs; held by Ahmed                                                                                                                                                                                                                                           |
| Workflow "Vendor contract", v1   | 1 Business approval (Requester's department managers, hold); 2 Drafting (Handler, hold); 3 Procurement check (Procurement Reviewer, skip, excluding the parties); 4 Supervisor sign-off (Contracts Supervisor, escalate, excluding the parties; the handler may escalate) |
| Workflow "Complex contract", v1  | the same stages plus 5 Legal Affairs approval (Handler's department managers, hold)                                                                                                                                                                                       |
| Service "Vendor contract review" | workflows Vendor contract (default) and Complex contract                                                                                                                                                                                                                  |
| Priorities                       | Urgent 2 days, High 5 days, Normal 10 days, in that order                                                                                                                                                                                                                 |
| Escalation                       | R0 on, 2 working days, to Legal Intake; R1 on, 75%, to the Handler; R2 on, to the Handler, the Handler's unit managers, and the Handler's department managers                                                                                                             |

The two sides of a request are the **requester** (who submitted it) and the **handler** (the request owner, MVP 3.5, assigned at acceptance).

| ID    | Requirement                                                                                                                                                                                                                                                                                                                                                             | Example                                                                                                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R5.1  | A position has a name and belongs to one department or section. Names are unique among the tenant's active positions, ignoring case. A position's unit never changes.                                                                                                                                                                                                                     | _Huda creates "Contracts Supervisor" in Contracts. A second "contracts supervisor" anywhere in Al-Noor: 409 `POSITION_NAME_TAKEN`._                                                                           |
| R5.2  | A position's holders are active members of its unit. A person holds at most one position. Being a unit manager is not a position, so a manager may also hold one.                                                                                                                                                                                                       | _Huda makes Faisal (manager of Contracts) the Contracts Supervisor. Making Nora (Contracts) the Procurement Reviewer: 400 `not_unit_member`. Huda adds a second position, "Contracts Reviewer", in Contracts; making Faisal its holder too: 400 `holds_other_position`._ |
| R5.3  | A holder who moves to another unit or is deactivated stops holding the position, in the same transaction.                                                                                                                                                                                                                                                               | _Sara moves Khalid from Procurement to Finance: Procurement Reviewer has no holder._                                                                                                                          |
| R5.4  | The built-in positions are Handler, Requester, Handler's unit managers, Handler's department managers, Requester's unit managers, and Requester's department managers. A person's **unit** is the section or department they sit in; their **department** is that unit if it is a department, or its parent.                                                            | _For a request from Khalid (Procurement), Requester's unit managers is Reem; Requester's department managers is Majed._                                                                                       |
| R5.5  | The resolver turns a position into the active people who may act: a tenant position's holders, the built-in person, or the managers of the built-in unit.                                                                                                                                                                                                               | _"Contracts Supervisor" resolves to Faisal._                                                                                                                                                                  |
| R5.6  | Exclusions: a built-in managers position never includes its own anchor (the handler or the requester); a stage marked "exclude the parties" never includes the handler or the requester.                                                                                                                                                                                | _Faisal is the handler; "Handler's unit managers" (Contracts) excludes him and finds nobody. Khalid submits; "Procurement Reviewer" with "exclude the parties" excludes him and finds nobody._                |
| R5.7  | When a stage resolves to nobody, the stage's builder choice applies: **escalate** climbs to the next level (the managers of the position's unit, then of its department, where the chain ends and the stage holds, Q18); **skip** passes the stage, recorded; **hold** waits for the structure to be fixed. A level with nobody eligible is passed over while climbing. | _Supervisor sign-off with Faisal as handler: escalate climbs from Contracts' managers (only Faisal, excluded) to Legal Affairs' managers: Huda and Ahmed. Procurement check for Khalid's request: skipped._   |
| R5.8  | A workflow has a name (unique, ignoring case) and 1 to 20 stages. Each stage has a name unique within the workflow, a position, a fallback (escalate, skip, or hold), and three yes/no choices: the handler may narrow the assignees, the handler may escalate, and the parties are excluded.                                                                           | _Huda creates "Vendor contract" with the four stages above._                                                                                                                                                  |
| R5.9  | Saving changed stages creates the next version; earlier versions never change. Renaming a workflow does not create a version. A save names the version it was based on and is refused if another save came first.                                                                                                                                                       | _On 2026-11-10 Huda adds a "Negotiation" stage: v2. Requests accepted on v1 keep its four stages. Ahmed, still editing from v1, saves: 409 `WORKFLOW_VERSION_CHANGED`._                                       |
| R5.10 | A stage may only name an active tenant position or a built-in position. A stage naming Handler or Requester cannot allow narrowing or exclude the parties.                                                                                                                                                                                                              | _A stage naming a retired position: 400 `position_retired`._                                                                                                                                                  |
| R5.11 | A service has a name (unique, ignoring case), an optional description, and one or more allowed active workflows, exactly one of them the default.                                                                                                                                                                                                                       | _"Vendor contract review" allows Vendor contract (default) and Complex contract; at acceptance (Phase 6) the reviewer picks one of those two._                                                                |
| R5.12 | A priority level has a name (unique, ignoring case), a deadline of 1 to 365 working days, and a place in the display order. The order is set as a whole list.                                                                                                                                                                                                           | _Huda orders Urgent, High, Normal. A sixth level "Low" goes to the end until she reorders._                                                                                                                   |
| R5.13 | Escalation settings: R0 on or off with N (1-30 working days), R1 on or off with X (1-99%), R2 on or off; each rule has recipients, given as positions. A rule that is on needs at least one recipient. R0 cannot name handler-side built-in positions, because no handler exists before acceptance.                                                                     | _Huda sets R0 to 2 days to Legal Intake. R0 to Handler: 400 `not_for_rule`. R1 on with no recipients: 400 `no_recipients`._                                                                                   |
| R5.14 | Escalation settings are not seeded. Until a tenant saves them, they are "not configured", and Phase 6 refuses submissions.                                                                                                                                                                                                                                              | _Al-Rashid's `GET /escalation` returns `{configured: false}`._                                                                                                                                                |
| R5.15 | Services, priorities, workflows, and positions are never deleted. Retiring hides one from new use; restoring brings it back. A retired item can be read but not edited.                                                                                                                                                                                                 | _Huda retires "Normal"; new requests cannot choose it; closed requests keep their copy of it (Phase 6)._                                                                                                      |
| R5.16 | Retiring is refused while active configuration depends on the item: a workflow allowed by an active service; a position named by the current version of an active workflow, or by an escalation recipient. Retiring a position removes its holders.                                                                                                                     | _Retiring "Vendor contract": 409 `WORKFLOW_IN_USE`. Retiring "Legal Intake" while R0 names it: 409 `POSITION_IN_USE`._                                                                                        |
| R5.17 | Permissions: `position`, `workflow`, `service`, `priority`, and `escalation`, each with `.view` to read and `.manage` to change; organization scope only.                                                                                                                                                                                                               | _Nora (Legal Staff, no Phase 5 permissions) calls `GET /workflows`: 403 `FORBIDDEN`._                                                                                                                         |
| R5.18 | Every change is audited in the same transaction, and refused while the subscription is Read-only. A write that changes nothing returns 200 with no audit entry.                                                                                                                                                                                                         | _Huda creates a workflow: `workflow.created` with v1's stages. In Read-only: 403 `SUBSCRIPTION_READ_ONLY`._                                                                                                   |
| R5.19 | Every endpoint reads and writes only the caller's tenant.                                                                                                                                                                                                                                                                                                               | _Huda sends an Al-Rashid position ID in a stage: 400 `unknown_position`._                                                                                                                                     |

## 4. Design

### 4.1 Data model

#### Positions

**`positions`** (new, tenant data):

| Column                     | Type          | Notes                                                                                                             |
| -------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`                       | `uuid` PK     |                                                                                                                   |
| `tenant_id`                | `uuid`        | FK to `tenants`, not null.                                                                                        |
| `unit_id`                  | `uuid`        | Composite FK `(tenant_id, unit_id)` → `org_units`. Null only for a retired position whose unit was deleted (4.3). |
| `name`                     | `text`        | Trimmed, 1-100 characters (check); unique `(tenant_id, lower(name))` among active positions.                                            |
| `retired_at`               | `timestamptz` | Null while active.                                                                                                |
| `created_at`, `updated_at` | `timestamptz` |                                                                                                                   |

Check: `unit_id is not null or retired_at is not null`.
Name uniqueness is a partial index `where retired_at is null`, so a retired position's name can be reused, and restoring it then meets `POSITION_NAME_TAKEN`; the same holds for workflows, services, and priorities.
Unique `(tenant_id, id)` and `(tenant_id, unit_id, id)` are targets of the foreign keys below.

**`tenant_members.position_id`** (new column, nullable): the position the member holds.
Composite FK `(tenant_id, unit_id, position_id)` → `positions (tenant_id, unit_id, id)`.
Because the key includes `unit_id`, the database refuses a holder outside the position's unit, and refuses a move to another unit that forgets to clear the position.
One column means one position per person (Q8) with no extra constraint.
A composite foreign key is not enforced when one of its columns is null, so a check `position_id is null or unit_id is not null` keeps a member with no unit from holding a position.

Why a column on the membership and not a holders table: it is the same reasoning as `is_manager` (T21): the rule "a holder is a member of the unit" becomes a foreign key, and a move must clear it.

#### Assignee targets

A stage and an escalation recipient both point at a **target**: either a tenant position or a built-in one.

```sql
target_position_id   uuid null          -- composite FK (tenant_id, target_position_id) → positions
target_builtin       assignee_builtins  -- enum: handler, requester, handler_unit_managers,
                                        --       handler_department_managers, requester_unit_managers,
                                        --       requester_department_managers
check (num_nonnulls(target_position_id, target_builtin) = 1)
```

The built-ins are an enum, not seeded position rows: they have no unit, no holders, and no name to edit, and the resolver treats them differently.

#### Workflows and versions

**`workflows`**: `id`, `tenant_id`, `name` (unique `(tenant_id, lower(name))` among active rows), `current_version_id`, `retired_at`, `created_at`, `updated_at`.

**`workflow_versions`** (never updated): `id`, `tenant_id`, `workflow_id` (composite FK), `number` (1, 2, 3, ...; unique `(workflow_id, number)`), `created_by`, `created_at`.

**`workflow_stages`** (never updated):

| Column                                 | Type                   | Notes                                               |
| -------------------------------------- | ---------------------- | --------------------------------------------------- |
| `id`                                   | `uuid` PK              | Phase 6's request stages reference this.            |
| `tenant_id`, `version_id`              | `uuid`                 | Composite FK to `workflow_versions`.                |
| `ordinal`                              | `smallint`             | 1-20; unique `(version_id, ordinal)`.               |
| `name`                                 | `text`                 | Trimmed, 1-100; unique `(version_id, lower(name))`. |
| `target_position_id`, `target_builtin` |                        | A target, as above.                                 |
| `when_unresolved`                      | `stage_fallbacks` enum | `escalate`, `skip`, `hold`.                         |
| `handler_may_narrow`                   | `boolean`              |                                                     |
| `handler_may_escalate`                 | `boolean`              |                                                     |
| `exclude_parties`                      | `boolean`              |                                                     |

Check: a stage naming `handler` or `requester` has `handler_may_narrow` and `exclude_parties` false.
Unique `(tenant_id, version_id, id)` lets Phase 6 require that a request's stage belongs to the request's version.

`workflows.current_version_id` is not null, with a composite FK `(tenant_id, id, current_version_id)` → `workflow_versions (tenant_id, workflow_id, id)`, so the current version always belongs to the workflow itself.
It is deferrable initially deferred, because a workflow and its first version are inserted in one transaction; Drizzle cannot declare that, so a custom migration sets it.

Why versions (Q4): request #42, accepted on v1, must keep v1's path when Huda inserts a stage on 2026-11-10.
Each version is a complete, immutable definition, so a request only points at one and a future graph (transitions, conditions) is stored once per version, not copied into every request.
Why rows, not a JSON list (Q3): request stages and stage targets are referenced from outside, so the database can refuse a request stage that does not exist, and "which workflows name this position" is one query.

#### Services

**`services`**: `id`, `tenant_id`, `name` (unique `(tenant_id, lower(name))` among active rows), `description` (nullable, up to 2,000 characters), `retired_at`, `created_at`, `updated_at`.

**`service_workflows`**: `tenant_id`, `service_id`, `workflow_id` (composite FKs), `is_default`; primary key `(service_id, workflow_id)`; unique `(service_id) where is_default`.
"At least one, exactly one default" is checked by the service, because a constraint cannot count rows across a table.

#### Priorities

**`priorities`**: `id`, `tenant_id`, `name` (unique `(tenant_id, lower(name))` among active rows), `days` (`smallint`, 1-365, check), `sort_order` (`smallint`, null while retired), `retired_at`, `created_at`, `updated_at`.
Unique `(tenant_id, sort_order)`, deferrable, so a reorder can swap values in one statement.

#### Escalation settings

**`escalation_settings`**: `tenant_id` PK, `r0_enabled`, `r0_days` (1-30), `r1_enabled`, `r1_percent` (1-99), `r2_enabled`, `updated_at`.
No row means "not configured" (Q17).
Thresholds are required even for a rule that is off, so turning it back on never needs a value it lost.

**`escalation_recipients`**: `tenant_id`, `rule` (`escalation_rules` enum `r0`, `r1`, `r2`), a target; unique per `(tenant_id, rule, target)`.

#### Migrations

Generated migrations `0008_positions`, `0009_workflows`, `0011_services_priorities`, and `0012_escalation`, plus the custom `0010_workflows_deferred_version_fk`, which makes the current-version key deferrable.
No backfill: nothing is seeded (Q17).

#### Audit actions

| Action                                                                          | Resource                            | `details`                                                                         |
| ------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| `position.created`, `position.updated`                                          | position                            | definition; `{before, after}`                                                     |
| `position.retired`, `position.restored`                                         | position                            | `{removedHolders}` on retire                                                      |
| `position.holders_set`                                                          | position                            | `{before, after}` (user IDs)                                                      |
| `workflow.created`                                                              | workflow                            | `{name, version: 1, stages}`                                                      |
| `workflow.updated`                                                              | workflow                            | `{before, after}` of the name, and `{version, stages}` when a version was created |
| `workflow.retired`, `workflow.restored`                                         | workflow                            | none                                                                              |
| `service.created`, `service.updated`, `service.retired`, `service.restored`     | service                             | definition; `{before, after}`                                                     |
| `priority.created`, `priority.updated`, `priority.retired`, `priority.restored` | priority                            | definition; `{before, after}`                                                     |
| `priority.reordered`                                                            | priority (tenant ID as resource ID) | `{before, after}` (ID lists)                                                      |
| `escalation.updated`                                                            | escalation settings (tenant ID)     | `{before, after}`; `before` null the first time                                   |

A member's move or deactivation that clears a position adds `positionId` to the existing `user.updated` or `user.deactivated` details.

### 4.2 API

Tenant routes run `authenticate()`, `requireRole('user')`, the subscription guard (T16), and `requireTenantPermission(...)`.
Writes are allowed in Active and Grace (configuration is not a submission, MVP 3.1), refused in Read-only.

| Method | Path                                 | Permission          | Request                                             | Responses                                                                                                     |
| ------ | ------------------------------------ | ------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/positions`                         | `position.view`     | `unitId?`, `includeRetired?`                        | 200 `{positions:[position]}`                                                                                  |
| GET    | `/positions/:id`                     | `position.view`     |                                                     | 200 `{position}`; 404                                                                                         |
| POST   | `/positions`                         | `position.manage`   | `{unitId, name}`                                    | 201 `{position}`; 400; 409 `POSITION_NAME_TAKEN`                                                              |
| PATCH  | `/positions/:id`                     | `position.manage`   | `{name}`                                            | 200; 400; 404; 409 `POSITION_NAME_TAKEN`, `RESOURCE_RETIRED`                                                  |
| PUT    | `/positions/:id/holders`             | `position.manage`   | `{userIds:[...]}`                                   | 200 `{position}`; 400 `not_unit_member`, `holds_other_position`, `user_inactive`; 404; 409 `RESOURCE_RETIRED` |
| POST   | `/positions/:id/retire`              | `position.manage`   |                                                     | 200; 404; 409 `POSITION_IN_USE`                                                                               |
| POST   | `/positions/:id/restore`             | `position.manage`   |                                                     | 200; 404; 409 `POSITION_NAME_TAKEN`, `POSITION_UNIT_GONE`                                                     |
| GET    | `/workflows`                         | `workflow.view`     | `includeRetired?`                                   | 200 `{workflows:[summary]}`                                                                                   |
| GET    | `/workflows/:id`                     | `workflow.view`     |                                                     | 200 `{workflow}` with the current version's stages; 404                                                       |
| GET    | `/workflows/:id/versions/:number`    | `workflow.view`     |                                                     | 200 `{version}`; 404                                                                                          |
| POST   | `/workflows`                         | `workflow.manage`   | `{name, stages:[stage]}`                            | 201 `{workflow}`; 400; 409 `WORKFLOW_NAME_TAKEN`                                                              |
| PUT    | `/workflows/:id`                     | `workflow.manage`   | `{name, baseVersion, stages:[stage]}`               | 200 `{workflow}`; 400; 404; 409 `WORKFLOW_NAME_TAKEN`, `WORKFLOW_VERSION_CHANGED`, `RESOURCE_RETIRED`         |
| POST   | `/workflows/:id/retire`              | `workflow.manage`   |                                                     | 200; 404; 409 `WORKFLOW_IN_USE`                                                                               |
| POST   | `/workflows/:id/restore`             | `workflow.manage`   |                                                     | 200; 404; 409 `WORKFLOW_NAME_TAKEN`, `WORKFLOW_POSITION_RETIRED`                                              |
| GET    | `/services`                          | `service.view`      | `includeRetired?`                                   | 200 `{services:[service]}`                                                                                    |
| GET    | `/services/:id`                      | `service.view`      |                                                     | 200; 404                                                                                                      |
| POST   | `/services`                          | `service.manage`    | `{name, description?, workflows:[{id, isDefault}]}` | 201; 400; 409 `SERVICE_NAME_TAKEN`                                                                            |
| PATCH  | `/services/:id`                      | `service.manage`    | any of the create fields                            | 200; 400; 404; 409 `SERVICE_NAME_TAKEN`, `RESOURCE_RETIRED`                                                   |
| POST   | `/services/:id/retire`, `/restore`   | `service.manage`    |                                                     | 200; 404; 409 `SERVICE_NAME_TAKEN` (restore), `SERVICE_WORKFLOW_RETIRED` (restore)                            |
| GET    | `/priorities`                        | `priority.view`     | `includeRetired?`                                   | 200 `{priorities:[priority]}` in display order                                                                |
| POST   | `/priorities`                        | `priority.manage`   | `{name, days}`                                      | 201; 400; 409 `PRIORITY_NAME_TAKEN`                                                                           |
| PATCH  | `/priorities/:id`                    | `priority.manage`   | `{name?, days?}`                                    | 200; 400; 404; 409 `PRIORITY_NAME_TAKEN`, `RESOURCE_RETIRED`                                                  |
| PUT    | `/priorities/order`                  | `priority.manage`   | `{ids:[...]}`                                       | 200 `{priorities}`; 400 `order_mismatch`                                                                      |
| POST   | `/priorities/:id/retire`, `/restore` | `priority.manage`   |                                                     | 200; 404; 409 `PRIORITY_NAME_TAKEN` (restore)                                                                 |
| GET    | `/escalation`                        | `escalation.view`   |                                                     | 200 `{configured, settings?}`                                                                                 |
| PUT    | `/escalation`                        | `escalation.manage` | `{r0, r1, r2}`                                      | 200 `{configured: true, settings}`; 400                                                                       |

Shapes:

- **Target:** `{position: <id>}` or `{builtin: "handler" | "requester" | "handler_unit_managers" | "handler_department_managers" | "requester_unit_managers" | "requester_department_managers"}`.
  Responses add the position's name.
- **Stage:** `{name, assignee: target, whenUnresolved: "escalate" | "skip" | "hold", handlerMayNarrow, handlerMayEscalate, excludeParties}`; every field required (Q10: the builder decides, no default).
- **Position:** `{id, unitId, name, retired, holders:[{userId, name}]}`.
- **Workflow:** `{id, name, retired, version: {number, createdAt, createdBy, stages}, versionCount}`.
- **Service:** `{id, name, description, retired, workflows:[{id, name, isDefault, retired}]}`.
- **Priority:** `{id, name, days, retired}`.
- **Escalation:** `{r0: {enabled, days, recipients:[target]}, r1: {enabled, percent, recipients}, r2: {enabled, recipients}}`, replaced as a whole.

Lists are ordered by name (T20), except priorities (display order) and stages (ordinal).
`PUT /positions/:id/holders` replaces the holders: a user listed twice counts once, an empty list vacates the position, and each refused entry is reported at `userIds.<index>`.
The holder and unit foreign keys map to `not_unit_member` (path `userIds`) and `unknown_unit` (path `unitId`) (T22).
`resolveAssignees` and `nextLevel` return `{level, userIds}`, so a caller that climbs does not resolve again; the context's `handlerId` may be null, as before acceptance (R0).
`PUT /workflows/:id` with the same stages as the current version creates no version; with the same name too, it returns 200 with no audit entry.
`PUT /priorities/order` must list exactly the active priorities (`order_mismatch` otherwise); retiring removes a priority from the order, restoring appends it.

#### New error codes

| HTTP | Code                                                                                      | When                                                               |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 409  | `POSITION_NAME_TAKEN`, `WORKFLOW_NAME_TAKEN`, `SERVICE_NAME_TAKEN`, `PRIORITY_NAME_TAKEN` | Unique names, ignoring case (mapped from the indexes, as T11).     |
| 409  | `RESOURCE_RETIRED`                                                                        | Editing a retired item.                                            |
| 409  | `POSITION_IN_USE`, `WORKFLOW_IN_USE`                                                      | Retiring an item active configuration depends on (R5.16).          |
| 409  | `POSITION_UNIT_GONE`                                                                      | Restoring a position whose unit was deleted.                       |
| 409  | `SERVICE_WORKFLOW_RETIRED`                                                                | Restoring a service whose allowed workflows include a retired one. |
| 409  | `WORKFLOW_VERSION_CHANGED`                                                                | `baseVersion` is not the current version.                          |
| 409 | `WORKFLOW_POSITION_RETIRED` | Restoring a workflow whose current version names a retired position; its positions are restored first. |

Validation detail codes: `unknown_position`, `position_retired`, `unknown_workflow`, `workflow_retired`, `not_unit_member`, `holds_other_position`, `user_inactive`, `duplicate_name` (stages), `too_many_stages`, `not_allowed` (narrow or exclude on Handler or Requester), `no_default`, `many_defaults`, `not_for_rule`, `no_recipients`, `order_mismatch`.

### 4.3 Key flows

#### Resolving a target

`resolveAssignees(executor, tenantId, target, {handlerId, requesterId}, {excludeParties})` returns `{level, userIds}`; `nextLevel(executor, tenantId, level, context, options)` returns the next non-empty level up, or null at the top.
Phase 6 calls them when a stage starts, when it is returned to, and when the handler escalates; Phase 7 calls `resolveAssignees` for each recipient.

Levels and how each climbs:

| Starting level                                       | Resolves to            | Next level up                                                   |
| ---------------------------------------------------- | ---------------------- | --------------------------------------------------------------- |
| Tenant position P in unit U                          | P's active holders     | managers of U                                                   |
| Handler / Requester                                  | that person, if active | managers of their unit                                          |
| Managers of unit U (built-in or reached by climbing) | U's active managers    | managers of U's department, if U is a section                   |
| Managers of a department                             | its active managers    | none: the chain ends, and a stage that found nobody holds (Q18) |

Exclusions apply at every level: the anchor of a built-in managers position, and the handler and requester when the stage excludes the parties.
A level left empty by exclusions or vacancies is passed over while climbing (as escalation does, MVP 3.7).
A person with no unit has no unit managers and no department managers (D19).

Worked example: Khalid (Procurement) submits #42 for "Vendor contract review"; it is accepted on Vendor contract v1, and Faisal (Contracts) becomes the handler.

1. Business approval, Requester's department managers: Khalid's department is Finance: **Majed**.
2. Drafting, Handler: **Faisal**.
3. Procurement check, Procurement Reviewer, exclude the parties: Khalid holds it but is the requester: nobody; the fallback is skip: the stage is passed, recorded.
4. Supervisor sign-off, Contracts Supervisor, exclude the parties: Faisal holds it but is the handler: nobody; the fallback is escalate: managers of Contracts (Faisal, excluded), passed over; managers of Legal Affairs: **Huda, Ahmed**.
   Without "exclude the parties", Faisal would be resolved and sign off his own work.

The resolver reads current membership, unit, manager flag, and active status from the database at the moment it is called, so a move between stage start and action is caught when Phase 6 checks again (below).

#### Saving a workflow

In one transaction:

1. Lock the workflow row (`FOR UPDATE`); 409 `WORKFLOW_VERSION_CHANGED` if `baseVersion` is not current.
2. Lock every named position `FOR SHARE`, and check that each is active.
3. If the stages differ from the current version's: insert version N+1 and its stages, and point `current_version_id` at it.
4. Update the name if it changed; audit.

The share lock pairs with retiring (below): Huda saves a workflow naming "Legal Intake" while Ahmed retires it; whichever locks first wins, and the other sees the result: a save that names a retired position (400), or a retire that finds the position in use (409).
Without it, both checks could pass and an active workflow would name a retired position.

#### Retiring

The item's row is locked `FOR UPDATE`; then the dependents are checked (R5.16); then `retired_at` is set.
Services take `FOR SHARE` on the workflows they list, as workflows do on positions, so the same race is closed.
Retiring a position also sets `position_id` to null for its holders.

Deleting a unit (Phase 2) is refused with the existing 409 `UNIT_NOT_EMPTY` while the unit has an active position; its retired positions get `unit_id` null in the same transaction and can no longer be restored (`POSITION_UNIT_GONE`).
Restoring a position takes a key-share lock on its unit before locking the position, the same order a unit delete takes them, so a restore and a delete running together cannot leave an active position pointing at a deleted unit.

#### Moving or deactivating a member (changed, Phase 2)

Where Phase 2 clears `is_manager` on a move or a deactivation, `position_id` is cleared too, in the same update.
The composite foreign key makes a forgotten clear an error, not silent inconsistency.

#### Contract with Phase 6

These rules are decided here and implemented in Phase 6:

- At submission, the request copies the priority's name and days (Q4); at acceptance, the reviewer picks one of the service's allowed active workflows, and the request references that workflow's current version.
- When a stage starts, its target is resolved; any one resolved assignee may complete it, and the first action wins: the stage row is updated only while it is still active, so a second assignee gets 409 (Q12).
- Being a current resolved assignee of the active stage is the authorization to complete or return it; no catalog permission is required (Q14).
  This is a recorded exception to T24 for the stage-action routes, and is re-checked against the database at the moment of the action, so Khalid moved out of Procurement after the stage started can no longer act.
- An assignee may return the stage to the previous one, with a reason; the first stage cannot be returned; the previous stage's target is resolved again (Q11).
- Where the stage allows it, the handler may narrow the assignees to some of the resolved people, or escalate to `nextLevel` with a reason (Q13).
- The SLA clock keeps running during every stage, requester-side stages included (Q15, D7).
- Submission is refused while escalation is not configured (Q17); `isEscalationConfigured(executor, tenantId)` is exported for that.

### 4.4 Module structure

```
src/
  db/schema/positions.ts              new: positions, assignee_builtins enum
  db/schema/tenant-members.ts         (changed) position_id and its composite FK
  db/schema/workflows.ts              new: workflows, workflow_versions, workflow_stages, stage_fallbacks enum
  db/schema/services.ts               new: services, service_workflows
  db/schema/priorities.ts             new
  db/schema/escalation.ts             new: escalation_settings, escalation_recipients, escalation_rules enum
  http/errors.ts                      (changed) new codes and index mappings
  modules/
    positions/                        new: routes, controller, service, repository, config, schemas, types
      shared/resolve.ts               resolveAssignees, nextLevel
      index.ts                        the resolver and the target schema for other modules
    workflows/                        new
    services/                         new
    priorities/                       new
    escalation/                       new; index.ts exports isEscalationConfigured and the settings reader for Phase 7
    tenant-access/                    (changed) ten permissions in the catalog
    users/                            (changed) a move or deactivation clears position_id
    org/                              (changed) unit delete checks active positions
db/migrations/0008_positions.sql ... 0012_escalation.sql
```

`app.ts` gains `/positions`, `/workflows`, `/services`, `/priorities`, `/escalation`.

## 5. Edge Cases and Failure Behavior

| Scenario                                                                                                  | Expected behavior                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Huda and Ahmed both save "Vendor contract" from v1.                                                       | The row lock serializes them; the second gets 409 `WORKFLOW_VERSION_CHANGED` and reloads, so neither silently overwrites the other.                   |
| Huda names "Legal Intake" in a stage while Ahmed retires it.                                              | `FOR SHARE` versus `FOR UPDATE`: either the save fails with `position_retired` or the retire with `POSITION_IN_USE`.                                  |
| Huda makes Nora a holder while Sara moves Nora to Litigation.                                             | The composite FK refuses whichever write would leave a holder outside the unit; the loser gets 400 (T22 mapping).                                     |
| A holder is deactivated.                                                                                  | `position_id` cleared with the deactivation; reactivating does not restore it.                                                                        |
| Huda retires a position named only by v1 of a workflow whose current version is v2.                       | Allowed: only current versions of active workflows count. Requests still on v1 reaching that stage resolve to nobody and follow the stage's fallback. |
| Faisal is both the handler and the only Contracts Supervisor, and the stage does not exclude the parties. | He is resolved and may act. Excluding the parties is the builder's choice per stage (Q19).                                                            |
| The requester has no unit (Lina).                                                                         | Requester's unit and department managers resolve to nobody; the fallback applies.                                                                     |
| A workflow with 21 stages, or two stages named "Review".                                                  | 400 `too_many_stages`, `duplicate_name`.                                                                                                              |
| A service whose only allowed workflow is retired by mistake.                                              | Refused: `WORKFLOW_IN_USE` while an active service allows it.                                                                                         |
| Huda edits "High" from 5 to 3 days.                                                                       | Allowed at any time; requests already submitted keep 5 (Phase 6 copies it).                                                                           |
| `PUT /priorities/order` missing one active priority.                                                      | 400 `order_mismatch`.                                                                                                                                 |
| Escalation never configured.                                                                              | `{configured: false}`; Phase 6 refuses submissions (Q17); Phase 7 has nothing to fire.                                                                |
| R1 turned off.                                                                                            | Allowed; its threshold and recipients are kept for when it is turned back on.                                                                         |
| Al-Noor is Read-only.                                                                                     | Every write 403 `SUBSCRIPTION_READ_ONLY`; reads work.                                                                                                 |
| An Al-Rashid ID in any body.                                                                              | 400 `unknown_position` or `unknown_workflow` (composite FK, T22); in a path, 404.                                                                     |

## 6. Security and Authorization

- **Trust boundaries:** every body is a zod strict object (T25); stages and escalation settings are validated whole.
- **Tenant isolation:** application-level (T2); every cross-row link (holders, stage targets, recipients, service workflows, versions) is a composite foreign key with `tenant_id` (T21), so a foreign ID is refused by the database even if a query forgets its filter.
- **Authorization:** ten permissions at organization scope (T24, T26); the Tenant Admin role holds them with no data change (D21).
  Positions grant no permissions: holding "Contracts Supervisor" lets Faisal act on that stage of a request (Phase 6), not call any configuration endpoint.
- **Separation of duties:** built-in managers positions always exclude their anchor; "exclude the parties" lets the builder keep the handler and the requester off independent checks.
- **Audit:** every write in the same transaction (T8, MVP 3.9).

## 7. Implementation Steps

| Step                           | Objective                                                               | Delivers                                                                                                                                                                                                | Acceptance criteria                                                                                                                                                         | Verification                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 5.1 Positions and the resolver | Responsibilities can be placed in the structure and resolved to people. | Migration `0008`, `position.view` and `position.manage`, the position endpoints, holders, clearing on move, deactivation, and retire, the unit-delete check, `resolveAssignees` and `nextLevel`, audit. | R5.1-R5.7, R5.15-R5.19 for positions: every example in section 3 and the worked example in 4.3 resolve as written; holders outside the unit refused by the database.        | Integration tests; mutation checks: dropping an exclusion, the unit in the holder FK, or the clear on move each fail a test. |
| 5.2 Workflows                  | Linear workflows with immutable versions.                               | Migrations `0009` and `0010`, `workflow.view` and `workflow.manage`, the workflow endpoints, versioning, `baseVersion`, the share lock on positions, the position-in-use check, audit.                              | R5.8-R5.10, R5.15, R5.16, R5.18, R5.19: saves create versions only when stages change; old versions unchanged; concurrent saves and the retire race behave as in section 5. | Integration tests, including both races, which fail without their locks.                                                     |
| 5.3 Services and priorities    | The catalog requesters will choose from.                                | Migration `0011`, four permissions, the service and priority endpoints, allowed workflows and default, ordering, the workflow-in-use check, audit.                                                      | R5.11, R5.12, R5.15, R5.16, R5.18, R5.19.                                                                                                                                   | Integration tests; the service-versus-workflow-retire race fails without its lock.                                           |
| 5.4 Escalation settings        | Thresholds and recipients for R0-R2.                                    | Migration `0012`, `escalation.view` and `escalation.manage`, `GET` and `PUT /escalation`, `isEscalationConfigured`, the recipient position-in-use check, audit.                                         | R5.13, R5.14, R5.16, R5.18, R5.19.                                                                                                                                          | Integration tests; end-to-end check against a running server with Al-Noor's configuration from section 3.                    |

Order: 5.1, 5.2, 5.3, 5.4, one at a time in the main session, as in Phases 1-4.
Close-out (status, decision promotion, `ROADMAP_AND_STATUS.md`) follows step 5.4.

## 8. Test Plan

Integration tests against real PostgreSQL with Al-Noor and Al-Rashid; every lock is proven by removing it and showing its race test fails.

| Requirement  | Test                                                                                                                                                  | Step    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| R5.1-R5.3    | Position create, rename, holders; unit membership and one-position rules; clearing on move and deactivation.                                          | 5.1     |
| R5.4-R5.7    | The resolver over every built-in, exclusions, vacant levels, climbing, the top of the chain, people with no unit; the 4.3 worked example.             | 5.1     |
| R5.8-R5.10   | Create and save workflows; versions created only on stage changes; old versions readable and unchanged; stage validation; `WORKFLOW_VERSION_CHANGED`. | 5.2     |
| R5.11, R5.12 | Services with allowed workflows and one default; priorities, days, ordering.                                                                          | 5.3     |
| R5.13, R5.14 | Escalation settings, recipient rules per rule, "not configured".                                                                                      | 5.4     |
| R5.15, R5.16 | Retire and restore of each kind; in-use refusals; the two retire races.                                                                               | 5.1-5.4 |
| R5.17-R5.19  | Permission matrix (Huda manages, Nora refused), Read-only, audit rows, no-op writes, Al-Rashid IDs.                                                   | 5.1-5.4 |

## 9. Open Questions

Q1-Q17 were resolved in the pre-spec discussion with the owner on 2026-10-24; Q18-Q20 in the review of this draft.

| #   | Question                                                                                                                                                                                                                        | Options                                                                                                                                                                                                                                                                       | Resolution                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | How do services map to workflows (MVP open question 1)?                                                                                                                                                                         | (a) One workflow per service. (b) A service lists allowed workflows; legal picks one at acceptance. (c) Stages stored inside the service.                                                                                                                                     | **Resolved 2026-10-24: (b)**, each service lists its allowed workflows with one default, and the reviewer picks one of them at acceptance (P5.1).                                                                        |
| Q2  | What does a workflow stage define (MVP open question 2)?                                                                                                                                                                        | (a) Only a name; the handler assigns people. (b) A role. (c) A person. (d) A responsibility resolved to people automatically.                                                                                                                                                 | **Resolved 2026-10-24: (d)**, a stage names a position, which is resolved to people when the stage starts, with no manual assignment (P5.2).                                                                             |
| Q3  | Are stages rows or a JSON list?                                                                                                                                                                                                 | (a) Rows. (b) `jsonb` on the version.                                                                                                                                                                                                                                         | **Resolved 2026-10-24: (a)**, rows, because request stages and stage targets reference them and future transitions will too (P5.5).                                                                                      |
| Q4  | What happens to running requests when configuration is edited?                                                                                                                                                                  | (a) Requests copy what they use. (b) Versioned definitions. (c) Edits blocked while in use.                                                                                                                                                                                   | **Resolved 2026-10-24:** workflows are versioned and immutable, and a request references its version; priorities are copied onto the request at submission (P5.4).                                                       |
| Q5  | Do stages keep a stable key across versions?                                                                                                                                                                                    | (a) Yes. (b) No.                                                                                                                                                                                                                                                              | **Resolved 2026-10-24: (b)**, no stage keys; each version stands on its own.                                                                                                                                             |
| Q6  | Can configuration be deleted?                                                                                                                                                                                                   | (a) Retire only. (b) Delete until referenced.                                                                                                                                                                                                                                 | **Resolved 2026-10-24: (a)**, services, priorities, workflows, and positions are edited or retired, never deleted (P5.7).                                                                                                |
| Q7  | How fine-grained are the permissions?                                                                                                                                                                                           | (a) One `legal_config` pair. (b) A pair per resource.                                                                                                                                                                                                                         | **Resolved 2026-10-24: (b)**, `.view` and `.manage` for `position`, `workflow`, `service`, `priority`, and `escalation`, organization scope (P5.9).                                                                      |
| Q8  | What is a position?                                                                                                                                                                                                             | Bound to a role, a permission, a person, or a unit.                                                                                                                                                                                                                           | **Resolved 2026-10-24:** a position belongs to one org unit and is held by members of that unit; it is independent of roles and permissions; a person holds at most one position; managed with `position.manage` (P5.3). |
| Q9  | How do stages express the requester's or handler's side?                                                                                                                                                                        | (1) Fixed positions only. (2) Built-in relative positions. (3) Tenant positions shared across units.                                                                                                                                                                          | **Resolved 2026-10-24: (2)**, six built-in positions relative to the handler and the requester; the two sides are named requester and handler (P5.3).                                                                    |
| Q10 | What happens when a stage resolves to nobody?                                                                                                                                                                                   | Escalate up; skip; hold; one fixed rule.                                                                                                                                                                                                                                      | **Resolved 2026-10-24:** the builder chooses per stage between escalate, skip, and hold, with no default (P5.6).                                                                                                         |
| Q11 | Can a stage go back?                                                                                                                                                                                                            | Not in the MVP; return to the previous stage.                                                                                                                                                                                                                                 | **Resolved 2026-10-24:** an assignee may return the stage to the previous one, which is resolved again (Phase 6 contract).                                                                                               |
| Q12 | When several people are resolved, who acts?                                                                                                                                                                                     | Any one; all.                                                                                                                                                                                                                                                                 | **Resolved 2026-10-24:** any one of them; the first action wins and the others are refused (Phase 6 contract).                                                                                                           |
| Q13 | May the handler change a stage's assignees?                                                                                                                                                                                     | None; narrow; escalate; both.                                                                                                                                                                                                                                                 | **Resolved 2026-10-24:** the builder sets two independent toggles per stage: the handler may narrow to some of the resolved people, and may escalate to the next level with a reason (P5.6).                             |
| Q14 | What authorizes acting on a stage?                                                                                                                                                                                              | A catalog permission; being a resolved assignee.                                                                                                                                                                                                                              | **Resolved 2026-10-24:** being a current resolved assignee of the active stage; no permission is needed (P5.8).                                                                                                          |
| Q15 | Does the SLA run during requester-side stages?                                                                                                                                                                                  | Yes; paused.                                                                                                                                                                                                                                                                  | **Resolved 2026-10-24:** yes, the SLA always runs (D7; Phase 6 contract).                                                                                                                                                |
| Q16 | What in R0-R2 is configurable?                                                                                                                                                                                                  | Thresholds only; plus on/off and recipients; plus per-priority thresholds and new rules.                                                                                                                                                                                      | **Resolved 2026-10-24:** on or off, the thresholds, and recipients as positions; per-priority thresholds and new rules are deferred (P5.10).                                                                             |
| Q17 | Are escalation settings seeded for new tenants?                                                                                                                                                                                 | (a) Seeded defaults. (b) Not seeded, rules off until configured. (c) Not seeded, submission blocked until configured.                                                                                                                                                         | **Resolved 2026-10-24: (c)**, nothing is seeded; each tenant defines its settings, and Phase 6 refuses submissions until they exist (P5.11).                                                                             |
| Q18 | Where does climbing end? After a department's managers there is no higher unit, and the organization has no managers (D3). Example: Litigation has no manager and neither does a stage's whole chain; the fallback is escalate. | (a) **Recommended:** the top is the end; when climbing finds nobody, the stage holds, so nobody unrelated approves, and R1 and R2 still show the delay. (b) A tenant position chosen in the escalation settings as the final approver ("General Counsel"). (c) Tenant Admins. | **Resolved 2026-10-24: (a)**, climbing ends after the department's managers; when it finds nobody, the stage holds (P5.12).                                                                                              |
| Q19 | Should tenant positions exclude the handler and the requester automatically, or per stage? Example: "Contracts Lawyer" for a drafting stage should include the handler; "Contracts Supervisor" for a sign-off should not.       | (a) **Recommended:** a per-stage "exclude the parties" choice, required, as in this draft. (b) Always exclude on tenant positions. (c) Never exclude.                                                                                                                         | **Resolved 2026-10-24: (a)**, each stage has a required "exclude the parties" choice set by the builder (P5.6).                                                                                                          |
| Q20 | Are position names unique in the tenant or within their unit? Example: "Reviewer" in Contracts and "Reviewer" in Procurement.                                                                                                   | (a) **Recommended:** unique in the tenant, so a builder picking from a list of all positions cannot confuse two. (b) Unique within the unit, shown with the unit name.                                                                                                        | **Resolved 2026-10-24: (a)**, position names are unique in the tenant, ignoring case (P5.3).                                                                                                                             |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #     | Decision                                                                                                                                                                                                                             | Rationale                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5.1  | A service lists one or more allowed workflows, exactly one the default; the reviewer picks one of them at acceptance.                                                                                                                | Owner decision (Q1); resolves MVP open question 1; one service can offer a standard and a complex path.                                                        |
| P5.2  | A workflow stage names a position, resolved to people automatically when the stage starts.                                                                                                                                           | Owner decision (Q2); resolves MVP open question 2; nobody has to assign routine work by hand.                                                                  |
| P5.3  | Positions belong to one unit and are held by members of that unit (at most one position per person, stored on the membership); names are unique in the tenant; six built-in positions are relative to the handler and the requester. | Owner decisions (Q8, Q9, Q20); refines D3: positions are responsibilities that work is routed to, not job titles; independent of roles (D1).                   |
| P5.4  | Workflows are versioned: a save that changes stages creates the next immutable version, and requests reference their version; a save names its base version. Priorities are copied onto the request instead.                         | Owner decision (Q4): running requests keep their path, and a future graph is stored once per version; the base version prevents lost updates.                  |
| P5.5  | Stages are rows, referenced by Phase 6 request stages through composite foreign keys.                                                                                                                                                | Owner decision (Q3): the database refuses stages that do not exist and cross-version links.                                                                    |
| P5.6  | Each stage carries the builder's fallback (escalate, skip, hold) and three required toggles: handler may narrow, handler may escalate, exclude the parties. Built-in managers positions always exclude their anchor.                 | Owner decisions (Q10, Q13, Q19); nobody approves their own request or work through a manager position.                                                         |
| P5.7  | Configuration is retired, never deleted; retiring is refused while active configuration depends on the item, checked under row locks.                                                                                                | Owner decision (Q6); history stays readable; no active service or workflow points at a retired item.                                                           |
| P5.8  | Acting on a stage is authorized by being a current resolved assignee, not by a permission; an explicit exception to T24 for the Phase 6 stage routes.                                                                                | Owner decision (Q14): a requester with no legal permissions can confirm their stage, and a Tenant Admin cannot sign a sign-off assigned to others.             |
| P5.9  | Ten permissions, a `.view` and `.manage` pair for each of `position`, `workflow`, `service`, `priority`, `escalation`, at organization scope.                                                                                        | Owner decision (Q7).                                                                                                                                           |
| P5.10 | Escalation settings per tenant: each rule on or off, thresholds (R0 1-30 working days, R1 1-99%), and recipients as positions; R0 cannot name handler-side positions.                                                                | Owner decision (Q16); amends MVP 3.4 and 3.7 (recipients are configured, not fixed).                                                                           |
| P5.11 | Escalation settings are not seeded; until saved, the tenant is "not configured" and Phase 6 refuses submissions.                                                                                                                     | Owner decision (Q17): no request ever exists without escalation monitoring, and no threshold is a guess made for the tenant.                                   |
| P5.12 | Climbing ends after the managers of a department; when it finds nobody, the stage holds.                                                                                                                                             | Owner decision (Q18): the organization has no managers (D3), and nobody unrelated to the work approves it; the SLA keeps running, so R1 and R2 show the delay. |

Promote at close-out: P5.1-P5.3, P5.6, P5.8, P5.10-P5.12 to `MVP_SCOPE.md` (with 3.4, 3.5, 3.7, and D3 updated and open questions 1 and 2 struck); P5.3 (storage), P5.4, P5.5, P5.7 to `TECHNICAL_DECISIONS.md`.

## 11. Change Log

| Date       | Change                                                                                                                                                                                                                               | Reason                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 2026-10-24 | Initial draft, with Q1-Q17 resolved in the pre-spec discussion.                                                                                                                                                                      | Phase 5 spec requested. |
| 2026-10-24 | Resolved Q18 (climbing ends after department managers, then the stage holds), Q19 (a required per-stage "exclude the parties"), and Q20 (position names unique in the tenant), each with the recommended option (P5.12, P5.6, P5.3). | Owner review.           |
| 2026-10-24 | Spec approved; implementation started. | Owner approval. |
| 2026-10-24 | Step 5.1 implemented and verified: migration `0008_positions`, `position.view` and `position.manage`, the `/positions` endpoints, holders, clearing on move, deactivation, and retire, the unit-delete rule, `resolveAssignees` and `nextLevel`, audit. Approved by the owner: name uniqueness among active rows only (also for workflows, services, priorities); the `tenant_members_position_has_unit` check; the R5.2 example corrected; the restore lock order; holder-list, error-mapping, and resolver return details (4.1-4.3). | Acceptance criteria met; 75 new tests, full suite 609 passing on Node 24; mutation checks: dropping either exclusion, the unit in the holder key, the clear on move, or the restore lock each fail the matching tests. |
| 2026-10-24 | Step 5.2 implemented and verified: migrations `0009_workflows` and `0010_workflows_deferred_version_fk`, `workflow.view` and `workflow.manage`, the `/workflows` endpoints, immutable versions created only when stages change, `baseVersion`, the workflow row lock and the position share lock, the position-in-use check, audit. Approved by the owner: the custom migration `0010` (5.3 and 5.4 move to `0011` and `0012`); the current-version key enforcing that the version belongs to the workflow; stages carry their `id`, the list shows no stages, audit stores stages in request shape; check order 404, retired, base version, positions; a case change in a stage name is a stage change; restoring a workflow is refused with 409 `WORKFLOW_POSITION_RETIRED` until the positions its current version names are restored. | Acceptance criteria met; 56 new tests, full suite 673 passing on Node 24; mutation checks: removing the workflow row lock, the position share lock, the stages-changed comparison, or the restore check each fail the matching tests. |
