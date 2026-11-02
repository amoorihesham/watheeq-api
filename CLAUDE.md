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
6. **Done:** after I approve the report and its proposals, fold them into the spec, set the status to `Implemented`, trim the phase's `.API.md` to its implemented form (`templates/SPEC_API_TEMPLATE.md`), promote decisions to the relevant decision logs, and update `ROADMAP_AND_STATUS.md`. The Done commit closes the phase's frontend issues (`Closes #<n>`), and the phase's `be:heads-up` issue, if any, is filed.

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
| `docs/TECHNICAL_DECISIONS.md` | Technology and architecture decisions T1-T63; deferred hardening                 |
| `docs/ROADMAP_AND_STATUS.md`  | Phase list, phase status, next action                                            |
| `docs/api/`                   | The HTTP contract for clients: the rules (`*.md`) and the generated endpoint shapes (`openapi.json`) |
| `docs/specs/phase-<N>-*/phase-<N>-*.md` | Detailed requirements, design, steps, and acceptance criteria for one phase |
| `docs/specs/phase-<N>-*/phase-<N>-*.API.md` | The endpoints one phase adds or changes (the spec's section 4.2) |
| `templates/SPEC_TEMPLATE.md`  | Structure every phase spec must follow                                           |
| `templates/SPEC_API_TEMPLATE.md` | Structure every phase's API file must follow |
| `docs/FRONTEND_COLLABORATION.md` | This repo's side of the frontend protocol: triage, planning, contract changes, closing issues |

Read `MVP_SCOPE.md` and `TECHNICAL_DECISIONS.md` before designing or implementing anything.

## Working with the frontend

The frontend, `amoorihesham/watheeq-frontend`, is built from this API's OpenAPI document and talks to this repo only through GitHub issues.
The shared protocol is `docs/COLLABORATION.md` in the frontend repo; our side of it is `docs/FRONTEND_COLLABORATION.md`.

- **Issues from the frontend** carry `fe:request`, `fe:question`, or `fe:bug`, filed from `.github/ISSUE_TEMPLATE/`. They are inputs to our process, never a way around it: a request is built only through an approved phase spec, and its proposed shape is a starting point that our conventions override.
- **Triage:** I run it right after each frontend specs sitting. You draft a note per untriaged issue (feasible, estimate, conflicts, the shape we would build, recommendation, and the outward actions to take); I decide each issue.
- **Final shape:** when I approve a spec that builds requests, post on each of its issues a comment that starts with the words `Final shape`, holding the shape the spec will build. The frontend plans against it.
- **Contract changes:** removing or changing an operation, parameter, or field a client may rely on, making a request stricter, or adding a value to a response's enum (other than error and detail codes) needs a `be:contract-change` issue on the frontend repo before it reaches `dev`, named in a `Contract-change: amoorihesham/watheeq-frontend#<n>` commit trailer that `pnpm contract:check` (oasdiff, in the `pre-push` hook) requires. New operations, optional fields, and error or detail codes go in the phase's `be:heads-up` issue. A spec states its contract impact, including behavior a diff cannot see, such as a list's order.
- **Closing:** the Done commit of the phase that delivers a request says `Closes #<n>`, which closes it as completed once pushed to `dev`; a bug fix commit closes its bug; a question is closed as completed after its answer is posted.
- **Outward actions** (labels, comments, closing, issues on the frontend repo) need my approval. Approving a triage or a spec approves exactly the outward actions it lists.
- Never read or change the frontend's code. With the active `gh` account (AOthman70), prefix commands that touch the frontend repo with `GH_TOKEN=$(gh auth token --user amoorihesham)`; never switch the active account.

## Stack (summary - see TECHNICAL_DECISIONS.md for rationale)

Node.js + TypeScript (strict), Express 5, PostgreSQL (tenant isolation by application-level `tenant_id` filtering), Drizzle ORM, JWT cookie authentication, zod, pino, Vitest with real PostgreSQL in Docker. All data must stay in Saudi Arabia.

MVP rule: keep designs as simple as the current requirements allow; stronger controls are added gradually as the product grows (see "Deferred hardening" in `TECHNICAL_DECISIONS.md`).
