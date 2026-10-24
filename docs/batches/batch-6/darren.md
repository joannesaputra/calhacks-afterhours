# Batch 6 — Darren (release integration and reproducibility)

- **Branch:** `platform-batch6` (local, not pushed). **Tested candidate:** `0e8395ed18941cd08e99e1c64b0b6a421a0eb3dd`. Later commits are docs-only (`git diff 0e8395e HEAD --stat` lists only `docs/`). Details: `docs/release/candidate.md`.
- **Decision:** READY WITH DISCLOSED LIMITATIONS for the narrowed scope (demo intake, fixture intelligence, outbox); the **original full-product gate is NOT MET** (`docs/release/status.md`, `docs/release/capability-matrix.md`).
- **Feature freeze kept:** no provider, parser, output type, route, DTO, env var, migration or dependency was added. Fixes: a safe post-login return path (web), four P1/P2 engine defects (isolated commits for Joanne), a lint fix in my own helper.

## What I did

1. Fetched actual state: origin has `main`, `platform`, `platform-batch4/5`, `person-2-engine` (`de6bd40`). No experience branch, no newer engine branch, no browser suite, no demo script. Recorded as the I1 inventory.
2. Assembled the candidate on `platform-batch6`: `platform-batch5` + clean merge of the engine branch (`186a6e7`) + the SpaceXAI UI snapshot copied unchanged (`664cc98`). Lockfile = the merge result, reviewed: frozen install works and a lockfile-only regeneration produces no diff.
3. Clean-checkout run (`git clone --no-hardlinks`, new directory, generated disposable secrets, ports overridden by shell variables, nothing of the real `.env` or database touched): install, `setup:local`, migrate twice, seed, `check:ready`, typecheck, lint, build (with `next build`), test: all exit 0, 22 files / 241 tests. The first clean run **found a lint error** in my new helper (fixed before the freeze), which is why the clean run is part of the process.
4. Ran the QA system suite against the clean clone: 44/53 before the engine fixes, **50/53** on the frozen candidate; the three failures are P2 (see integration report).
5. Ran the documented `pnpm dev` and `pnpm demo:proposal/demo:report` (separate clone, API port overridden): all three processes up with `[web]/[api]/[worker]` prefixes, both demos `ready`, cookie `HttpOnly; SameSite=Lax`, API bound to loopback.
6. Built runtime (the commands the compose file runs): two full UI rehearsals, access/state/replay probes, live-mode-without-key, `SIGTERM` restart with identical manifest and re-hashed files, backup/verify/restore.
7. Hygiene scans of the tree and all history; log scan.
8. Wrote candidate record, capability matrix, status note, runbook updates, this report.

## Commands and results

See the ledger table in `docs/release/candidate.md` (rows 1–14). Summary: install/setup/migrate/seed/ready/typecheck/lint/build/test exit 0; `test:e2e` exit 0 but SKIPPED (no suite); QA suite exit 1 (50/53). Not run: Docker, any live call, remote host, overnight.

## Role questions

1. **Which exact frozen commit was installed/run from a clean checkout, with what commands/exit codes?** PASS. `0e8395ed18941cd08e99e1c64b0b6a421a0eb3dd`, ledger rows 1–11 all exit 0 (`pnpm test:e2e` skipped by design: NOT RUN as a browser suite).
2. **Do migrations/setup preserve existing secrets/data and work in the documented root/runtime environment?** PASS. `setup:local` created `.env` only in the new clone and never overwrites; migrations idempotent (second run "No pending migrations"); an existing-data upgrade (001–002 → 003) is tested in `batch5-notifications.test.ts`; the real `.env`/DB were never touched.
3. **Which required acceptance scenarios passed on the merged candidate, and which are blocked or not run?** Passed on the candidate through the real API/worker/engine: proposal (A), report (B), no-action (C), clarification (D), duplicate/replay (E), stale review/transitions (L), unauthorized access (H), notification fallback outbox (J), export integrity (N: hash/MIME/structure), restart (G). Passed as controlled tests (`pnpm test`): provider failure no-fallback and bounded retry (F), input limits (M), injection (I: no leak; I1 strictness P2 open), quiet hours/DST/digest dedupe (K). BLOCKED: live Gmail, live model, live WhatsApp. NOT RUN: Docker, remote host, real overnight, automated browser suite, keyboard/offline.
4. **Are real file manifests/downloads/review states durable and protected after the tested restart?** PASS: identical task list and manifest, 14 files re-hashed, review state kept, downloads 401 without a session (I4, I6).
5. **Which integration modes were actually exercised, and does the final status matrix match UI/pitch wording?** Demo intake + fixture intelligence + outbox only; matrix and status note say so and forbid "Gmail", "AI model", "WhatsApp sent", "overnight", "deployed". The UI labels (Demo email, Fixture intelligence, Marked reviewed, Outbox/simulated) match.
6. **What security/data-leak issues remain, and are they release-blocking?** None open at P0/P1 on the demonstrated scope. Open P2: hollow-brief acceptance (I1) and raw ids in the UI. The password and CLI token exist only in a git-ignored `.env`; the demo must not show them.
7. **Did the exact demonstration work twice without hidden edits or fixture/live misrepresentation?** PASS for the rehearsed stand-in demo (two runs, no failures, no database edits, labelled fixture). **Maricella's exact demo: NOT RUN** (does not exist).
8. **What could interrupt judging, what is the tested fallback, and which claims are limited?** Interrupters: port 4000 in use (override `API_PORT`+`API_ORIGIN` together), a hidden/stale browser tab (reload), a stopped worker (`pnpm check:worker`), a missing key if someone flips to live mode (fails honestly, say so). Fallback = the candidate in demo/fixture/outbox mode (tested). Limited claims: no Gmail, no live model, no WhatsApp, no overnight, no deployment, templated content.
9. **What exists versus stubs/missing branches, and which blockers were closed?** Exists: platform, engine, SpaceXAI UI (Darren's, unpushed). Stub/missing: delivery adapter (stub), browser suite, experience branch, demo script, claim note, live channels. Closed rather than assumed: the real request→files→review path was run end to end; DOCX tables defect, report narrative, label and title defects fixed; deep-link return fixed.
10. **Do the clean-checkout commands work without hidden dependencies or overwriting real data?** PASS with one disclosed condition: the installs used the local pnpm store (`--offline`); registry reachability was not exercised. `pnpm dev` needs `API_PORT`/`API_ORIGIN` overrides only when port 4000 is taken (it was, by another project's process, which was left alone).
11. **Which test evidence belongs to the candidate versus a later docs-only commit or an older sample?** Candidate `0e8395e`: ledger, QA 50/53, rehearsals, probes, restart, backup, live-mode check, scans. Older (Batch 5, platform code unchanged): closed-browser, real-time quiet-hours run, real `SIGKILL` drills. Docs commits after `0e8395e` are not code.
12. **Which prior timestamp/input/cursor/state/file/notification protections remain intact?** All earlier platform tests pass unchanged in the 241 (receivedAt vs createdAt, intake limits, cursor 400, state table, lease/stale-owner fencing, immutable content-qualified files, unique intents, uncertain-send handling, POLICY_CHANGED, quiet-hours policy). The only platform test file changed is the stub-engine test replaced by a real-engine test.
13. **Is the fallback actually runnable with real files/review, and what claims change?** Yes (it is the tested configuration). Claims reduce to: demo email, rule-based content, simulated notification.
14. **Do the demo/video claims match the final per-capability evidence?** The status note defines allowed and forbidden claims from the matrix. The concept video and Maricella's note were not available to compare: **NOT RUN**; generated or animated screens must be labelled as a concept.
15. **What final readiness decision is justified, and which original gates remain open?** READY WITH DISCLOSED LIMITATIONS for the narrowed scope. Open original gates: live Gmail (BLOCKED), live model (BLOCKED), WhatsApp (NOT IMPLEMENTED/BLOCKED), automated browser suite (NOT RUN), Docker/remote host (NOT RUN/BLOCKED), overnight trial (NOT RUN), full visual Office review (PARTIAL).

## Universal questions

1. **Candidate and input/output:** `0e8395e`; rehearsal tasks and file checks in `integration.md` I2/I3.
2. **Commands/exit codes:** `candidate.md` ledger.
3. **Modes and accuracy of claims:** demo / fixture / outbox; nothing live; labels truthful.
4. **Contracts and runbook:** no DTO/route/state/env change; `docs/runbook.md` updated for the release and its commands were executed (dev, built runtime, backup, health).
5. **Failure safety:** missing key → typed nonretryable failure, no fallback; unauthenticated → 401; foreign origin → 403; stale → 409; kill/restart → lease recovery and immutable files (tests and Batch 5 drills).
6. **Persistence and integrity:** manifest, files, review state and settings persisted across restart; SHA-256 re-verified; backup verified.
7. **Boundaries:** no secret printed or committed; nothing sent externally; no paid call; only test-started processes were stopped; only scratch directories deleted; `launch.json` entries I added were removed.
8. **Remaining:** see the table in `integration.md` and the "Overall" paragraph of the matrix.
