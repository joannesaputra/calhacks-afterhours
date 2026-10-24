# Batch 6 — integration record (Darren)

Candidate: `0e8395ed18941cd08e99e1c64b0b6a421a0eb3dd` (identity, versions and the command ledger are in `docs/release/candidate.md`). Mode of every observation below unless stated: **demo intake, fixture intelligence, outbox**. No Gmail, model, WhatsApp, Docker or remote host was involved.

## I1. Reality check (what exists today)

| Piece | Reality on `origin` / this machine |
|---|---|
| Platform (data/API/worker/contracts/runtime) | real, tested; Batch 5 `platform-batch5` @ `d11127b` pushed |
| Engine | real, Joanne's `person-2-engine` @ `de6bd40`: fixture planning, CSV calculation, DOCX/PPTX; OpenAI path exists but was never run. No newer engine branch. |
| Web UI | **no experience branch exists**. The only UI is Darren's uncommitted SpaceXAI working tree, snapshotted (unchanged) in `664cc98`. |
| Delivery | foundation stub (outbox simulated; live always blocked); no Twilio adapter |
| Browser e2e suite | absent (`tests/e2e` empty; `pnpm test:e2e` prints SKIPPED) |
| Maricella's demo script / claim note, Joanne's artifact audit document | not present in the repository; Joanne's earlier evidence is in `docs/engine-evaluation.md` |
| Credentials | none: no Google, OpenAI or Twilio value in the test environment (names only) |
| Tools | Node 20.20.2, pnpm 10.33.4; Docker missing; Microsoft PowerPoint, Keynote and Pages are installed but were not driven (macOS Quick Look thumbnails were used) |

## I2. Primary flow on the frozen candidate (proposal + deck)

Rehearsal 1 task `d61c2bcf-516d-493b-8682-8a8d9b3db67c`, rehearsal 2 task `91a99c48-90e4-4827-88c5-c50d3e4ac969`, both `ready`, revision 1, `demo`/`fixture`, two artifacts. For the rehearsal-1 task the files were downloaded through the authenticated API independently of the worker: `pptx` and `docx` sizes and SHA-256 equal the manifest (MATCH), `Content-Type` the Office types, `Content-Disposition: attachment` with a sanitized filename, `Cache-Control: private, no-store`. The PPTX has 5 slides with speaker notes; the DOCX contains the proposal. Quick Look rendered page 1 of the DOCX: headings and both tables (scope, timeline and fee) are real tables (before the DEF-4 fix the scope table rendered as one-character columns). Review: "Mark reviewed" → `approved`, event "Marked reviewed. Nothing was sent."; repeat or stale revision → 409.
Clarification: rehearsal-1 task `5e159859-35cf-4ad0-ac31-961159caed52` and rehearsal-2 task `945cc7eb-46fa-49e0-86dc-a75e9685a82b`: `needs_input` with four specific questions, answers produced revision 2, `ready`, two files, the answered client name in the products, four answers saved, revision-1 events kept.

## I3. Secondary flow (report + deck)

Tasks `58bde31b-0247-49bd-81d9-a5dc5d37f530` (R1) and `9419a0c5-e61f-42aa-90cd-a81c0fc5e03e` (R2). Rehearsal-1 files: sizes/SHA-256 MATCH; DOCX text contains $12,000, $15,000, +$3,000, 25%, orders 120 and 150, AOV $100, website share 66.7% in both months; the PPTX has 5 slides and one native chart whose values are 12000 and 15000 (categories 2026-01, 2026-02). The narrative is derived from the computed metrics (QA suite B and C pass; regression tests for a changed February and for a zero-order month). Quick Look page 1 of the report DOCX shows readable tables. Cosmetic: the chart table prints raw `12000`/`15000`.
No-action tasks `c958790f-1994-4339-bb32-39a4ef2c83cd`, `b50a9588-2c9a-49c3-b45c-a1f9e4b53881`: `skipped`, 0 files, no notification, title is the email subject (`FYI: October studio newsletter`).

## I4. Access, state and replay (HTTP against the built runtime)

Unauthenticated: tasks, task detail, settings, notifications, integrations, artifact download, demo inject, review → **401** each. CLI bearer token: tasks, settings, download → 401; `POST /v1/demo/inject` with a valid token → 200; wrong token → 401. Browser mutation with a foreign `Origin` → 403. Path-shaped artifact id (`..%2F..%2Fetc%2Fpasswd`) → 404. Review of an already approved task → 409; wrong revision → 409. `?cursor=!!!` → 400. Injection with the same `replayKey` twice → same `taskId`, `deduplicated:false` then `true`. The QA suite adds oversized/unsupported input, clarification races, lease/stale-owner checks and access matrices (50/53, below).

## I5. Live mode without a key (honest failure, no fallback)

A second API + worker pair with `GENERATION_MODE=live MODEL_PROVIDER=openai`, no key or model name, throwaway database: `GET /integrations` → `model:{mode:"live",provider:"openai",configured:false,model:null}`; the injected task → `failed`, `MODEL_NOT_CONFIGURED`, `retryable:false`, 0 artifacts, no fixture output; login and settings stayed available (settings 200). The message never names a key variable. A successful live generation was **never** exercised: BLOCKED.

## I6. Restart, persistence, backup (built runtime, local processes)

`SIGTERM` to API and worker (`worker.stopped` logged, no leftover `-wal` file), restart with the compose commands: the task list (10 tasks, one `approved`, two at revision 2) and the artifact manifest were **identical** before and after, all 14 manifest files re-hashed OK, worker health `healthy:true`, `pnpm check:worker` exit 0. `pnpm backup -- create` on the running stack → tasks 10, artifacts 14 (753,318 bytes), notifications 7, schema 3; `verify` exit 0; `restore` into a new directory verified. Platform code is unchanged since `d11127b`, so Batch 5's kill/lease/quiet-hours/closed-browser evidence applies (candidate doc); those drills were **not** repeated here. Docker, remote host and a real overnight run: NOT RUN / BLOCKED.

## I7. Hygiene

`git ls-files` contains no `.env`, database, DOCX/PPTX or key file; credential-pattern scans of the tree and of all 31 commits found nothing except a fake key string used by a redaction test; `.env` and `var/` are ignored; `.env.example` has empty secrets. Worker and API logs of the rehearsals contain 0 error lines and none of the words password/secret/token. No process outside the test was touched, every directory removed was a scratch one, no external message or paid call was made.

## Rehearsals (same candidate, no database edits, throwaway password never shown)

| | Rehearsal 1 | Rehearsal 2 |
|---|---|---|
| Proposal (button → ready, API) | 2.0 s | 1.9 s |
| Report | 1.1 s | 1.1 s |
| No-action (skipped) | 1.0 s | 0.9 s |
| Unclear request → questions | 3.2 s | 1.1 s |
| Answers → ready (revision 2) | 0.6 s (worker log) | 1.1 s |
| Review, refresh | proposal approved (UI click), state kept across a service restart | proposal approved (UI click) |
| Failures | none | none |

Not covered: Maricella's own demo (her script does not exist), mobile and keyboard on this candidate, the browser-closed observation (Batch 5).

## QA system suite (`0e8395e`, 53 tests): 50 pass, 3 fail

History on the same suite: Batch 5 (engine `de6bd40`) 44/53 with DEF-2/3/4 failing; after the isolated engine fixes: 50/53. Remaining:
- **A4** (P2, test expectation drift): preview/file headings match; the test's needle `October 26-November 22, 2026` is the old date format, the engine now prints `October 26, 2026 (4 calendar weeks)`. Fix: update the QA expectation or the engine format (Joanne).
- **A5** (P2): evidence carries source ids but no verbatim quotes; the test requires at least one. Product impact: traceability is by source id only. Owner: Joanne.
- **I1** (P2): an injection-only brief yields `ready` from the email body with no warning. Verified directly: the injected text and `attacker@example` appear in the *sources list only*, not in any product or file. Strict expectation was "fail closed". Owner: Joanne to decide.

## Defects and owners

| ID | Sev | Finding | State | Owner / commit |
|---|---|---|---|---|
| DEF-4 | P1 | DOCX tables had no grid; rendered as one-character columns (QA N3.1, confirmed visually) | fixed + test | Joanne to review, `8bcdbb4` |
| DEF-2 | P1 | report narrative, title and notes were fixed text that contradicted other CSVs | fixed + tests | Joanne to review, `68ea1ec` |
| DEF-3 | P1 | "Four-week" labels contradicted answers choosing another schedule | fixed + test | Joanne to review, `f6e3be1` |
| DEF-6 | P2 | skipped FYI mail titled as a proposal | fixed + test | Joanne to review, `15b15f8` |
| UI-1 | P2 | login did not return to the opened deep link | fixed + test | `79a35af`, `1e29d42` |
| Lint on merge | P2 | `no-control-regex` in my own new helper, found by the clean run | fixed | `1e29d42` |
| A5, I1, A4 | P2 | see above | open | Joanne |
| UI-2 | P2 | evidence shown as raw source ids; Gmail error notice lacks the reason | open | UI owner |
| UI-3 | P2 | hidden-tab refresh behavior (status.md item 7) | open, not diagnosed | UI owner |
| DEL-1 | P1 for any live-notification claim | no Twilio/WhatsApp adapter; digest text has no task list | open (feature freeze: not started) | Maricella |
| E2E-1 | P1 for the browser-gate claim | no automated browser suite | open | Maricella |
| EXT | blocked | Gmail, model, WhatsApp credentials; Docker; host | BLOCKED | Darren/operator |

## Handoff

- Joanne: review or replace the four engine commits; decide A4, A5, I1; supply the artifact audit and capability limits for the matrix.
- Maricella: demo script and video-claim note aligned to `docs/release/status.md`; the delivery adapter if WhatsApp is to be claimed; a browser suite; display of evidence.
- Darren: decide whether to push `platform-batch6` (UI snapshot inside); run Docker and host checks when available; live smoke only with designated credentials.
- Both teammates can reproduce with the commands in `docs/release/status.md` at commit `0e8395e`.
