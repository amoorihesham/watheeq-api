# Roadmap and Status

## Watheeq — Legal Affairs Management System

**Last updated:** 2026-10-17

### Current Status

- Product scope agreed (`MVP_SCOPE.md`).
- Technical decisions for Phase 0 approved (`TECHNICAL_DECISIONS.md`).
- **No specs written. No code written. No phase started.**
- **Next action:** draft the Phase 0 spec (`docs/specs/phase-0-foundations.md`), when requested.

---

### Roadmap

Each phase moves through: `Not started → Spec Draft → Spec Approved → In Implementation → Implemented`.

| #   | Phase                           | Delivers                                                                          | Depends on | Status      |
| --- | ------------------------------- | --------------------------------------------------------------------------------- | ---------- | ----------- |
| 0   | Technical foundations           | Skeleton, cross-cutting basics, tenant isolation, audit, authentication           | —          | Not started |
| 1   | Platform, plans & subscriptions | Tenants, plans, subscriptions, Active → Grace → Read-only, user-limit enforcement | 0          | Not started |
| 2   | Org structure & users           | Department/section tree, managers, membership                                     | 1          | Not started |
| 3   | Roles & authorization           | Permission catalog, roles, subset rules, scope resolution                         | 2          | Not started |
| 4   | Working calendar                | Working days, holidays, working-day deadline calculation                          | 1          | Not started |
| 5   | Legal configuration             | Services, priority levels, linear workflows, escalation settings                  | 3, 4       | Not started |
| 6   | Request lifecycle               | Submit → review → accept/reject → stages → info requests → closure                | 5          | Not started |
| 7   | Escalation & notifications      | Background deadline checks, R0–R2, in-app notifications                           | 6          | Not started |

Audit is cross-cutting: built in Phase 0, used by every later phase.

Specs are written one phase at a time. A later phase's spec is drafted only after the phases it depends on are approved, since earlier decisions shape it.

---

### Phase 0: Preliminary Step Outline

_Input for the Phase 0 spec. Once that spec exists, it becomes authoritative and this section is removed._

| Step                       | Delivers                                                                          | Acceptance criteria (preliminary)                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 Skeleton               | Strict TypeScript, Express 5, lint, Vitest, PostgreSQL via Docker Compose         | `GET /health` returns 200 and reports DB connectivity; `npm test` passes on a fresh clone                                             |
| 0.2 Cross-cutting basics   | Startup config validation, standard error format, request IDs, structured logging | App refuses to start with missing config; unknown route returns the standard error shape; logs carry the request ID                   |
| 0.3 Tenant isolation spike | Migrations, Drizzle, RLS pattern                                                  | With tenant A set, a query omitting `tenant_id` returns zero tenant-B rows; a query with no tenant set fails                          |
| 0.4 Audit mechanism        | Append-only audit table and helper                                                | A rolled-back change leaves no audit row; a committed change leaves exactly one                                                       |
| 0.5 Authentication         | Operator and tenant login, logout, cookie sessions, CSRF                          | Wrong password rejected; revoked/deactivated session rejected on next call; tenant session rejected on operator routes and vice versa |
