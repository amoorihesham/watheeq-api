# Technical Decisions

## Watheeq — Legal Affairs Management System

**Status:** Approved (2026-10-17). Not yet implemented.
**Scope of this doc:** Technology and architecture decisions. Product and scope decisions live in `MVP_SCOPE.md` (D1–D15).

---

### Constraints

- **Language / framework:** Node.js + TypeScript, Express.
- **Data residency:** all tenant data must remain in Saudi Arabia. This includes databases, backups, logs, and any third-party tooling (e.g. error tracking) that receives request data.
- **Primary client:** a browser web app. A mobile app is a distant future client.

---

### Decision Log

| #   | Decision                                                                                                                                                                  | Rationale                                                                                                                                                                                  | Alternatives considered                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| T1  | **PostgreSQL** as the database                                                                                                                                            | Relational data (org tree, roles, requests), strong transactions, Row-Level Security, managed offerings available in KSA                                                                   | MySQL (no RLS), MongoDB (poor fit for relational data and cross-document transactions)                    |
| T2  | **Tenant isolation: shared tables with `tenant_id` + PostgreSQL Row-Level Security**                                                                                      | Database refuses cross-tenant rows even if a query omits the tenant filter; single database to operate                                                                                     | Schema per tenant (N× migrations), database per tenant (heavy operations; possible future premium tier)   |
| T3  | **Drizzle ORM** for data access                                                                                                                                           | Typed queries, explicit transactions, raw SQL available for setting the tenant context per transaction                                                                                     | Kysely, Prisma (hides connection/transaction control, making the RLS pattern awkward)                     |
| T4  | **In-house authentication with server-side sessions** stored in PostgreSQL                                                                                                | Immediate revocation on deactivation, role change, or read-only subscription state                                                                                                         | JWT (cannot be revoked before expiry), external IdP / Keycloak (extra infrastructure, residency concerns) |
| T5  | **Session transport: httpOnly, Secure cookie, with CSRF protection**                                                                                                      | Browser client; cookie not readable by scripts. Mobile can later use the same sessions via a header token                                                                                  | Bearer tokens in browser storage (exposed to script injection)                                            |
| T6  | **Separate identity realms: `operators` table and tenant `users` table**, with separate login endpoints (`/operator/auth/login`, `/auth/login`) and shared auth internals | No tenant endpoint can ever grant operator access; keeps RLS policies clean; allows stricter operator policies                                                                             | Single users table with `is_operator` flag (one field separates one-tenant from all-tenant access)        |
| T7  | **Tenant user email is unique across the platform**; login resolves the tenant from the email                                                                             | Matches the one-user-one-tenant model; no extra infrastructure                                                                                                                             | Subdomain per tenant (possible later, without data migration), tenant code at login                       |
| T8  | **Audit entries written in the same transaction** as the business change; audit table is append-only                                                                      | Audit can never disagree with the actual data                                                                                                                                              | Log files, asynchronous audit writes                                                                      |
| T9  | **Modular monolith** organized by feature modules                                                                                                                         | One deployable; clear module boundaries without network and operational overhead                                                                                                           | Microservices                                                                                             |
| T10 | **Express 5, zod, pino, Vitest; integration tests against real PostgreSQL in Docker; Docker packaging**                                                                   | Async error handling; input validation at the trust boundary; structured logs with request IDs; RLS and transactions require real-database tests; portability across KSA hosting providers | Jest; mocked databases                                                                                    |

---

### Deferred Technical Decisions

- **Background job runner** — decided in Phase 7 (escalation checks).
- **Hosting provider in KSA** — decided at deployment; Docker keeps options open.
- **Enterprise SSO, MFA for operators** — after the MVP.

---

### Items to Verify (Spikes)

- **Step 0.3:** prove the Drizzle + RLS pattern — tenant context set per transaction; a query that deliberately omits `tenant_id` returns no rows from another tenant; a query with no tenant context set fails.
