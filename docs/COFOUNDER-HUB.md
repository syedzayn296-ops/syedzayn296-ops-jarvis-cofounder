# Cofounder Project Hub

**Last updated:** 2026-10-15  
**Purpose:** One durable, phone-accessible home for Cofounder status, decisions, research pointers, safeguards, and next actions. This file is the first page to read when resuming work.

- **Repository:** https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder
- **Working branch for the current code line:** `development`
- **Current remote development head (verified 2026-10-15):** `c1fd292` — Ctrl+C speech interruption fix and clean shutdown message. GitHub Actions run #25 passed. Zayn's latest manual test confirms live Gemini response, speech output, and immediate speech stop on Ctrl+C.
- **Local working copy:** `C:\Users\ZAYZA\JARVIS-Cofounder-Clean`
- **Operating principle:** Discover first. Qualify second. Recommend third. Execute only after Zayn approves.  
**Active cleanup task:** [Issue #4 — Reconcile local patch and verify provider routing](https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder/issues/4).

## 1. Current state — read this first

### Confirmed
- The local working copy was previously based on remote commit `e445f0d`.
- Remote `development` now contains the provider-routing changes in commit `997e69a`; the branch is 9 commits ahead of `e445f0d` and not behind it.
- The latest GitHub Actions run for `development`, run #25 on commit `c1fd292`, completed successfully on 2026-10-15: [run #25](https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder/actions/runs/38665364762).
- A previous local syntax check and test suite passed **50/50 tests** on 2026-10-14; that historical local result is not proof that the current local checkout matches remote `development`.
- A patch backup was created at `Desktop\COFOUNDER-LOCAL-CHANGES.patch`; a separate audit report was created at `Desktop\COFOUNDER-AUDIT.txt`.
- Antigravity CLI exists at `%LOCALAPPDATA%\agy\bin\agy.exe`; its help output confirms support for `--sandbox`, `--output-format text`, and `--print`.
- OmniRoute's script exists at `%APPDATA%\npm\node_modules\omniroute\bin\omniroute.mjs`.
- A real Antigravity request returned HTTP 429 / `RESOURCE_EXHAUSTED`: individual quota exhausted. Do not keep retrying it or buy an upgrade just to unblock development.
- A prior test in the older `JARVIS\jarvis.js` app successfully returned `Gemini connection works` using the Gemini API and model override `gemini-3.5-flash-lite`. **That does not mean direct Gemini is already integrated into this clean repository.**
- `cofounder-settings.json` currently reports `speechEnabled: true`. Keep local settings and secrets out of Git.

### Not yet confirmed
- Whether the local PC checkout has pulled the latest remote `development` head `c1fd292`.
- Local private business-state quality/counts cannot be verified from GitHub; run the planned read-only local audit before trusting counts or freshness.
- Speech output and Ctrl+C interruption were manually verified by Zayn on 2026-10-15. Speech input is not implemented/verified in the inspected code.
- Whether local Ollama is installed, running, and has the configured model available.
- The local archive/backup files remain safety copies; never stage them wholesale.

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

The repository currently contains 51 smoke/regression test cases. GitHub Actions run #25 passed on `c1fd292`. Zayn's latest manual smoke test confirmed a live Gemini answer and immediate speech stop on Ctrl+C. Run the suite again after every code change; automated CI does not prove the local API key or private local data is correct.

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

## 9. Latest capability audit (2026-10-15)\n\nThe full source/test review is recorded in [Cofounder Capability Audit](COFOUNDER-CAPABILITY-AUDIT-2026-10-15.md). Key conclusion: keep the working AI/voice foundation and improve the business-state workflow rather than adding another provider or more architecture. A concrete routing gap was reproduced in source: requests starting `tell me about ` are intercepted by the single-project lookup, so “tell me about Zayzana latest projects and products” returns only the umbrella-company record.\n\n## 10. Next actions — in order

- [x] Preserve the local patch, audit files, and backup archive (already completed in the prior session; do not repeat).
- [x] Reconcile provider routing in remote `development`: commit `997e69a` uses direct Gemini by default and explicit local Ollama, with cancellation and timeout handling.
- [x] Confirm GitHub Actions run #22 passed on `997e69a`.
- [x] Confirm direct Gemini answer, Windows speech output, and immediate Ctrl+C speech stop in Zayn's manual test on 2026-10-15.\n- [ ] On the PC, verify the local checkout is on `development` and pull the latest changes safely without overwriting local work.\n- [ ] Implement a portfolio/list-all command and regression tests for multi-project questions.\n- [ ] Add a read-only local business-data audit (file presence, parse status, timestamps, record counts, missing fields; no secrets or writes).\n- [ ] Build a read-only daily briefing that ranks one next action using real follow-ups, prospects, goals and blockers.\n- [ ] Improve the AI context builder so it prioritises relevant records and reports missing/truncated context instead of blindly slicing JSON files.\n- [ ] Defer voice input and computer control until the above reliability gaps are fixed.
- [ ] Migrate historic research/decisions incrementally only when relevant to an active task.

**Completion rule:** a task is not “done” merely because it worked once on the PC. It is done when the result, evidence, and relevant code/documentation are safely recorded in the canonical GitHub repository and the intended remote branch is verified.
