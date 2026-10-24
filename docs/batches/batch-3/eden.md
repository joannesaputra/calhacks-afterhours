# Batch 3 — Eden (system QA)

- **Base:** `origin/platform` `aaed3db`. **Candidate tested:** `4e1b5ae` (local merge with `origin/person-2-engine` `258e2eb`; not pushed).
- **Scope / files:** `tests/system/**` (harness + 4 suites, 53 checks), `docs/qa/README.md`, `docs/qa/defects.md`, `docs/qa/batch-3-verification.md`, this file.
  No production code, root config, lockfile or other owners' tests were edited.
- **Run:** `node --import tsx --test tests/system/*.test.mjs` (see `docs/qa/README.md`).
- **Result:** candidate 32/53 pass, **gate FAIL**. One P0 (DEF-1: engine ids contain `/`, platform rejects → every real proposal/report task fails `ARTIFACT_INVALID`),
  two P1 (DEF-2 hard-coded report narrative, DEF-3 hard-coded "four-week"), two P2 (DEF-4 DOCX table grid, DEF-5 engine lint).
  With the one-line DEF-1 fix in a scratch worktree 47/53 pass, which shows the rest of the pipeline works.
- **Not covered:** browser/UI (BLOCKED, no Maricella branch), Word/PowerPoint rendering (NOT RUN), worker-kill race and old-artifact overwrite (NOT RUN).
- **Owners and next handoff:** Joanne fixes DEF-1 (ids) and DEF-2–5; Darren updates the stale worker stub test and adds a platform test with real engine output;
  Maricella pushes the experience branch for the browser pass. Then Darren merges, and QA reruns the suite on the actual merged commit.
- Full per-question evidence, hashes and answers to the 15 + 8 quality questions: `docs/qa/batch-3-verification.md`. Defects: `docs/qa/defects.md`.
