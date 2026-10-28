# Cofounder Project Hub

**Status reviewed:** 2026-10-28 23:43 +02:00  
**Purpose:** Provide one reliable starting point for understanding Cofounder’s current state, evidence, outstanding work, safeguards and next authorised action.

**Repository:** [syedzayn296-ops/syedzayn296-ops-jarvis-cofounder](https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder)

**Working branch:** `cofounder-development-sync`  
**Observed HEAD at review time:** `eb338f1e88f61cdf533d0f3dbc378f76aa6dcc02`  
**Local working copy:** `C:\Users\ZAYZA\Cofounder-Release-Candidate` — its current state is not established by remote GitHub evidence alone.  
**Operating principle:** Discover first. Qualify second. Recommend third. Execute only after Zayn approves.  
**Active cleanup task:** [Issue #4 — Reconcile local patch and verify provider routing](https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder/issues/4).

## 1. Current state — read this first

### Verified remote repository state

The following branch heads were observed on GitHub during the 28 October 2026 status review. They are remote references, not proof of the current local PC checkout.

| Branch | Observed HEAD |
|---|---|
| `main` | `fc20bffeec33efcc81910a01896b939c74cf44af` |
| `development` | `008ee78b9f8cf5e9cd1baf34ee19677b54220136` |
| `cofounder-development-sync` | `eb338f1e88f61cdf533d0f3dbc378f76aa6dcc02` |
| `ci-run-state-tests` | `a9c73031715a14022bef59c08e005cb490c8a157` |

### Release-gate progress

**P1 — G6 and G9: COMPLETE, based on the evidence recorded below.** This does not establish full release readiness.

- **G6 — push-trigger verification:** [GitHub Actions run 40767397839](https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder/actions/runs/40767397839) passed on `ci-run-state-tests` at `a9c73031715a14022bef59c08e005cb490c8a157` (235/235 tests).
- **G9 — dated verification snapshot:** [Commit `eb338f1`](https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder/commit/eb338f1e88f61cdf533d0f3dbc378f76aa6dcc02) records the G9 documentation update on `cofounder-development-sync`.
- **G9 workflow verification:** [GitHub Actions run 40770933991](https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder/actions/runs/40770933991) passed the configured smoke/regression checks on `eb338f1` (162/162 tests).

A dated G9 snapshot is historical evidence of what was observed at that time. A later commit advancing the branch does not invalidate the dated snapshot.

### Current CI evidence

| Branch / run | Result | Coverage |
|---|---|---|
| `development`, [run 40758839155](https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder/actions/runs/40758839155), SHA `008ee78` | 236 passed, 0 failed | Smoke/regression plus three state-store/durability suites |
| `cofounder-development-sync`, [run 40770933991](https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder/actions/runs/40770933991), SHA `eb338f1` | 162 passed, 0 failed | Smoke/regression suite only |

The workflows do not run identical test sets. Their results must not be represented as equivalent coverage. The `ci-run-state-tests` push-trigger verification is branch-specific; it does not by itself establish that the same trigger configuration exists on `cofounder-development-sync`.

### Known resolved CI failure

Three earlier `development` runs failed this test:

`state-file mutation hygiene: adding a prospect refuses malformed business.json and preserves the original bytes`

The failure concerned a success-style message being emitted when malformed business state should have prevented a safe mutation. Commit `008ee78` introduced fail-closed behaviour, and the later development run passed the test.

This is evidence that the previously failing test now passes. It is not proof that every possible mutation path has been exhaustively verified.

### Review boundaries that remain in force

- [PR #15 — Reconcile Cofounder release candidate and development into main](https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder/pull/15) must remain **open, draft and unmerged**.
- [Issue #4 — Reconcile local patch and verify provider routing](https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder/issues/4) remains open pending a separately evidenced resolution.
- Preserve the legacy `jarvis.js` prototype on `main` until its intended future is explicitly decided.
- Remote GitHub evidence does not establish the current state of the local PC checkout, local backups, private business data or configured credentials.
- P1 completion does not establish full release readiness. Other gates and release decisions remain separate.

### Outstanding and unverified items

- Reconcile older status notes as historical where appropriate; do not silently erase durable operating rules or safeguards.
- **Unverified:** local branch/HEAD, uncommitted changes and backup status; live local provider routing with configured credentials; private local business-data integrity/freshness; and the final disposition of `jarvis.js`.
- **Unverified:** whether all release gates beyond P1 have been satisfied.

### Next authorised action

Reconcile this hub’s current-state documentation with verified remote evidence while preserving the existing sections 2–10. This pass is documentation-only: no code, test, workflow, configuration or protected-data changes; no merge, branch deletion, PR #15 change, Issue #4 closure, or release-gate change.

### Evidence and change discipline

Classify each status claim as:

- **Verified:** directly supported by the evidence cited.
- **Historical:** supported by evidence from an earlier observation.
- **Unverified:** not yet established.
- **Decision required:** awaiting Zayn’s explicit direction.

A successful test is evidence for the test and code path it actually exercised. It is not automatic approval of a release, merge, deployment or unrelated functionality.

End each work session by recording the current verified state, outstanding questions, evidence gathered and next authorised action.

## 2. AI provider situation and intended behaviour

Current remote implementation (`997e69a`):
1. Direct Gemini API is the default provider (`GEMINI_API_KEY`; default model configured in code).
2. Ollama is selected explicitly with `COFOUNDER_PROVIDER=ollama`; there is no automatic provider cascade.
3. Requests use an abort signal and a configurable timeout (`COFOUNDER_AI_TIMEOUT_MS`, default 45 seconds).
4. Local `stop` / `cancel` / `abort` can cancel an active request.
5. Recent conversation turns are included in the prompt.
6. API keys remain local environment variables and must never be committed.

GitHub Actions passed on the provider-routing commit. This verifies automated checks, not live credentials or the actual local microphone/speaker experience. The next product test is one real local Gemini exchange and speech output; do not spend money or upgrade a provider without Zayn's explicit approval.

## 3. Product purpose and operating rules

Cofounder is Zayzana Tech's AI operating partner, not a yes-man and not an autonomous agent that acts without consent. It should:
- retain business context, decisions, evidence, lessons, and next actions;
- challenge assumptions and distinguish evidence from guesses;
- prioritize revenue, owned assets, distribution, repeatable systems, and automation;
- help discover and qualify commercial prospects before proposing a solution;
- never invent research findings, contact details, customer confirmation, or test results;
- never contact people, spend money, publish externally, or execute other consequential external actions without Zayn's approval.

## 4. Safeguards that must not regress

- **Prospect qualification:** discovery being complete is not the same as a buyer confirming qualification. Explicit confirmation and its provenance must be recorded.
- **Stale qualification:** if core discovery fields change, prior qualification must be invalidated.
- **Research commands:** the direct research command requires an explicit `research:` delimiter. `research: <query>` runs a direct live search; `research: for <Prospect>: <query>` associates that search with one named open prospect; `research-latest` shows the last saved search; a bare `research` asks for a query. Ordinary messages go to the AI — a natural-language message that merely begins with the word "Research" is never treated as the command, so it cannot trigger an unintended live search or research record.
- **Research association:** never attach general research automatically to the first open prospect. Use explicit prospect association when needed; reject unmatched or ambiguous names.
- **Prospect selection:** if several prospects are open, ask for an exact selection rather than guessing. Do not rely on stale selected-prospect state.
- **Recommendations:** incomplete discovery means no final solution recommendation; state the gap and ask the next useful question.
- **Execution:** recommendation is not approval. External actions require explicit founder approval.
- **Provider failure:** quota exhaustion must not trigger pointless retries or an automatic cascade of providers known to share the same quota.

## 5. Code and test map

| Location | Purpose |
|---|---|
| `index.js` | Main Node.js Cofounder CLI, business logic, provider calls, command handling |
| `test/jarvis-smoke.test.js` | Regression and isolated integration tests |
| `commercial/ZAYZANA-COMMERCIAL-TRACKER.md` | Current commercial pipeline and discovery plan |
| `.github/workflows/cofounder-tests.yml` | GitHub Actions syntax and regression checks |
| `README.md` | Public repository overview |

Run locally from the repository root:
```powershell
node --check .\index.js
node --test --test-reporter=spec .\test\jarvis-smoke.test.js
git diff --check
git status --short
```

The repository currently contains 104 smoke/regression test cases. GitHub Actions run #25 passed on `c1fd292`. Zayn's latest manual smoke test confirmed a live Gemini answer and immediate speech stop on Ctrl+C. Run the suite again after every code change; automated CI does not prove the local API key or private local data is correct.

## 6. Commercial research and pipeline

The maintained pipeline currently lives in [Zayzana Commercial Tracker](../commercial/ZAYZANA-COMMERCIAL-TRACKER.md).

Current recorded lead:
- **Hypercheck / Checkstar** — Raffi Abdoola, Managing Director / escalation target.
- Initial outreach recorded as sent 2026-10-08.
- Follow-up was scheduled for 2026-10-12; the tracker proposed another specific follow-up on 2026-10-15 and a direct Durban approach during 2026-10-18 to 2026-10-22 if needed.
- The contact address was noted as coming from an older source; verify it if there is no response.
- Objective: discover a concrete operational problem suitable for a small measurable pilot. Do not pitch a generic Sixty60 clone, generic AI product, or giant ERP before discovery.

Discovery must capture:
1. Problem
2. Impact
3. Current solution
4. Desired outcome
5. Decision maker

Commercial path: **Research → Contact → Discovery → Qualification → Pilot → Measured Result → Paid Rollout.**

Other research/history known from the development process:
- Guardsman Plumbers London research exposed a risk of associating general research with the wrong prospect; the explicit-association safeguards were added for this reason.
- Earlier commercial work considered overseas service opportunities and local retail/operations opportunities. These are research directions, not proof of qualified demand. Revalidate facts and contact details before outreach.
- Research notes that remain only in chat history, local folders, or other trackers must be migrated here or linked from this hub before we can honestly call the archive complete. Never imply every historic note is already consolidated.

## 7. Git branches and release discipline

Repository default branch is `main`; active development line is `development`. These are not interchangeable.

Previously observed branch tips (historical snapshot; refresh before any merge or push):
- `main` — `fc20bff`
- `development` — `e445f0d`
- `cofounder-verified` — `e127bda`
- `cofounder-readiness-cleanup` — `4323f14`
- `qualification-confirmation-gate` — `14f73ca`

Merged safeguards:
- PR #1 — research association hardening and Windows test workflow.
- PR #2 — recommendations for unqualified prospects.
- PR #3 — explicit buyer confirmation before prospect qualification.

Do not merge an old local `development` branch or push from an uncertain branch. Before syncing, preserve the local patch and backups, compare the intended branch with remote `development`, stage only explicitly reviewed source/test/docs files, run tests, then push or use a PR. Never commit backup files, API keys, or personal settings.

## 8. Single source-of-truth workflow going forward

Every meaningful work session must update this repository, not just the PC or chat:

1. **Start here:** read this hub before touching code.
2. **Record the work:** update this status page and/or the commercial tracker as decisions and findings are made.
3. **Keep evidence:** record the command/test result, date, and whether it is confirmed or still a hypothesis.
4. **Keep code reviewable:** small, purposeful commits on the intended branch; no unexplained backup copies in commits.
5. **End every session:** update “Current state,” “Next actions,” and any changed decision or research record.
6. **Resume anywhere:** use this GitHub repository from a browser on the PC or phone. Chat history is useful context, but not the only archive.

## 9. Latest capability audit (2026-10-15)\n\nThe full source/test review and follow-up implementation notes are recorded in [Cofounder Capability Audit](COFOUNDER-CAPABILITY-AUDIT-2026-10-15.md). Key conclusion: keep the working AI/voice foundation and improve the business-state workflow rather than adding another provider or more architecture. A concrete routing gap was reproduced in source: requests starting `tell me about ` are intercepted by the single-project lookup, so “tell me about Zayzana latest projects and products” returns only the umbrella-company record.\n\n## 10. Next actions — in order

- [x] Preserve the local patch, audit files, and backup archive (already completed in the prior session; do not repeat).
- [x] Reconcile provider routing in remote `development`: commit `997e69a` uses direct Gemini by default and explicit local Ollama, with cancellation and timeout handling.
- [x] Confirm GitHub Actions run #22 passed on `997e69a`.
- [x] Confirm direct Gemini answer, Windows speech output, and immediate Ctrl+C speech stop in Zayn's manual test on 2026-10-15.\n- [ ] On the PC, verify the local checkout is on `development` and pull the latest changes safely without overwriting local work.\n- [x] Implement a portfolio/list-all command and add regression tests for multi-project questions (commits `f23d827`, `f0091dd`, `98ad5fd`; CI run #30 pending at the time of update).\n- [x] Implement a read-only local business-data audit command (`audit`) and regression test (commits `c3c4767`, `d99f2e6`; CI run #34 pending at the time of update). Run it locally before interpreting real business data.\n- [ ] Build a read-only daily briefing that ranks one next action using real follow-ups, prospects, goals and blockers.\n- [ ] Improve the AI context builder so it prioritises relevant records and reports missing/truncated context instead of blindly slicing JSON files.\n- [ ] Defer voice input and computer control until the above reliability gaps are fixed.
- [ ] Migrate historic research/decisions incrementally only when relevant to an active task.

**Completion rule:** a task is not “done” merely because it worked once on the PC. It is done when the result, evidence, and relevant code/documentation are safely recorded in the canonical GitHub repository and the intended remote branch is verified.
