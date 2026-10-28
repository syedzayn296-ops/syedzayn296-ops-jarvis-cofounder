# G9 — Dated HEAD Verification (Acceptance Clarification)

**Status:** documentation clarification only. This file does **not** record G9 as passed, and it does **not** claim that the original G9 wording was literally satisfied.

**Applies to:** the G9 gate defined in the E2.1 capability inventory and the E2.2 implementation roadmap (phase P1).

**Repository:** `C:\Users\ZAYZA\Cofounder-Release-Candidate`
**Branch at authoring:** `cofounder-development-sync`
**Generated:** 2026-10-20

---

## 1. Problem being corrected

The original G9 verification requirement (E2.1) was:

> "Read hub → stated HEAD/branch match `git rev-parse`."
> — E2.1 capability inventory, G9 row

The E2.2 P1 acceptance sentence combines two gates; only its second clause concerns G9. The first clause is G6, and it is not addressed by this clarification:

> "**Acceptance:** a throwaway-clone push on the RC branch triggers the workflow; HUB "current branch + HEAD" matches `git rev-parse`."
> — E2.2 implementation roadmap, P1

Read as a permanent property of a committed file, this requirement is self-defeating: the commit that records the HEAD is itself a new HEAD. Commit `074d7f202c0d90f3d1c8986fa7f5fa2b10493100` is the concrete instance — the hub it commits records its parent, `f98f7805ce3027dd22143bb55adabf66c72dd6f5`.

No wording of a committed file can maintain a permanent equality with its own commit hash. The requirement is therefore interpreted as a **dated verification snapshot**.

## 2. Historical wording preserved

The original wording is **not altered**. The authoritative sources live outside this repository, in the E2.1 and E2.2 acceptance artefacts:

```
C:\Users\ZAYZA\AppData\Local\Temp\opencode\e2.1-capability-inventory-20261018-181108\e2-1-capability-inventory-report.md
C:\Users\ZAYZA\AppData\Local\Temp\opencode\e2.2-architecture-20261018-20261018-182720\e2-2-implementation-roadmap.md
```

| Source | SHA-256 of the source file |
|---|---|
| E2.1 report | `D80B89DFF5D3789196FDEE8EB377C03C27364EA745358D08DF62B6F5F7E9E7F1` |
| E2.2 roadmap | `0696D1DB8547EC40F84CECFEE0DE4BF3BDD2183202433DA023AB84731A164AA6` |

These files are hash-manifested acceptance evidence and were **not modified** by this correction.

## 3. Corrected criterion

> **G9 acceptance criterion:** The operational hub records the verified current branch and HEAD, together with the date and time of verification. The recorded values must match the repository's actual branch and HEAD at the time of that verification. The record is a dated verification snapshot, not a promise that the values will remain current after subsequent commits.

## 4. Verification procedure

> 1. Read the current branch using Git.
> 2. Read the current HEAD using Git.
> 3. Compare both values with the hub's recorded branch and HEAD.
> 4. Record the verification date/time and the observed values.
> 5. If a later commit changes HEAD, mark the previous snapshot as historical/stale and perform a new verification when authorized. Do not create repeated commits merely to chase a self-referential hash.

## 5. Verification record

| Field | Value |
|---|---|
| Verification performed | `2026-10-20 00:46:03 +02:00` |
| Branch observed | `cofounder-development-sync` |
| HEAD observed | `074d7f202c0d90f3d1c8986fa7f5fa2b10493100` |
| Hub recorded branch | `cofounder-development-sync` |
| Hub recorded HEAD | `074d7f202c0d90f3d1c8986fa7f5fa2b10493100` |
| Result | MATCH at the recorded time |
| Method | `git rev-parse --abbrev-ref HEAD`; `git rev-parse HEAD`; textual comparison against `docs/COFOUNDER-HUB.md` |

**Superseded snapshot (history only, not a current claim):** the hub previously recorded `f98f7805ce3027dd22143bb55adabf66c72dd6f5` with a verification date of 2026-10-20. That snapshot was superseded when commit `074d7f2` advanced HEAD.

The snapshot above will itself become historical after any future commit. Per §4 step 5, it is then marked stale and re-verified under separate authorisation; no commit is created merely to chase the hash.

## 6. Effect on acceptance status

- **G9:** the dated snapshot match was verified at the time recorded above. This is **not** a permanent pass, and it is **not** a claim that the original wording was literally satisfied.
- **G6:** the throwaway-clone workflow-provenance clause quoted in §1 is unchanged, is not addressed by this document, and remains **NOT MET**. Nothing here waives it or records it as complete.
- **C2, C2′, G1:** unchanged; not touched by this document.
- **Remote publication:** not performed and not verified.

## 7. Scope of this change

Documentation only. No application code, test, workflow, configuration or protected user-data file was changed. No commit, push, fetch or other remote operation was performed.
