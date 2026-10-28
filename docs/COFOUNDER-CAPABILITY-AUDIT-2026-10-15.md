# Cofounder Capability Audit — 2026-10-15

## Purpose

A source-code and test audit of the current `development` branch, plus the founder's latest manual voice test. This is not an audit of the private local business data: `business.json`, `cofounder-state.json`, and `memory.json` are not tracked in the repository and must be checked locally.

## Snapshot

- Branch: `development`
- Audited commit: `c1fd292e6688c7c0d2264a4873389a3f44c1211f`
- Main application: `index.js` (4,616 lines at audit time)
- Regression test file: `test/jarvis-smoke.test.js` (51 test cases)
- CI: GitHub Actions run #25 succeeded for the audited commit.
- Founder manual test: Gemini returned a contextual business answer and Windows speech played it. Zayn reports that Ctrl+C stopped the speech immediately and the app ended cleanly. This is a successful manual check, not an automated regression test.

## What works today

1. **AI conversation:** Direct Gemini API is the default; Ollama can be selected explicitly. The app has a 45-second default request timeout, abort/cancel support, and keeps up to six conversation turns in memory for the current session.
2. **Local business context:** Before AI requests, the app attempts to read `business.json`, `cofounder-state.json`, and `memory.json`. It also injects a small fixed Zayzana context and operating rules.
3. **Structured business records:** Commands exist for prospects, opportunities, offers, follow-ups, revenue, goals, decisions, approvals, execution records, and lessons.
4. **Commercial guardrails:** The source and regression tests include discovery completeness checks, explicit buyer-confirmation gates, prospect-selection safeguards, research-association protections, and founder approval before external execution.
5. **Research path:** A web research helper calls Exa through `mcporter`; results are marked unverified and the code warns that research is evidence for review, not confirmed prospect fact.
6. **Speech output and interruption:** Windows speech is implemented through a child PowerShell process. The Ctrl+C handler now kills that process tree, clears queued commands, cancels an active AI request, and closes the session. Zayn's latest manual test confirms the speech stopped immediately.
7. **Automated checks:** The repository workflow checks JavaScript syntax and runs the 51-case smoke/regression suite. The latest run on the audited commit succeeded.

## Highest-value gaps found

### P1 — Natural-language project/portfolio questions are intercepted by a narrow command

In `handleCommand`, any message beginning `tell me about ` is handled by the deterministic project lookup before the AI fallback. `detectProject` returns only one matching project, and `showProject` prints one record. Therefore, a request such as “tell me about Zayzana latest projects and products” can return only the umbrella-company record rather than a portfolio summary. This matches Zayn's observed output.

**Fix:** add a deliberate portfolio/list-all route (including “projects”, “products”, “portfolio”, and “what are we building”) that lists all known projects with their current status and links. Add regression tests for both “tell me about Zayzana” and a multi-project portfolio request. Do not rely on the AI to reconstruct inventory that is already in code.

### P1 — The AI context is a raw, truncated file dump rather than a clear business briefing

`getCofounderContext()` reads up to the first 6,000 characters of each of three local JSON files and truncates the assembled context to 18,000 characters. This can cut off later records and gives the model raw records rather than a concise, status-aware view. Missing files are silently omitted. The app does not tell the user which files were read, how much was omitted, or whether records are stale.

**Fix:** create a deterministic context builder that summarizes counts and the most relevant records (open follow-ups, active goals, prospects, opportunities, decisions and lessons), labels unknown/missing data, and reports truncation. Keep raw local records and secrets out of Git.

### P1 — No dependable daily operating brief yet

There are separate commands for recommendations, business overview, follow-ups and priorities, but no verified one-command daily briefing that combines overdue follow-ups, active goals, current blockers, pipeline state and one ranked next action. The current recommendation command also selects the first open follow-up rather than scoring all work by urgency, value and evidence.

**Fix:** build a read-only `briefing` command first. It should report source counts, overdue/upcoming follow-ups when dates exist, open opportunities, prospects needing discovery, missing data, and one explainable next action. It must not send messages or mutate records.

### P2 — Memory is partly session-only

Recent AI conversation history is kept in process memory and limited to six turns; it disappears when the program exits. Structured decisions and lessons have persistence, but there is no automatic durable transcript or explicit “what changed since last session” summary.

**Fix:** do not save every conversation indiscriminately. Add an explicit founder-approved “record decision / record lesson / record commitment” flow and use the structured state as durable memory.

### P2 — Research verification is basic

Research entries are marked `UNVERIFIED`, which is good, but classification is based on token overlap in titles/URLs and is only a heuristic. It does not independently prove a source is authoritative, current, or actually supports each claim.

**Fix:** retain source URLs and retrieval dates, show claim/source pairs, and require human review before treating a finding as a verified business fact.

### P2 — Voice input and safe computer operation are not present as verified capabilities

The inspected source confirms speech output, not microphone input. No general computer-control capability was verified in this audit. Do not describe these as implemented.

**Fix:** defer voice input and computer control until context quality and the read-only daily briefing are reliable. Any consequential operation must remain behind explicit approval.

### P2 — Private live data cannot be verified from the repository

The three context files read by the AI are absent from the public repository, as expected for local state. Therefore this audit cannot validate the actual current counts, stale items, or content in Zayn's local business records. Do not commit these files just to make them inspectable.

**Fix:** add a local, read-only `audit`/diagnostic command that reports file presence, parse status, timestamps, counts, and missing required fields without printing secrets or overwriting data.

## Recommended build order

1. **Portfolio command + regression tests** — small, concrete fix for the observed project-answer failure.
2. **Read-only business data audit command** — verify the actual local state without exposing or changing it.
3. **Daily briefing command** — combine reliable state into a ranked next action with reasons and gaps.
4. **Context builder improvement** — replace blind truncation with bounded, prioritized summaries and source-status labels.
5. **Research evidence quality** — store and review source-level evidence.
6. Only then consider voice input or controlled computer operation.

## Safety constraints

- Preserve: “Discover first. Qualify second. Recommend third. Execute only after Zayn approves.”
- Do not automatically email, publish, spend money, contact prospects, or change external systems.
- Keep API keys, local settings, private state files, and backups out of Git.
- Do not claim a local result was tested unless it was run on Zayn's machine.
- Make each change small, add tests, run the Windows CI workflow, and record the result in the project hub.

## Audit conclusion

Cofounder already has a useful foundation: a live AI provider, local business-context loading, structured commercial workflows, approval safeguards, regression tests, and working speech output with an immediately responsive manual interrupt test. The bottleneck is not another AI provider or more architecture. It is making the local business state complete and legible, and then turning it into reliable, explainable next actions.

**Next implementation task: P1 portfolio command + regression tests.**


## Implementation follow-up — 2026-10-15

The first finding has now been addressed on `development`:
- Added a portfolio route before the single-project lookup, including natural-language questions that mention projects, products, or portfolio.
- Portfolio output lists all six currently hard-coded project records, statuses, and recorded links; projects without links are labelled as not published / not recorded.
- Added two regression tests: one for the user's exact multi-project question and one confirming single-project lookup still behaves as before.
- Code commit: `f23d827`; regex correction: `f0091dd`; tests commit: `98ad5fd`.
- GitHub Actions run #30 was still in progress at the time of this update. Do not call the change CI-verified until that run completes successfully.


## Implementation follow-up 2 — read-only data audit

A read-only `audit` command is now implemented in `index.js` (commit `c3c4767`) with a regression test (commit `d99f2e6`).

Run `audit` inside Cofounder. It checks `business.json`, `cofounder-state.json`, and `memory.json` for file presence, parse validity, modification time and size; reports counts for known record arrays; and flags selected missing required fields. It does not print record contents, create a missing file, or write to the business files. It explicitly warns that file health does not prove freshness or commercial truth.

The test suite now has 54 test cases. GitHub Actions run #34 was still in progress at the time of this note; confirm its final result before calling the newest change CI-verified. The audit has not yet been run against Zayn's private local data, so no conclusion about his actual files is available yet.
