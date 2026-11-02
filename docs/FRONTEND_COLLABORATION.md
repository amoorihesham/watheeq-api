# Working With the Frontend

How this repo takes requests, questions, and bug reports from the frontend, `amoorihesham/watheeq-frontend`, and how it tells the frontend about contract changes.
The shared protocol is `docs/COLLABORATION.md` in the frontend repo; this file is only this repo's side of it.
Our process and approval gates (`CLAUDE.md`) are unchanged: an issue is an input to them, never a way around them.

## 1. Channels

- **Issues** carry requests, questions, and notices, in both directions.
  A decision made anywhere else (a chat, a session) is written into its issue before either side acts on it.
- **The OpenAPI document** carries the shapes: `docs/api/openapi.json`, generated from the endpoint declarations (T60, T61) and served at `/openapi.json` outside production (T62).
  The frontend refuses a document whose `info.title` is not `Watheeq API`, so that title never changes.
- **`docs/api/*.md`** carries the rules no schema states, and is what an answer to a question points to.

Agents read the frontend repo only through its issues and its `docs/COLLABORATION.md`, never its code.

## 2. Issues we receive

| Label | Meaning | Template |
| ----- | ------- | -------- |
| `fe:request` | A change the frontend would use | `.github/ISSUE_TEMPLATE/frontend-request.md` |
| `fe:question` | How the API behaves | `.github/ISSUE_TEMPLATE/frontend-question.md` |
| `fe:bug` | The API answered in a way its contract does not allow, with a `curl` | `.github/ISSUE_TEMPLATE/frontend-bug.md` |

The templates are copies of the frontend's kit (`docs/collaboration/backend-kit/ISSUE_TEMPLATE/`), kept identical so both sides file and read the same sections.
Timing labels set by the frontend: `needed-by:F<N>` (the frontend feature that uses it) and `nice-to-have` (its interim behavior can stay for good).
The frontend never waits on an issue, so `needed-by` orders our work; it does not interrupt a phase in progress.

## 3. Triage

**When.** The owner runs the triage right after each frontend specs sitting, so a request is decided the day it is filed.
A `fe:bug` is also triaged at once when the owner asks.
The untriaged issues are the open `fe:*` issues with neither `accepted` nor `needs-info`, plus each `needs-info` issue the frontend has answered since:

```bash
gh issue list --label fe:request,fe:question,fe:bug --state open --search "-label:accepted -label:needs-info"
```

**Who.** The main session drafts a triage note for each issue; the owner decides each one.
Nothing is labelled, commented, or closed before the owner approves it, and approving a triage approves exactly the outward actions it lists.

**The triage note** for each issue holds:

1. **Feasible:** yes or no, checked against the current code and `openapi.json`, not memory.
2. **Estimate:** the implementation size, including tests.
3. **Conflicts:** with our conventions (`docs/api/`, `TECHNICAL_DECISIONS.md`, `MVP_SCOPE.md`) or with another open issue.
4. **Shape:** the shape we would build. The issue's proposed shape is a starting point; our conventions win.
5. **Recommendation:** accept; needs-info with the exact question; or reject with the reason.
6. **Outward actions:** the labels, comments (with their text), and closings to apply once approved.

**After the owner approves**, the main session applies them:

| Decision | On GitHub |
| -------- | --------- |
| Accept | Label `accepted`; comment with the shape we expect to build when it differs from the proposed one, and the phase it goes into |
| Needs info | Label `needs-info`; comment with the question |
| Reject | Comment with the reason; close as not planned |
| Question answered | Comment with the answer, linking the `docs/api/` rule; close as completed |

The shape in an `accepted` comment may still move during the spec review; only the "Final shape" comment (section 4) fixes it.

## 4. How accepted issues enter our planning

- **A request is built only through a phase spec.** The hard rule in `CLAUDE.md` applies: no code before the spec is `Approved`.
  Accepted requests are grouped into the next phase whose scope they fit, or into a phase of their own named after the frontend need (for example "Phase 11: operator console requests").
  `needed-by:F<N>` orders the phases; `nice-to-have` issues wait for a phase that touches the same area.
- **The spec names its issues.** Its header lists them in the `Frontend issues` row, each issue becomes one or more requirements whose ID cites it (`R11.3 (#4)`), and the `.API.md` Draft form shows the shape we chose.
- **When the owner approves the spec**, the main session posts on each of its issues a comment that starts with the words `Final shape`, holding the shape the spec will build (the issue's rows of the `.API.md` Draft form).
  The frontend's digest finds the comment by those words; the frontend plans against that shape and relies on it only once it is in the contract.
  If implementation changes a final shape (a proposal for owner approval, `CLAUDE.md` step 5), a new `Final shape` comment replaces it once the owner approves.
- **A `fe:bug` needs no new spec** when the fix makes the API match its existing contract: reproduce it end to end with the issue's `curl` first, fix it, and close the issue from the fix commit.
  If the right fix is to change the contract instead, it is a request, and it goes through a spec.
- **A `fe:question`** is answered from the code and `docs/api/`; if the answer is a rule `docs/api/` does not state, the rule is added there in the same change and the answer links it.

## 5. Contract changes

**What is a contract change.** A change that removes or changes an operation, parameter, or field a client may rely on, makes a request stricter, or adds a value to an enum in a response, other than the error and detail codes.
Examples: renaming `Tenant.ownerId`, making `?state=` required, a field becoming nullable, a new value of `SubscriptionView.state` such as `suspended`.
It needs a `be:contract-change` issue on the frontend repo before it reaches `dev`.

**What is a heads-up.** A new operation, a new optional field, or a new error or detail code, since a client handles an unknown code by its status (`docs/api/errors.md`).
The additions of a phase that the frontend could use go in one `be:heads-up` issue, filed at the phase's Done step.

**The check** (designed, not built yet; until it is, the review checks contract changes by hand). `pnpm contract:check` compares `docs/api/openapi.json` on `origin/dev` (the contract the frontend can sync against) with the working tree, using [oasdiff](https://github.com/oasdiff/oasdiff), run from its Docker image pinned by digest:

- `oasdiff breaking` lists the contract changes.
  The check counts a new value of `Error.error.code` or `ErrorDetail.code` as a heads-up, listed once instead of once per operation.
- The check fails when there is a contract change and no commit in `origin/dev..HEAD` carries a trailer naming the frontend issue that announces it:

  ```
  Contract-change: amoorihesham/watheeq-frontend#12
  ```

- `oasdiff changelog` lists the additions, printed as heads-up candidates; they never fail the check.
- It runs in the `pre-push` hook (`.githooks/pre-push`, enabled by `pnpm install`), so a contract change cannot reach `dev` before its issue exists, and in the review of every phase.

**What the check cannot see.** Behavior with no schema, such as a list's order or a rule in `docs/api/`, is invisible to a diff.
Each spec's section 4.2 states its contract impact, and the review checks it by hand.

**The flow.**

1. The spec lists its contract changes, the `be:contract-change` issue each one needs, and its heads-up additions; approving the spec approves filing them.
2. Each `be:contract-change` issue is filed from the frontend's template before the change is pushed, and its number goes in the commit trailer.
3. The `be:heads-up` issue is filed at the Done step.

## 6. Closing issues

This repo merges to `dev` without pull requests, so the commit that delivers a request closes it: GitHub closes an issue as completed when a commit that says `Closes #<n>` is pushed to `dev`, the default branch.
The frontend counts a request closed this way as `Landed`.

- **The Done commit** of a phase (the one that sets the spec to `Implemented`, after the owner approves the report) says `Closes #<n>` for each request it delivers, so an issue closes only when the owner has approved the work and it is on `dev`.
- **A bug fix commit** says `Closes #<n>`.
- **A question** is closed as completed by hand after its answer is posted.
- A request delivered only in part stays open, with a comment saying what landed.
