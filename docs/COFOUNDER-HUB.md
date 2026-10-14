# Cofounder Project Hub

**Last updated:** 2026-10-14  
**Purpose:** One durable, phone-accessible home for Cofounder status, decisions, research pointers, safeguards, and next actions. This file is the first page to read when resuming work.

- **Repository:** https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder
- **Working branch for the current code line:** `development`
- **Code baseline before the hub documentation commits:** `e445f0d` — Strip Markdown formatting from spoken responses. Documentation-only commits have advanced remote `development` beyond that baseline (hub, README link, and subsequent hub corrections). The local source/test changes described below are still not synced.
- **Local working copy:** `C:\Users\ZAYZA\JARVIS-Cofounder-Clean`
- **Operating principle:** Discover first. Qualify second. Recommend third. Execute only after Zayn approves.  
**Active cleanup task:** [Issue #4 — Reconcile local patch and verify provider routing](https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder/issues/4).

## 1. Current state — read this first

### Confirmed
- The local working copy was based on remote commit `e445f0d`.
- Local `index.js` and `test/jarvis-smoke.test.js` contain unpublished changes.
- Local syntax check passed and the local suite passed **50/50 tests** on 2026-10-14.
- A patch backup was created at `Desktop\COFOUNDER-LOCAL-CHANGES.patch`; a separate audit report was created at `Desktop\COFOUNDER-AUDIT.txt`.
- Antigravity CLI exists at `%LOCALAPPDATA%\agy\bin\agy.exe`; its help output confirms support for `--sandbox`, `--output-format text`, and `--print`.
- OmniRoute's script exists at `%APPDATA%\npm\node_modules\omniroute\bin\omniroute.mjs`.
- A real Antigravity request returned HTTP 429 / `RESOURCE_EXHAUSTED`: individual quota exhausted. Do not keep retrying it or buy an upgrade just to unblock development.
- A prior test in the older `JARVIS\jarvis.js` app successfully returned `Gemini connection works` using the Gemini API and model override `gemini-3.5-flash-lite`. **That does not mean direct Gemini is already integrated into this clean repository.**
- `cofounder-settings.json` currently reports `speechEnabled: true`. Keep local settings and secrets out of Git.

### Not yet confirmed / not yet synced
- The current local changes have **not** been published to this repository as of this snapshot.
- The real Antigravity-to-Cofounder round trip has not succeeded because of the quota response.
- A working live OmniRoute fallback has not been verified.
- Direct Gemini API fallback still needs to be deliberately implemented and tested if chosen.
- The local worktree has backup files and other untracked files. Do not stage them wholesale.

## 2. AI provider situation and intended behaviour

Current local patch proposes:
1. Antigravity first when available.
2. On a quota-exhaustion response, stop and report it; do **not** waste requests on OmniRoute.
3. On other Antigravity failures, try OmniRoute as fallback.
4. Support local `stop` / `cancel` / `abort` while a request is running.
5. Preserve recent conversation context in the request.

Required next design decision: integrate the previously tested direct Gemini API as a genuine alternative provider, using a key stored only in the local environment (never committed). Define and test provider order, timeout, cancellation, quota detection, and clear error reporting. Do not claim a provider works until an actual live response proves it. Do not use a paid service or upgrade without Zayn's explicit approval.

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

The test suite has passed locally at 50/50 on 2026-10-14, but the **unpublished local patch** is not covered by the current remote commit until it is committed and pushed. Run the suite again after any provider-routing changes.

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

## 9. Next actions — in order

- [ ] Preserve the current local patch and audit files.
- [ ] Review the local `index.js` and test diff against remote `development`; do not overwrite either side blindly.
- [ ] Add a direct Gemini provider only with explicit timeout, cancellation, and quota/error handling; keep the API key local.
- [ ] Add regression tests for provider order, quota handling, ordinary fallback, cancellation, and no external action without approval.
- [ ] Run syntax checks and the full test suite.
- [ ] Commit only reviewed files; keep backups and `cofounder-settings.json` untracked.
- [ ] Push to the intended remote branch and verify GitHub Actions.
- [ ] Continue migrating historic research/decisions from chat and local notes into the tracker or linked project records.

**Completion rule:** a task is not “done” merely because it worked once on the PC. It is done when the result, evidence, and relevant code/documentation are safely recorded in the canonical GitHub repository and the intended remote branch is verified.
