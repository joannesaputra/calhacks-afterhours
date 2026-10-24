# Batch 3 report — Darren (Person 1, platform)

Owner: Darren / Person 1. Branch: `platform`.
Base commit: `b442c71` (Batch 2 platform tip, includes `e5b8510`). `git fetch origin` at the end of the session shows only `origin/main` (`5d8f342`) and `origin/platform` (`b442c71`).
Candidate commit: `29a3570` on `platform` (parent `b442c71`). Content-identical to what the checks below ran on.
Integrated gate: **BLOCKED.** There is no `engine`, `experience` or Eden QA branch on origin, so the Batch 2 gate (real Office files + browser review) was never closed and Batch 3 cannot be integrated.

## Scope done (platform side, independent of teammates)

Audited every Batch 3 platform item against the code, found most already implemented, then added tests and fixed the gaps below.

Production changes (3 small defects fixed):
1. **Intake did not enforce attachment limits** (`packages/data/src/ingest.ts`). It trusted callers; Gmail polling dropped files silently. Now `ingestMessage` stores at most 5 files, 10 MB each, 20 MB total, skips repeated attachment ids, and adds a visible `warning` event per file not read, with the reason. Files the source skipped (listed in the envelope with no bytes) are reported too.
2. **A malformed list cursor silently returned page 1** (`queries.ts`, `notifications.ts`). A client could loop forever. Now `400 VALIDATION_ERROR` "Invalid cursor."
3. Nothing else changed in production code. State machine, answers, retry, review, commit and lease logic were already correct and are now pinned by tests.

Files: `packages/data/src/{ingest,queries,notifications}.ts`; tests `packages/data/test/batch3.test.ts` (+ `support/race-child.ts`), `apps/api/test/batch3.test.ts`, `apps/worker/test/batch3.test.ts`; docs `docs/backend-handoff.md` (Batch 3 section), `docs/contract-change-requests.md` (CCR-1 proposal), this file. Not touched: contracts, migrations, routes, engine, web, delivery, lockfile.

## Public interfaces
No new routes, no contract changes. Routes, error codes and revision rules are in `docs/backend-handoff.md` → "Batch 3 platform semantics". CCR-1 (optional `TaskDetail.answerHistory`) is a **proposal only**, awaiting Maricella.

## Commands executed (repo root, Node 20.20.2, pnpm 10.33.4)

| Command | Exit | Result |
|---|---|---|
| `git fetch origin` | 0 | only `main`, `platform` |
| `pnpm typecheck` | 0 | 7 packages |
| `pnpm lint` | 0 | 0 problems |
| `pnpm test` | 0 | 11 files, 98 tests (74 before + 24 new) |
| `pnpm test` ×5 repeat | 0 ×5 | 97/97 each time (before the 98th test was added) — no flakes in the process-race tests |
| `pnpm build` | 0 | |
| `pnpm check:ready` | 0 | includes `API_PORT matches API_ORIGIN` |
| Mutation check: restore old `ingest.ts` | tests fail | intake-limit tests failed 2/2, then restored |

Not run: Docker, live Gmail/model/WhatsApp, any browser, any real-engine run, the merged four-fixture run, Eden's verification.

## Role quality questions

1. **Valid answer → exactly one new revision/job, history kept — PASS (platform, fake engine).** Expected: revision 2, one queued job, history row with question text, old events keep revision 1. Actual: as expected. Evidence: `packages/data/test/batch3.test.ts` "a valid answer creates exactly one new revision and one job and preserves history".
2. **Unknown/duplicate/missing answers, concurrent submits, stale — PASS.** Unknown/duplicate/required-missing/blank/oversized/empty list/non-integer revision → `400 VALIDATION_ERROR`, nothing written. Stale → `409 STALE_REVISION` with `details.currentRevision`. Wrong state → `409 INVALID_TRANSITION`. Unknown task → `404`. Concurrency: 10 simultaneous HTTP submits → one 200, nine 409; 6 separate OS processes on one SQLite file → one winner, five 409, exactly one revision-2 job, one set of history rows. Evidence: `apps/api/test/batch3.test.ts` ("returns the documented codes…", "ten simultaneous…"), `packages/data/test/batch3.test.ts` ("six simultaneous answer submits…").
3. **Can failed/skipped/needs_input be approved? — PASS (no).** Table test of all 81 transitions against the spec, plus an HTTP matrix of 9 statuses × 4 actions: approve accepted only from `ready`; dismiss from `ready|needs_input|failed|skipped`; retry only from `failed`; answers only from `needs_input`; each rejection is `409 INVALID_TRANSITION` and the status is unchanged. Evidence: "state machine matches the specification table exactly", "task status x browser action matrix (HTTP)".
4. **Four fixtures through the same path — PASS with a FAKE engine; real engine BLOCKED.** `injectDemo` → worker for proposal, report, ambiguous, no_action: proposal and report `ready` with 2 artifacts and 1 simulated outbox notification each; ambiguous `needs_input` with persisted question, plan, sources, 0 files, 0 notifications; no_action `skipped`, 0 files, 0 notifications; total notifications 2. The engine received the exact bytes of `fixtures/attachments/sales.csv` and `maple-and-moss-brief.md`. Fixtures are still the **foundation placeholders** (Joanne's content not merged). Evidence: `apps/worker/test/batch3.test.ts` first test. Correct report metrics (12,000 → 15,000, +3,000, +25%) are **NOT RUN** — they come from Joanne's engine.
5. **Stale worker or old review overwriting current revision — PASS.** Controlled race: worker A's lease expires, worker B's lease expires, task fails, user retries into revision 2; both A and B then try to commit revision 1 → `LeaseLostError`, task stays `queued` revision 2, 0 artifacts, 0 notifications, one revision-2 job; a late failure report from A returns `{lost: true}` and leaves revision 2 untouched; old review of revision 1 → `STALE_REVISION`; revision 2 then completes. Also approve vs dismiss across 4 processes → exactly one decision and one review event. Evidence: "a worker that finishes revision 1 after the user retried…", "approve racing dismiss…".
6. **Size/path/required-input failures bounded and visible — PASS (platform); extraction caps NOT RUN.** 6th file, >10 MB file, >20 MB aggregate, repeated id → not stored, visible warning per file; a dropped attachment still listed in the envelope makes the task `failed` `ATTACHMENT_UNAVAILABLE` (non-retryable) before the engine is called, 0 artifacts, 0 notifications. Fixture traversal, absolute path, NUL and symlink escape rejected. Oversized body → `413 PAYLOAD_TOO_LARGE`; bad JSON, wrong content type, over-long replayKey, bad status filter, bad cursor → 4xx envelopes with no stack/SQL text. Unsupported-but-valid binary input and the 60,000-char model-input cap are engine behaviours: NOT RUN. Evidence: `packages/data/test/batch3.test.ts` intake tests, `apps/worker/test/batch3.test.ts` "an attachment dropped at intake…", `apps/api/test/batch3.test.ts` "returns bounded 4xx envelopes…".
7. **Duplicate handling and notification dedupe across revisions — PASS.** Replay-key races are from Batch 2 (25 HTTP, 6 processes). New: ready in revision 2 gives key `<task>/2/outbox` only; repeating `createReadyNotification` twice leaves one row; a failed→retried task gets a revision-2 key, never revision 1. A failing notification does not rerun generation (engine called once, one job, files intact). Evidence: "one intent per task revision…", "a failing notification never reruns generation…".
8. **Merged Batch 3 run with real report metrics and real resumed clarification — BLOCKED.** No engine/experience branch exists. The resumed clarification flow is proven only with the fake engine (task → needs_input → answers → revision 2 ready, answers in engine input, only revision-2 artifacts/notification). Owner: Joanne (engine, fixtures), Maricella (UI).
9. **Merged Batch 2 commit that showed real Office files and browser review — FAIL / none exists.** The Batch 2 gate in `docs/batches/batch-2/integration.md` is still BLOCKED. Batch 3 did not start from a closed gate; the user's prompt allows safe independent platform work, which is all this report covers.
10. **receivedAt / createdAt regressions and local-port checks — PASS.** `packages/data/test/demo.test.ts` (fixture `receivedAt` kept, `created_at` = ingestion time, provider id namespacing), `apps/worker/test/worker.test.ts` (engine gets fixture `receivedAt`), port checks: `apiPortMismatch` unit tests, proxy rewrite test, `pnpm check:ready` exit 0 (local `.env` has API_PORT and API_ORIGIN both 4100). All in the 98-test run, exit 0.
11. **Candidate Eden tested; defects she reproduced — NOT RUN.** No Eden branch or report exists on origin. No candidate commit was exposed to her because nothing is committed. Platform defects fixed in this session were found by my own tests, not by her (intake limits, invalid cursor).
12. **Unsafe endpoint, secret exposure, ownership conflict, hidden state edit — PASS (none).** No route added or changed; no auth bypass; tests use temp DBs and artifact dirs and write status only through `setStatus`/data functions; `.env`, `var/`, SQLite files remain untracked; no other owner's files edited. (The one cross-owner touch is a test that reads Maricella's `next.config.mjs` rewrite, from Batch 2.)

## Universal quality questions

1. **Exact input/output and commit** — e.g. ambiguous task injected → worker → `needs_input` (question `scope`) → `POST .../answers {revision:1}` → revision 2 → ready, answers visible, revision-2 artifacts only. Proof: tests above, on base `b442c71` + uncommitted changes. Fake engine; not the real behaviour.
2. **Checks executed** — table above; all exit 0.
3. **Labels** — engine: stub in the repo, fake in tests (labelled in file headers); delivery: stub (outbox → simulated); fixtures: foundation placeholders; Gmail/WhatsApp/live model: disconnected. DTOs carry `generationMode` and `ingestionMode`.
4. **Contracts** — unchanged; CCR-1 proposed, not merged.
5. **Safe failure** — invalid input is 4xx with no write; dropped attachments fail the task before the engine; engine/delivery failures keep ready files and do not rerun generation.
6. **Persistence** — revision, answers, history, jobs, events and review state are in SQLite; restart/replay evidence from Batch 2 tests still passes; process-level races use a shared DB file. Browser refresh NOT RUN.
7. **Boundaries** — none crossed; no network calls; no credentials used; API-response leak scan from Batch 2 still passes.
8. **Open items** — BLOCKED: engine merge (Joanne), UI merge (Maricella), Eden QA; blocks the integrated gate. NOT RUN: Docker, live providers, browser flows.

## Known limitations
- `answer_history` question text is not exposed to the UI (CCR-1).
- `TaskDetail.sources` shows the latest revision that has stored sources; while a new revision is still running it keeps showing the previous revision's sources.
- A task that lost an attachment at intake cannot succeed by retry (same stored input); the user must send a new email with smaller files.
- Gmail polling still pre-filters oversized files; the new intake warning gives the reason from the declared size.

## Handoff
- Joanne: push `engine` (or give Darren a commit). Fixture content and real report/ambiguous/no_action outcomes are the next gate items. Ambiguous question ids must be stable strings.
- Maricella: push `experience`; answers/retry/review semantics are in `docs/backend-handoff.md`. Please answer CCR-1.
- Eden: once a candidate is committed and pushed, Darren will post the exact hash; reproduce defects with the status/body/task/revision pattern.
- Darren (next): commit and push on the user's say-so, create `integration` when branches exist, merge `engine` then `experience`, run all four fixtures through the real worker, inspect both Office files, check review in a browser, record evidence in `integration.md`.

Suggested integrated gate status: **BLOCKED**.
