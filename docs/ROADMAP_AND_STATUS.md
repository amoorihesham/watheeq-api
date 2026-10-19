# Roadmap and Status

## Watheeq - Legal Affairs Management System

**Last updated:** 2026-10-19

### Current Status

- Product scope agreed (`MVP_SCOPE.md`).
- **Phase 0 (technical foundations) implemented** (`docs/specs/phase-0-foundations.md`). Its main decisions are T11-T22 in `TECHNICAL_DECISIONS.md`.
  Delivered: skeleton, validated config, standard errors, request IDs and logging, tenant isolation with forced RLS, append-only audit, operator and tenant authentication with sessions, CSRF, and login throttling.
- **Known open items:** the hosting provider must support PostgreSQL 18 and the `watheeq_auth` role (`TECHNICAL_DECISIONS.md`, deferred decisions).
  Phase 1 must decide how tenants are created, since the runtime role can only read `tenants`, and how platform-level (operator) actions are audited.
- **Phase 0.5 (layered architecture refactor) implemented** (`docs/specs/phase-0.5-refactor.md`): behavior-preserving restructuring into routes → controller → service → repository, central middleware, and shared test helpers.
  Its convention is T23 in `TECHNICAL_DECISIONS.md`.
- **Next action:** draft the Phase 1 spec (`docs/specs/phase-1-*.md`), when requested.

---

### Roadmap

Each phase moves through: `Not started → Spec Draft → Spec Approved → In Implementation → Implemented`.

| #   | Phase                           | Delivers                                                                          | Depends on | Status      |
| --- | ------------------------------- | --------------------------------------------------------------------------------- | ---------- | ----------- |
| 0   | Technical foundations           | Skeleton, cross-cutting basics, tenant isolation, audit, authentication           | -          | Implemented |
| 0.5 | Layered architecture refactor   | Routes → controller → service → repository, central middleware, shared test helpers | 0          | Implemented |
| 1   | Platform, plans & subscriptions | Tenants, plans, subscriptions, Active → Grace → Read-only, user-limit enforcement | 0.5        | Not started |
| 2   | Org structure & users           | Department/section tree, managers, membership                                     | 1          | Not started |
| 3   | Roles & authorization           | Permission catalog, roles, subset rules, scope resolution                         | 2          | Not started |
| 4   | Working calendar                | Working days, holidays, working-day deadline calculation                          | 1          | Not started |
| 5   | Legal configuration             | Services, priority levels, linear workflows, escalation settings                  | 3, 4       | Not started |
| 6   | Request lifecycle               | Submit → review → accept/reject → stages → info requests → closure                | 5          | Not started |
| 7   | Escalation & notifications      | Background deadline checks, R0-R2, in-app notifications                           | 6          | Not started |

Audit is cross-cutting: built in Phase 0, used by every later phase.

Specs are written one phase at a time. A later phase's spec is drafted only after the phases it depends on are approved, since earlier decisions shape it.
