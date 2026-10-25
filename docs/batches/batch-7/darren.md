# Batch 7 — Darren

> **Superseded in part.** These answers describe the first integration candidate `ae422e6`. The final candidate is `09f54cc`; its answers (browser suite 25 passed / 1 skipped, UI reconciliation, Claude provider, fresh-clone checks, QA 53/53) are in `docs/batches/batch-7/integration.md`.

Owned: root/config/lockfile/contracts/data/API/worker/runtime/merges. Evidence, hashes and commands are in `docs/batches/batch-7/integration.md`. Status words: PASS, FAIL, BLOCKED, NOT RUN. Fixture mode, demo ingestion and the outbox were used throughout; nothing live was called.

## Role questions

1. **Branch tips that replaced the packet's snapshot.** PASS. Same: `main` `5d8f342`, `person-2-engine` `de6bd40`, `platform` `aaed3db`, `platform-batch4` `700d7a6`, `platform-batch5` `d11127b`. New: `platform-batch6` `fef9396` (Darren), `engine-batch5` `0bf8819` and `engine-batch6` `b313998` (Joanne). No experience branch.
2. **Local UI/QA work preserved.** PASS. The uncommitted SpaceXAI UI in the main checkout is byte-identical to `664cc98` on `platform-batch6` (ten files, hashed one by one) and the main checkout was not touched. The QA harness was local on `qa/system-batch3` @ `1cee0ca`; its two QA-only commits are on `qa/system-batch7`, the original is untouched.
3. **Committed frontend and provenance.** PASS. Darren's SpaceXAI-style UI (`664cc98`, return-path fix `79a35af`, `1e29d42`). No second UI exists to compare with; Maricella's branch is absent (BLOCKED for reconciliation).
4. **Merge containing both platform and the real engine, with both test and dependency sets.** PASS. `ae422e6` = `platform-batch6` + `engine-batch6`. Lockfile and manifests unchanged against `platform-batch6` (diff 0 lines). 272 tests in 24 files pass; the engine's 52 are among them and no platform test file changed.
5. **Clean checkout reproduces it.** PASS for the committed tree: the candidate was built from its own worktree with only a generated, untracked `.env` (`pnpm setup:local`). A fresh `git clone` of this exact commit was not made in Batch 7 (it was in Batch 6 for `0e8395e`); NOT RUN for `ae422e6`.
6. **Task and downloads proving engine, files, UI and review persistence.** PASS. Task `6882d722-6845-4d5c-9e14-4b2a757de688`, artifacts `art_05c90bb0038d4eb8cb1e917f497c61d8` (DOCX, 11923 B) and `art_dbcec1ebaf344e1bfc1b4f52e66e7652` (PPTX, 101280 B); hashes in `integration.md`. Review state `approved` survived a kill and restart of API and worker and a browser reload.
7. **Stub in the active runtime path.** The engine: none (`@afterhours/engine` exports load and produced the files). The web app: none. **`packages/delivery` is still a stub**: it only simulates the outbox and refuses live channels. No ENGINE_NOT_IMPLEMENTED path is reachable.
8. **QA harness executed.** PASS with a caveat. 53 tests on `ae422e6`: 49 pass and 4 fail with the inherited expectations (exit 1); 53 pass after four expectation changes (exit 0), each justified in `docs/qa/batch-7-verification.md`. Older scores (32, 44, 50 of 53) belong to other code.
9. **Defects versus stale expectations versus missing information.** Code defects (DEF-2, -3, -4, -6) are fixed in the engine. A3, A4, H5, H6 were stale expectations: the unknown is still flagged, the email states a start date and a duration but no end date, and the new wording is "Not computable" and "unknown (no orders)". A5 and I1 needed no change. See the triage table.
10. **Browser test command runs tests.** FAIL / NOT RUN. `pnpm test:e2e` exits 0 and prints `SKIPPED: tests/e2e is empty.` Maricella owns it; I did not take over `tests/e2e`. Browser coverage in this batch is a manual pass in the built-in browser (sign-in return, task page, downloads, review, reload).
11. **Safeguards retained.** PASS for unchanged code: `packages/data`, `packages/contracts`, `apps`, `scripts`, `Dockerfile` and `docker-compose.yml` are byte-identical to `platform-batch6` (diff 0 lines), so the timestamp, input, lease, file, CLI-scope and notification protections and their tests carry over. Run again here: the full unit suite, the harness (access, state, dedupe, stale review) and one API/worker restart.
12. **Still FAIL, BLOCKED or NOT RUN.** Browser suite (Maricella); Maricella's UI branch; delivery adapter (Maricella/external); evidence chips show raw source ids (P2, Maricella); Word rendering; visual rendering on this candidate; fresh clone of `ae422e6`; live Gmail, model, WhatsApp; Docker; remote host; overnight run.

## Universal questions

1. **Ref and input/output.** `integration/batch7` @ `ae422e6`; input: the demo proposal scenario; output: DOCX and five-slide PPTX with the hashes above.
2. **Commands versus old reports.** Run today with exit codes: install, check:ready, typecheck, lint, test, engine tests, build, `test:e2e`, the QA harness twice. Earlier reports were used only for orientation.
3. **Preserved, integrated, missing.** Preserved: UI, harness. Integrated: platform, engine, UI. Missing: Maricella's branch, e2e suite, delivery adapter.
4. **Implementation against contract.** Where the harness and the engine disagreed, I read the email, the brief and the contract before touching either side. Four assertions were stale; none of the engine's output was changed to satisfy a string.
5. **Persisted files, UI, review.** Manifest size and SHA-256 equal the downloaded bytes; review state persisted through a restart.
6. **Fixture, live, simulated, blocked.** Fixture intelligence, demo intake, simulated outbox, all labelled in the UI ("Demo email", "Fixture intelligence", "simulated (not sent to a phone)"). Live paths: BLOCKED/NOT RUN.
7. **Boundaries.** No secret printed into a file or the repository (the generated `.env` is gitignored; the local test password was typed into the localhost sign-in form only). No external message, paid call or deploy. I started and stopped only my own API, worker and web processes on ports 4627 and 3627. The shared main checkout and the other worktrees were not modified.
8. **Remaining.** See question 12. It blocks the gates "real browser suite" and "real WhatsApp delivery", not the local fixture demonstration.
