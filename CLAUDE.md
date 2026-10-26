# Watheeq - Legal Affairs Management System (Backend)

Multi-tenant backend for managing internal legal departments, legal services, and the legal request lifecycle.

## How we work: spec first, then code

**Hard rule: no implementation code is written for a phase until that phase's spec exists in `docs/specs/` and I have marked it `Approved`.** You may draft and revise specs, but you never set a spec's status to `Approved` yourself.

Each phase follows this lifecycle:

1. **Draft:** when I ask, create the folder `docs/specs/phase-<N>-<name>/` with `phase-<N>-<name>.md` from `templates/SPEC_TEMPLATE.md` and its endpoints in `phase-<N>-<name>.API.md` from `templates/SPEC_API_TEMPLATE.md`. Status: `Draft`.
2. **Review:** we discuss it. Resolve open questions, record decisions in the spec, and revise it. Status stays `Draft` (or `In Review`).
3. **Approved:** I change the status to `Approved`. Only now may implementation start.
4. **Implement:** the whole spec is implemented by two sub-agents, each in its own git worktree, with the spec's steps split between them along their dependencies and built in the order the spec defines. There is no review gate between steps. After the whole spec is implemented, you review everything once (every step's acceptance criteria, the full test suite, mutation checks for locks and races, and an end-to-end check against a running server) and report to me with the verification results per step.
5. **Change during implementation:** if implementation shows the spec is wrong or incomplete, do not silently deviate. Make the smallest reasonable choice and list it as "proposed for owner approval" in the final report; if the gap blocks a correct implementation, stop and ask me before continuing.
6. **Done:** after I approve the report and its proposals, fold them into the spec, set the status to `Implemented`, promote decisions to the relevant decision logs, and update `ROADMAP_AND_STATUS.md`.

Follow the engineering principles below on every task. In particular:

- **Approval gates.** Do not start a phase, a spec, or an implementation without my explicit go-ahead.
- **Requirements → design → implementation**, in that order.
- **Explain with concrete examples** from this project (requests, owners, tenants, roles), not abstract definitions.
- **A step is done only when its acceptance criteria are verified**, not when code is written.
- **Keep the docs in `docs/` consistent with reality.** Update them when a decision changes or a step completes.

## Current status

@docs/ROADMAP_AND_STATUS.md

## Project documents

Each document is authoritative for its own topic. Do not duplicate content between them.

| Document                      | Authoritative for                                                                |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `docs/PRODUCT_VISION.md`      | Long-term product direction                                                      |
| `docs/MVP_SCOPE.md`           | What the first release must do; product decisions D1-D46; open product questions |
| `docs/TECHNICAL_DECISIONS.md` | Technology and architecture decisions T1-T51; deferred hardening                 |
| `docs/ROADMAP_AND_STATUS.md`  | Phase list, phase status, next action                                            |
| `docs/specs/phase-<N>-*/phase-<N>-*.md` | Detailed requirements, design, steps, and acceptance criteria for one phase |
| `docs/specs/phase-<N>-*/phase-<N>-*.API.md` | The endpoints one phase adds or changes (the spec's section 4.2) |
| `templates/SPEC_TEMPLATE.md`  | Structure every phase spec must follow                                           |
| `templates/SPEC_API_TEMPLATE.md` | Structure every phase's API file must follow |

Read `MVP_SCOPE.md` and `TECHNICAL_DECISIONS.md` before designing or implementing anything.

## Stack (summary - see TECHNICAL_DECISIONS.md for rationale)

Node.js + TypeScript (strict), Express 5, PostgreSQL (tenant isolation by application-level `tenant_id` filtering), Drizzle ORM, JWT cookie authentication, zod, pino, Vitest with real PostgreSQL in Docker. All data must stay in Saudi Arabia.

MVP rule: keep designs as simple as the current requirements allow; stronger controls are added gradually as the product grows (see "Deferred hardening" in `TECHNICAL_DECISIONS.md`).
