# C2 — Denominator Amendment (Recorded)

**Status:** RECORDED — COMMITTED AND DELIVERED TO `origin/cofounder-development-sync`.

The **substance** of this amendment was approved by Zayn on 2026-10-29 as a three-part
decision: (a) the denominator substitution in §3; (b) the binding clarification in §4; and
(c) the incomplete-run interpretation in §5.

Zayn then gave separate explicit approval to **record** the amendment by creating this file.
Authorisation to record is therefore **GRANTED**, and this file has been committed and pushed to
the remote branch recorded in §10. Delivery details and verification are recorded there.

This record does not record C2 as passed, and does not claim that any part of C2's
offline-safety requirement has been demonstrated.

**Applies to:** C2 as defined in the E2.3 design acceptance report, §9 ("Explicit blockers and
conditions"), condition C2.

**Repository:** `C:\Users\ZAYZA\Cofounder-Release-Candidate`
**Branch at authoring:** `cofounder-development-sync`
**Date prepared:** 2026-10-29

---

## 1. Discrepancy this amendment corrects

The C2 denominator was recorded as "175-case". The named test file,
`test/jarvis-smoke.test.js`, contains **162 top-level `test(` declarations** (all at column 0;
no `describe`, `t.test`, `test.skip`, `test.only`, `test.todo`, hooks, or dynamically generated
tests).

The historical figure of 175 has an arithmetic explanation that can be reconstructed, but its
original counting method is undocumented: 175 is the number of **lines** in that file
containing the substring `test(`, of which thirteen are `RegExp`/`String.prototype.test()`
calls rather than declarations (162 + 13 = 175 lines; 177 substring occurrences, because two
of those lines hold two calls each). The method used at the time was never recorded; the
earliest recorded use of the figure is the E2.1 capability inventory, which states no counting
method.

Accordingly:

- The file contains **162** declared tests — verified.
- The historical **175** has not been shown to correspond to any case count in this file —
  its derivation method is undocumented, and the text-match explanation fits the number
  exactly but is a reconstruction, not a recorded derivation.

This record corrects the denominator to the verified declaration count. It does **not** assert
anything about a 175-case suite elsewhere, and makes no claim about suites other than the one
named in §3.

## 2. Historical wording preserved

The original wording is **not altered**, here or in its source. The authoritative source lives
outside this repository, in the E2.3 acceptance artefact:

```
C:\Users\ZAYZA\AppData\Local\Temp\opencode\e2.3-design-acceptance-20261018-185629\e2-3-design-acceptance-report.md
```

| Source | SHA-256 |
|---|---|
| E2.3 acceptance report (§9, line 171) | `3281A936CD51701C9A60347816416FE392454F990FB1A397B4AC7A7CCB4234E0` |
| `test/jarvis-smoke.test.js` (3,574 lines) | `1F6457FC1C10A3E22FF93B1F152AF854E8DBB54544D05993062E8845E8559607` |

Original text, for the record:

> **C2 — Offline-safety proof.** Before/with P1, confirm by execution **under the E1 offline
> guard** that the 175-case suite performs **zero** live network and child-process activity
> (static evidence strongly favours this; full static proof of every spawn path was not
> completed here).

## 3. Proposed amended criterion

> **C2 — Offline-safety proof.** Before/with P1, confirm by execution **under the E1 offline
> guard** that the 162-test suite declared in `test/jarvis-smoke.test.js` performs **zero**
> live network and child-process activity (static evidence strongly favours this; full static
> proof of every spawn path was not completed here).

The sole change is the suite description. Every other clause — "under the E1 offline guard",
"Before/with P1", both zero-activity requirements, and the trailing static-evidence
parenthetical — is preserved verbatim.

## 4. Binding denominator clarification

> The figure **162** is the verified **source-level declaration count** of top-level `test(`
> declarations in `test/jarvis-smoke.test.js`. It is a property of the committed file. It is
> **not** a measured execution count, **not** a count of tests that completed, and **not** a
> claim that any test passes. The denominator identifies which suite C2 refers to; it does not
> establish any part of the offline-safety requirement, which is satisfied only by execution
> under the E1 offline guard demonstrating zero live network and zero child-process activity.

## 5. Incomplete-run interpretation

> C2 is satisfied only by evidence covering the complete suite of 162 declared tests. A run
> that completes **fewer than 162** tests is **inconclusive** for C2: it neither satisfies the
> criterion nor constitutes a failure of it. In that case C2 remains **UNPASSED** until valid
> execution evidence demonstrates the criterion for the complete suite.

## 6. Effect on acceptance status

| Item | Status |
|---|---|
| **C2** | **UNPASSED.** The denominator would be defined by this amendment once recorded; the offline-safety requirement is untouched and unevidenced. |
| **C2′** | **NOT APPROVED.** Unaffected by this document. |
| **G1** | **NOT ADOPTED.** Unaffected by this document. |
| **P1** | Its recorded completion (G6, G9) is unchanged and remains **not** evidence for C2. |
| **E1 guard** | Unchanged and unmodified. Its documented coverage limits — network interception is `fetch` only; four of eight child-process entry points are unpatched; `spawn` blocks without throwing — are **not** resolved here. |
| **Subprocess-dependent tests** | Unchanged. How the suite can execute under the guard without altering what those tests prove remains an open design question. |

## 7. Deferred to separate review (not resolved here)

1. **"Before/with P1" temporal anchor.** P1's recorded completion is closed, so on adoption the
   clause reads retrospectively. Whether to restate or retire it is a separate decision.
2. **Static-evidence parenthetical.** The parenthetical says that "full static proof of every
   spawn path was not completed here". Since then, the child-process call sites in `index.js`
   and `test/` have been enumerated statically. That enumeration is a source-level observation
   only: it says nothing about network activity, nothing about runtime behaviour, and nothing
   about the guard's ability to demonstrate zero live activity. Whether to restate the
   parenthetical is a separate decision, and this record does not rely on the enumeration for
   any part of C2.
3. **E1 guard coverage limitations.** Any strengthening or replacement of the guard — broader
   network interception, full eight-API child-process coverage, or non-throwing `spawn` — is a
   separate, explicitly scoped amendment requiring separate approval.

## 8. What this record does not do

- It does not record C2 as passed, satisfied, or partially satisfied.
- It does not assert that 162 tests execute, complete, or pass.
- It does not assert that the E1 guard is or can be made capable of demonstrating zero live
  network or zero child-process activity.
- It does not authorise any execution, test run, guard run, or CI run.
- It does not modify the E2.3 acceptance report or any other acceptance artefact.
- It does not change any other acceptance criterion, gate, or release condition.
- It does not adopt C2′ or G1.
- It is not in force in the repository's history until the commit recording it is made (§9).

## 9. Approval and recording status

| Field | Value |
|---|---|
| Substance approved by | Zayn |
| Date of substance approval | 2026-10-29 |
| Scope of substance approval | (a) the wording substitution in §3; (b) the binding clarification in §4; (c) the incomplete-run interpretation in §5 |
| Authorised at that time | Preparation of this record only |
| Authorisation to **record** this file | **GRANTED** — separate explicit approval given for creation of `docs/C2-DENOMINATOR-AMENDMENT.md` |
| Recording (commit) status | **Committed and pushed.** Recorded by `c51ce39`, delivered to `origin/cofounder-development-sync` via merge `f2b1a1a`; verified remote head equals `f2b1a1a` (see §10) |
| Deferred by the same decision | "Before/with P1" anchor; static-evidence parenthetical; E1 guard limitations |

## 10. Delivery record

| Field | Value |
|---|---|
| File | `docs/C2-DENOMINATOR-AMENDMENT.md` |
| Branch | `cofounder-development-sync` |
| Amendment commit | `c51ce3963164968f2add5531f049edb84c393d33` — `docs: record approved C2 denominator amendment` (local-only commit that introduced this file) |
| Remote commit preserved by merge | `b003a3639ff2f610af1076c6f9e8ba7a7fb77e40` — `docs(hub): reconcile status with verified 28 October evidence` (pre-existing remote Hub update, carried through unchanged) |
| Merge commit | `f2b1a1a6577c588bc794ce53f7f191ff57d1db10` — `Merge remote-tracking branch 'origin/cofounder-development-sync' into cofounder-development-sync` |
| Remote / branch | `origin` → `https://github.com/syedzayn296-ops/syedzayn296-ops-jarvis-cofounder.git`, branch `cofounder-development-sync` |
| Push | Delivered non-forced (`b003a36..f2b1a1a`), then **verified against the remote branch reference**: `git ls-remote --heads origin cofounder-development-sync` returned head `f2b1a1a6577c588bc794ce53f7f191ff57d1db10`, matching the local merge commit; a re-fetch of `origin/cofounder-development-sync` returned the same hash; ahead/behind `0 / 0` |
| Ancestry verified | `c51ce39` and `b003a36` are both ancestors of remote head `f2b1a1a` |
| Working tree after delivery | Clean |

Verification note: this record is itself the file whose delivery it describes. It is delivered
by the merge commit above; any later edit to this document — including this delivery record —
requires its own commit, and the hashes above describe the delivery of the amendment, not of
subsequent edits.
