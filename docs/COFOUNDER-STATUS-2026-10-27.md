# Cofounder status - 27 Oct 2026

## Source of truth
- Folder: C:\Users\ZAYZA\Cofounder-Release-Candidate
- Branch: cofounder-release-candidate-20261027 (also on GitHub)
- Tests: 201 of 201 pass (run: npm test)

## What happened
- Work had spread over several local folders and never reached GitHub.
- The Release Candidate was found to be the newest and furthest along.
- Its unsaved work (state-store.js, three state tests, edits to index.js and the smoke test) was committed and pushed.
- Two older tests expected the old "shares the saved name" sentence; they were updated to the new "identity-collision" sentence.

## Older copies (all backed up in Documents\Cofounder-Backups-20261027, nothing deleted)
- JARVIS (original, early October)
- JARVIS-Cofounder-Clean (15-26 Oct)
- Cofounder-OpenCode-Test (16 Oct)
- Documents\ChatGPT\Cofounder-Release-Candidate (empty, no history)

## Open items
1. Make GitHub main and development match this branch (via a pull request).
2. Decide whether to bring back the old reminders function (addReminder, from the early JARVIS folder).
3. Tidy leftover .before-* and .bak files, and archive the old folders, only when Zayn says so.
4. Check whether the "ambiguous-selection" case in describeProspectResolution is still used.
5. Jarvis Vault and Jarvis OS (phone) are separate projects, not part of Cofounder.

## Working habit
At the end of each session: git status, git add, git commit, git push.
