# Roadmap and Status

## Watheeq - Legal Affairs Management System

**Last updated:** 2026-10-21

### Current Status

- Product scope agreed (`MVP_SCOPE.md`).
- **MVP simplification (2026-10-21):** the codebase was simplified to fit the MVP stage, and the docs were rewritten to match.
  Tenant isolation is now application-level `tenant_id` filtering (no RLS), there is one `users` table with a `role` (`user` or `operator`), membership goes through `tenant_members`, and authentication uses JWT access and refresh cookies.
  Login throttling, CSRF tokens, RLS, and database-enforced append-only audit are deferred (`TECHNICAL_DECISIONS.md`, "Deferred hardening").
- **Phase 0 (technical foundations) implemented** (`docs/specs/phase-0-foundations.md`): skeleton, cross-cutting basics, database baseline, audit, and JWT authentication with rotating, database-checked refresh tokens.
  `modules/auth/` is the reference example of the per-module file rules (Phase 0.5 spec), which every later module follows.
  A post-implementation refactor added `users.user_name`, the final access-token payload (`tenant: {id, roleId, roleName, permissions}`), module-owned composition in each routes file, and `<Name>Type` naming. The baseline migration was regenerated, so a local database migrated earlier must be recreated (`docker compose down -v`).
- **Phase 1 (platform, plans & subscriptions):** spec approved 2026-10-21; implementation in progress, one step at a time.
- **Next action:** owner review of Phase 1 step 1.4 (subscription changes) and decision P1.24 (ICU name ordering), then step 1.5 (user-limit enforcement).

---

### Roadmap

Each phase moves through: `Not started → Spec Draft → Spec Approved → In Implementation → Implemented`.

| #   | Phase                           | Delivers                                                                                    | Depends on | Status                                  |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------- | ---------- | --------------------------------------- |
| 0   | Technical foundations           | Skeleton, cross-cutting basics, tenant data model, audit, JWT authentication                | -          | Implemented |
| 0.5 | Layered architecture            | Routes → controller → service → repository convention, central middleware, test helpers   | 0          | Implemented                             |
| 1   | Platform, plans & subscriptions | Tenants, plans, subscriptions, Active → Grace → Read-only, user limit, email verification | 0, 0.5     | In Implementation                              |
| 2   | Org structure & users           | Department/section tree, managers, membership                                               | 1          | Not started                             |
| 3   | Roles & authorization           | Permission catalog, roles, subset rules, scope resolution                                   | 2          | Not started                             |
| 4   | Working calendar                | Working days, holidays, working-day deadline calculation                                    | 1          | Not started                             |
| 5   | Legal configuration             | Services, priority levels, linear workflows, escalation settings                            | 3, 4       | Not started                             |
| 6   | Request lifecycle               | Submit → review → accept/reject → stages → info requests → closure                          | 5          | Not started                             |
| 7   | Escalation & notifications      | Background deadline checks, R0-R2, in-app notifications                                     | 6          | Not started                             |

Audit is cross-cutting: built in Phase 0, used by every later phase.

Specs are written one phase at a time. A later phase's spec is drafted only after the phases it depends on are approved, since earlier decisions shape it.
