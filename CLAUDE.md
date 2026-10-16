# Watheeq — Legal Affairs Management System (Backend)

Multi-tenant backend for managing internal legal departments, legal services, and the legal request lifecycle.

## How we work: spec first, then code

**Hard rule: no implementation code is written for a phase until that phase's spec exists in `docs/specs/` and I have marked it `Approved`.** You may draft and revise specs, but you never set a spec's status to `Approved` yourself.

Each phase follows this lifecycle:

1. **Draft:** when I ask, create `docs/specs/phase-<N>-<name>.md` from `docs/specs/_TEMPLATE.md`. Status: `Draft`.
2. **Review:** we discuss it. Resolve open questions, record decisions in the spec, and revise it. Status stays `Draft` (or `In Review`).
3. **Approved:** I change the status to `Approved`. Only now may implementation start.
4. **Implement:** one step at a time, in the order the spec defines. Stop after each step, show the verification results against that step's acceptance criteria, and wait for my go-ahead before the next step.
5. **Change during implementation:** if implementation shows the spec is wrong or incomplete, stop, propose the spec change, and continue only after I approve it. Do not silently deviate from the spec.
6. **Done:** when all steps pass, set the status to `Implemented`, promote decisions to the relevant decision logs, and update `ROADMAP_AND_STATUS.md`.

Follow the engineering principles below on every task. In particular:

- **Approval gates.** Do not start a phase, a spec, or a step without my explicit go-ahead.
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
| `docs/MVP_SCOPE.md`           | What the first release must do; product decisions D1–D15; open product questions |
| `docs/TECHNICAL_DECISIONS.md` | Technology and architecture decisions T1–T10                                     |
| `docs/ROADMAP_AND_STATUS.md`  | Phase list, phase status, next action                                            |
| `docs/specs/phase-<N>-*.md`   | Detailed requirements, design, steps, and acceptance criteria for one phase      |
| `docs/specs/_TEMPLATE.md`     | Structure every phase spec must follow                                           |

Read `MVP_SCOPE.md` and `TECHNICAL_DECISIONS.md` before designing or implementing anything.

## Stack (summary — see TECHNICAL_DECISIONS.md for rationale)

Node.js + TypeScript (strict), Express 5, PostgreSQL with Row-Level Security, Drizzle ORM, zod, pino, Vitest with real PostgreSQL in Docker. All data must stay in Saudi Arabia.
