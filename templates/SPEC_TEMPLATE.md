# Phase <N> Spec: <Phase Name>

| Field                  | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| **Status**             | Draft · In Review · Approved · In Implementation · Implemented |
| **Approved by / date** | _(set by the project owner only)_                              |
| **Depends on**         | Phase specs this one builds on                                 |
| **Related decisions**  | e.g. MVP D1, D2; Technical T2, T6                              |

---

## 1. Objective

One or two sentences: what this phase makes possible, and why it is needed now.

## 2. Scope

**In scope:**

- …

**Out of scope (and where it is handled instead):**

- …

## 3. Requirements

Expected behavior, written so each item can be verified. Use actors and examples from this project.

| ID     | Requirement | Example                                                    |
| ------ | ----------- | ---------------------------------------------------------- |
| R<N>.1 | …           | _Sara (Tenant Admin, Al-Noor) creates …, and the system …_ |

## 4. Design

Only what this phase needs. Explain why each part exists.

### 4.1 Data model

Tables and columns, constraints, indexes, row-level security policies.

### 4.2 API

| Method | Path | Realm | Permission | Request | Responses |
| ------ | ---- | ----- | ---------- | ------- | --------- |

### 4.3 Key flows and state transitions

Step-by-step flows, or a state diagram where there are states.

### 4.4 Module structure

Which modules and files are added or changed.

## 5. Edge Cases and Failure Behavior

| Scenario                                                     | Expected behavior                                    |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| Concrete sequence of events (e.g. two concurrent operations) | What the system does, and which safeguard ensures it |

## 6. Security and Authorization

Trust boundaries, input validation, tenant isolation, permission checks, and what is audited.

## 7. Implementation Steps

Each step is small, reviewable, and independently verifiable. Implementation stops after each step for review.

| Step  | Objective | Delivers | Acceptance criteria | Verification                    |
| ----- | --------- | -------- | ------------------- | ------------------------------- |
| <N>.1 | …         | …        | Observable outcomes | Tests or checks that prove them |

## 8. Test Plan

Unit, integration (real PostgreSQL), and manual checks, mapped to requirement IDs.

## 9. Open Questions

| #   | Question | Options | Resolution |
| --- | -------- | ------- | ---------- |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #   | Decision | Rationale |
| --- | -------- | --------- |

Promote these to `MVP_SCOPE.md` or `TECHNICAL_DECISIONS.md` when the phase is implemented.

## 11. Change Log

| Date | Change | Reason |
| ---- | ------ | ------ |
