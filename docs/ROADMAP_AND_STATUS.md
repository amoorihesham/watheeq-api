# Roadmap and Status

## Watheeq - Legal Affairs Management System

**Last updated:** 2026-10-25

### Current Status

- Product scope agreed (`MVP_SCOPE.md`).
- **MVP simplification (2026-10-21):** the codebase was simplified to fit the MVP stage, and the docs were rewritten to match.
  Tenant isolation is now application-level `tenant_id` filtering (no RLS), there is one `users` table with a `role` (`user` or `operator`), membership goes through `tenant_members`, and authentication uses JWT access and refresh cookies.
  Login throttling, CSRF tokens, RLS, and database-enforced append-only audit are deferred (`TECHNICAL_DECISIONS.md`, "Deferred hardening").
- **Phase 0 (technical foundations) implemented** (`docs/specs/phase-0-foundations.md`): skeleton, cross-cutting basics, database baseline, audit, and JWT authentication with rotating, database-checked refresh tokens.
  `modules/auth/` is the reference example of the per-module file rules (Phase 0.5 spec), which every later module follows.
  A post-implementation refactor added `users.user_name`, the final access-token payload (`tenant: {id, roleId, roleName, permissions}`), module-owned composition in each routes file, and `<Name>Type` naming. The baseline migration was regenerated, so a local database migrated earlier must be recreated (`docker compose down -v`).
- **Phase 1 (platform, plans & subscriptions) implemented** (`docs/specs/phase-1-platform-subscriptions.md`): plans with price, payment period, and discount; tenant creation with the first Tenant Admin, who verifies their email and sets a password (Mailpit locally); subscriptions with copied terms, customer discount, and derived Active / Grace / Read-only state; subscription changes; the user limit under a per-tenant lock; the Read-only guard and `GET /subscription`.
  Its main decisions are T15-T20 in `TECHNICAL_DECISIONS.md`.
- **Known open items:** the KSA hosting provider must offer PostgreSQL 18 with ICU, and an SMTP email provider must be chosen before production (`TECHNICAL_DECISIONS.md`, deferred decisions).
- **Phase 2 (org structure & users) implemented** (`docs/specs/phase-2-org-structure-users.md`): departments and sections under the organization, zero or more managers per unit, users invited by email (they set their own password), edit, deactivate and reactivate with owner and self protections, password change and reset, and tenant permissions declared on every route (interim role table until Phase 3).
  Its main decisions are D18-D20 in `MVP_SCOPE.md` and T21-T24 in `TECHNICAL_DECISIONS.md`. Migration `0004` replaces `email_verifications` with `password_tokens`, so pending verification links in a local database must be resent.
- **Phase 3 (roles & authorization) implemented** (`docs/specs/phase-3-roles-authorization.md`): a code-held permission catalog with scopes, tenant-defined roles, a protected Tenant Admin role with computed permissions, role management and assignment under the subset rule checked against the actor's current role, and the user directory limited by `user.view` scope resolved in SQL from the caller's current unit.
  Its main decisions are D21-D23 in `MVP_SCOPE.md` and T26-T29 in `TECHNICAL_DECISIONS.md`; T25 (request bodies reject unknown fields) was added during the phase. Migration `0005` adds a required `role_id` to members, so a local database migrated earlier must be recreated (`docker compose down -v`).
- **Known test flake:** about one full test run in three loses a Vitest worker to an external SIGKILL (not memory, not Vitest itself; seen on the Phase 3 step 3.1 commit too). The sender is not yet identified; tracing it needs `strace`.
- **Phase 4 (working calendar) implemented** (`docs/specs/phase-4-working-calendar.md`): per-tenant working hours with weekday spans, seasonal hours with explicit ranks, holidays one-off or recurring on Gregorian or Umm al-Qura dates with one-year adjustments, versioned rules whose past never changes, a day view, and the working-time functions Phases 6 and 7 use (`loadCalendar`, `addWorkingDays`, `workingDaysBetween`).
  Its main decisions are D24-D27 in `MVP_SCOPE.md` and T30-T33 in `TECHNICAL_DECISIONS.md`. Migrations `0006` and `0007` add the calendar tables and give existing tenants the default hours.
- **Phase 5 (legal configuration) implemented** (`docs/specs/phase-5-legal-configuration.md`): positions placed in org units and held by their members, six built-in positions relative to the handler and the requester, the assignee resolver that Phases 6 and 7 use (`resolveAssignees`, `nextLevel`), linear workflows with immutable versions, services with allowed workflows and a default, priorities with a display order, and escalation settings per rule (on or off, threshold, recipients) that must be saved before requests can be submitted (`isEscalationConfigured`).
  Its main decisions are D28-D33 in `MVP_SCOPE.md` (resolving open questions 1 and 2) and T34-T37 in `TECHNICAL_DECISIONS.md`. Migrations `0008`-`0012` add the tables; nothing is seeded.
- **Phase 5.5 (service forms & file storage) implemented** (`docs/specs/phase-5.5-service-forms-attachments.md`): added in the Phase 6 pre-spec discussion, it gives each service a request form with stable field IDs and revisions, answer checking and snapshots for Phase 6 (`validateAnswers`, `snapshotAnswers`), file uploads to S3-compatible storage with type detection and download-only serving, pending uploads that expire after 24 hours, a storage limit per plan reserved under a per-tenant lock, the cleanup sweep, and `attachFiles` / `discardFiles` for Phase 6.
  Its main decisions are D34-D36 in `MVP_SCOPE.md` and T38-T42 in `TECHNICAL_DECISIONS.md`. Migrations `0013` and `0014` add the form and file tables; local development now also needs the SeaweedFS storage service from `docker-compose.yml` and the `STORAGE_*` settings in `.env.example`.
  Phase 6 round 1 answers are recorded for its spec; its round 2 questions on numbering, editing, stage mechanics, and attachment access are still open.
- **Next action:** the Phase 6 (request lifecycle) pre-spec discussion continues with its round 2 questions, then its spec is drafted.

---

### Roadmap

Each phase moves through: `Not started → Spec Draft → Spec Approved → In Implementation → Implemented`.

| #   | Phase                           | Delivers                                                                                    | Depends on | Status                                  |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------- | ---------- | --------------------------------------- |
| 0   | Technical foundations           | Skeleton, cross-cutting basics, tenant data model, audit, JWT authentication                | -          | Implemented |
| 0.5 | Layered architecture            | Routes → controller → service → repository convention, central middleware, test helpers   | 0          | Implemented                             |
| 1   | Platform, plans & subscriptions | Tenants, plans, subscriptions, Active → Grace → Read-only, user limit, email verification | 0, 0.5     | Implemented                                    |
| 2   | Org structure & users           | Department/section tree, managers, membership                                               | 1          | Implemented                             |
| 3   | Roles & authorization           | Permission catalog, roles, subset rules, scope resolution                                   | 2          | Implemented                             |
| 4   | Working calendar                | Working hours, seasons, holidays, working-day deadline calculation                          | 1          | Implemented                             |
| 5   | Legal configuration             | Services, priority levels, linear workflows, escalation settings                            | 3, 4       | Implemented                             |
| 5.5 | Service forms & file storage    | Per-service request forms, answer validation, file uploads, pending-file cleanup            | 5          | Implemented                             |
| 6   | Request lifecycle               | Submit → review → accept/reject → stages → info requests → closure, attachments             | 5.5        | Not started                             |
| 7   | Escalation & notifications      | Background deadline checks, R0-R2, in-app notifications                                     | 6          | Not started                             |

Audit is cross-cutting: built in Phase 0, used by every later phase.

Specs are written one phase at a time. A later phase's spec is drafted only after the phases it depends on are approved, since earlier decisions shape it.
