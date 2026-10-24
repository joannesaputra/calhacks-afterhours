# Batch 7 — engine triage and integration (Joanne)

## Refs (fetched 2026-10-24)

The Batch 7 prompt's snapshot predates two engine branches and Darren's candidate. Actual remote state:

| Ref | Tip | Notes |
|---|---|---|
| `person-2-engine` | `de6bd40` | old engine; the one Darren's candidate merged |
| `engine-batch5` / `engine-batch6` | `0bf8819` / `b313998` | Batch 5 hardening; Batch 6 rounding fix + artifact audit |
| `platform-batch6` | `fef9396` (tested code `0e8395e`) | Darren's committed release candidate: platform-batch5 + `de6bd40` + his 4 interim engine fixes + SpaceXAI UI snapshot + deep-link fix |
| **`engine-batch7`** | **`97efddf`** | this work: engine fixes, then a merge of `origin/platform-batch6` |

`engine-batch7` = `engine-batch6` + `3cc6956` (triage fixes) + `a510b40` (interval form) + `ceec5da` (merge of `platform-batch6`) + `97efddf` (test oracles that were not staged in `ceec5da`).
- Compared with `origin/platform-batch6`, only `packages/engine/**` and `docs/**` differ: no contract, migration, route, root, lockfile or UI change.
- Because `origin/platform-batch6` is an ancestor of `engine-batch7`, Darren can take it as a plain fast-forward of his release branch.
- Merge conflicts were limited to `content.ts`, `planning.ts` and `render/docx.ts`, resolved to my implementation.

## Commands (exit codes)

| Command | Tree | Result |
|---|---|---|
| `corepack pnpm vitest run packages/engine` | engine-batch7 before merge | 0; 60 tests |
| `check:ready` / `typecheck` / `lint` / `test` / `build` / `test:e2e` | **clean worktree of `97efddf`** | 0 / 0 / 0 / 0 (**25 files, 286 tests**) / 0 / 0 (`SKIPPED: tests/e2e is empty`, so the browser suite is **NOT RUN**) |
| real API + worker (`node --import tsx apps/{api,worker}/src/main.ts`, port 4619, fresh DB) + API driver: login, inject ×4 + replay, stale/valid answers, review, detail, authenticated and unauthenticated downloads | clean worktree of `ceec5da` (same source as `97efddf`; only the test file differs) | all scenarios as below |
| Microsoft PowerPoint Save-as-PDF + PDFKit; Quick Look DOCX page 1 | downloaded files | 3 decks × 5 pages; DOCX page 1 readable |

Only the two processes started for the run were stopped, and both scratch worktrees were removed. Corepack's pnpm 10.33.4 shim was on PATH from a temporary directory, as in earlier batches.

## Current files from the worker path (`ceec5da` source, fixture mode)

| Task / rev | Outcome | Files (bytes, sha256 prefix): manifest equals authenticated download, unauthenticated download 401 |
|---|---|---|
| proposal `03419d4b-ace9-4226-a47b-d8fee2f4d7f8` r1 | ready → approved; replay deduplicated | `Maple-Moss-Proposal-r1.docx` 11,983 `099c64b70724106b`; `Maple-Moss-Kickoff-Deck-r1.pptx` 101,292 `ffdb4bd8f0131ca8` |
| report `0ed578ae-c5d5-4b1a-9b77-21a833e2eeef` r1 | ready | `…Sales-Performance-Report-r1.docx` 11,489 `b0b4d93e640890bf`; `…Sales-Update-r1.pptx` 119,937 `b4be383bbd098004` |
| ambiguous `3026c039-4d84-4f4b-b536-4e2768c3e90e` r1 → r2 | needs_input (4 questions) → stale answers 409 → answers 200 → ready r2 with 4 answer sources | `Northstar-Co-Proposal-r2.docx` 11,319 `b925f5002b1f6664`; `Northstar-Co-Kickoff-Deck-r2.pptx` 93,943 `1f8d3c28e2599e13` |
| no_action `65fe61bd-93e8-45aa-9e7e-dd8847e2130c` r1 | skipped, 0 files, plan "No action: FYI: October studio newsletter" | — |

Content audit of the downloads against `TaskDetail.products`:
- **Preview strings found in the DOCX:** 52/52, 40/40 and 34/34.
- **Preview strings found in the PPTX:** all except the deck title (stored in `core.xml`) and the uppercase cover label.
- **Citations:** 48/48 point to completely read sources, and 36/36 quotes match.
- **Decks:** 5 slides and 5 notes pages each; chart values `12000`/`15000`.
- **Canonical facts:** all present (Harbor Creative, Maple & Moss, USD 6,000, "October 26-November 22, 2026 (4 calendar weeks)", deadline Monday October 26, 2026 at 9:00 AM PDT, exclusions, report metrics).
- **PowerPoint:** the proposal, report and Northstar decks rendered with no clipping, and the interval appears on slides 1 and 4.
- **Word page render:** NOT RUN (automation fails; see Batch 6).

## Role-specific questions

1. **Engine ref and candidate:** `engine-batch7` @ `97efddf`, which contains `origin/platform-batch6`. PASS (checks above). The official candidate record is still Darren's `0e8395e` with `de6bd40`; it needs to take `engine-batch7`.
2. **QA tests retrieved / unavailable:** none retrieved (the harness is unpushed and not on this machine). A4, A5 and I1 are defined by Darren's B6 notes. DEF-2/3/4/6 are defined by his commits. C4, C5, C6, D7 and N3.1 are reconstructions. **H6 is undefined.** BLOCKED for a true rerun of the original suite.
3. **A4:** a real missing end date, not only brittle formatting. The interval is now calculated (start + 7N − 1 days). Semantic tests cover the interval, changed start/duration across a year boundary, unknown duration (question), and the distinct deadline. PASS.
4. **A5:** the assertion is valid for the current engine. Quotes are optional in the contract but present (25/26 citations). Tests check fee-quote presence, that every quote matches its source, and DOCX source notes. Quote-mismatch rejection is a Batch 5 test. PASS.
5. **I1:** an injection-only brief returns `needs_input` with `usable_project_brief`. A sufficient brief plus injection returns ready with no injected content. An injected fee returns a fee-conflict question. PASS (engine).
6. **Can hostile text grant privileges?** No. The engine has no path to secrets, the database, shell, network destinations or messaging; the only network call is the configured model endpoint. Observable tests: no injected text in plan, questions, progress or products; warnings raised; an injected fee cannot change the fee (it becomes a question); live configuration comes only from the environment. PASS (unit).
7. **Clarification/conflict/source-priority:** reproduced and fixed: DEF-6, I1 (specific question), A4. DEF-3 was already fixed (Darren's test passes unchanged). Partial answers re-ask only the missing questions; answer provenance is cited. Brief-itemized deliverables win over the standard package (Batch 5). PASS.
8. **Numeric:** canonical values hold, as do the zero denominator ("not computable"), blank → `INVALID_CSV`, the mixed-currency rejection, USD units, cents, the spec variation and the 60-value sweep. PASS.
9. **Downloads vs preview:** they agree; checked structurally, plus visually in PowerPoint for the decks. Word page render: NOT RUN.
10. **Cross-owner coverage:** `apps/worker/test/worker.test.ts` runs the real engine and passes; it is unchanged from `platform-batch6`. Darren's 4 engine tests are kept (1 unchanged, 3 with corrected oracles). No contract, lockfile or root change. PASS.
11. **Product fixes vs oracle corrections:** see `engine-triage.md`.
12. **Still FAIL/BLOCKED/NOT RUN:**
    - The original QA suite rerun on `97efddf` is BLOCKED (Darren holds the harness).
    - H6 is undefined.
    - Browser e2e is NOT RUN (no suite; Maricella).
    - Word render is NOT RUN.
    - Live model is BLOCKED (no key).
    - Together these prevent claiming the 53/53 merged gate.

## Universal questions

1. **Result:** `97efddf`; tasks and files as above.
2. **Commands:** newly run and listed above with exit codes. The 50/53 QA result is Darren's earlier report on `de6bd40`, not mine.
3. **Preserved and integrated:**
   - Darren's platform, UI snapshot, deep-link fix and tests are preserved.
   - His interim engine source was superseded by mine, with his tests retained.
   - Missing: Maricella's own branch and the browser suite.
4. **Contracts:** unchanged. Oracles were corrected only where they encoded a renderer constant or one wording.
5. **Persisted:** files, revision-2 answers and the approved review were verified through the API and hashes.
6. **Modes:** demo intake, fixture intelligence, outbox `simulated`. No live calls.
7. **Boundaries:**
   - Fictional data; no secrets printed or committed.
   - Generated files only in ignored `var/` or temporary folders.
   - One `rm` on a variable path was blocked by the safety check and **not run**. I used a new subfolder instead, so nothing was deleted.
8. **Remaining:** see Q12.

## Handoff

- **Darren:**
  - Merge `engine-batch7` @ `97efddf` into the release candidate. It already contains `platform-batch6`; engine/docs-only diff.
  - Then rerun the QA system suite. A4, A5 and I1 should now pass; if they don't, send me the assertion text.
  - Please push the QA harness or share `docs/qa/defects.md`, so C4–C6/H6/D7/N3.1 can be checked against their real assertions.
- **Maricella:**
  - New user-facing strings: the "No action: <subject>" title; the `usable_project_brief` question; the calculated-end-date note.
  - Evidence quotes are available on most `SourceRef`s, for a better evidence display than raw IDs (UI-2).
