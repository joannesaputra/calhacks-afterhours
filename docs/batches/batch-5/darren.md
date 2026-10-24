# Batch 5 — Darren (platform: durable overnight operation and recovery)

- **Branch:** `platform-batch5`, created from local `platform-batch4` @ `af24fef` (three commits ahead of `origin/platform-batch4` @ `700d7a6`; `platform` and `main` untouched, nothing merged anywhere).
- **Candidate:** implementation commits `0af9ff3` (fenced publication, scheduling, notification membership/bookkeeping, worker) and `56977d6` (backup/restore, worker health probe, compose). Tests, runbook and these reports are in `9bfd28b`; every result below was produced on the tree that became `9bfd28b` (this line and the next commit only record it).
- **Team branches seen on origin today:** `main` `5d8f342`, `platform` `aaed3db`, `platform-batch4` `700d7a6`, `person-2-engine` `de6bd40`. No `engine-batch5`, no experience branch, no Maricella branch.
- **Credentials:** the test environment was built from scratch with fixture mode and the outbox. No Google, OpenAI/model or Twilio value existed anywhere in it, so every live check is **BLOCKED**, not failed.
- **Tools missing here:** Docker is not installed (`docker: command not found`), so every container check is **NOT RUN**.

## What changed (owned files only)

| Area | Files |
|---|---|
| Fenced publication, orphan cleanup | `packages/data/src/artifacts.ts` (`stageArtifactFiles`, `promoteStagedFiles`, `verifyStoredFiles`, `cleanOrphanArtifacts`), `packages/data/src/queue.ts` (`jobStillOwned`, immutable manifest insert) |
| Pure schedule + settings validation | `packages/data/src/schedule.ts`, `packages/data/src/settings.ts` |
| Notification membership, seal, stale-policy, send marker, recovery | `packages/data/migrations/003_batch5_durability.sql`, `packages/data/src/notifications.ts` |
| Worker | `apps/worker/src/worker.ts` (abort backstop, ownership re-check before promotion, send marker, stale-policy block, fault seams), `apps/worker/src/runtime.ts` + `main.ts` (shared shutdown handlers) |
| Backup/restore, health | `packages/data/src/backup.ts`, `scripts/backup.ts`, `scripts/worker-health.ts`, root `package.json` scripts |
| Runtime | `docker-compose.yml` |
| Tests | `packages/data/test/batch5-{schedule,notifications,artifacts,backup}.test.ts`, `apps/worker/test/batch5.test.ts` + `test/support/worker-child.ts`, `apps/api/test/batch5.test.ts`; two Batch 4/older assertions updated for the intentional path/marker change |
| Docs | `docs/runbook.md`, `docs/backend-handoff.md`, `docs/contract-change-requests.md`, this file, `integration.md` |

No public DTO, route, status, error code or environment variable changed (`.env.example` untouched). Root dependencies and the lockfile are unchanged.

## Defects found in the existing platform and fixed

How each was found: **reproduced** = run on the Batch 4 code; **code review** = read from the Batch 4 source, with new tests asserting the corrected behavior (not run against the old code).

1. **A stale attempt could overwrite the winner's file** (code review). Batch 4 renamed files onto one shared path per task/revision/product/format *before* the DB ownership check, so an old process finishing late replaced the winning bytes (the DB commit was then rejected, the file stayed corrupted). Now: attempt-private staging, ownership re-check, immutable content-qualified paths via hard link (never overwritten), bytes re-verified against the manifest, manifest row immutable.
2. **A result that arrived after a digest was claimed was lost or sent inside quiet hours** (code review). Joining a leased digest changed membership after the snapshot (task never notified), and the "digest already left the queue" fallback created an immediate row during quiet hours. Now: membership sealed at claim, follow-up digests, one member row per revision per channel enforced by a UNIQUE constraint.
3. **A digest slot inside quiet hours was scheduled inside quiet hours** (reproduced): quiet 22:00–08:00, digest `00:30`, ready `2026-10-24T08:00:00Z` (01:00 PDT) → scheduled `2026-10-25T07:30:00Z` (00:30 PDT, inside quiet hours). Now `2026-10-24T15:00:00Z`.
4. **Late workers sent in quiet hours** (code review). Dispatch never re-evaluated quiet hours. Now it does (defer, merge overdue digests).
5. **A queued live message ignored later Settings edits** (code review). Switching the channel to outbox, or editing the recipient, still sent the queued WhatsApp message. Now blocked as `POLICY_CHANGED`.
6. **Every expired live notification lease was called "uncertain"** (code review), even when the provider was never contacted, and nothing recorded when a submission began. Now a durable `submit_started_at` marker separates "died before the provider" (retry) from "may have been accepted" (`DELIVERY_UNCERTAIN`, never resent).
7. **A worker could wait forever on an engine that ignored the abort signal** (code review: the deadline only aborted the controller). Now the deadline or a lost lease frees the worker.
8. (code review) Settings accepted `UTC+3` as a "timezone" and silently treated equal quiet start/end as "never quiet". Now 400.

## Commands and results

| Command | Where | Exit | Result |
|---|---|---|---|
| `pnpm install --offline --frozen-lockfile` | `platform-batch5` | 0 | no dependency change |
| `pnpm typecheck` | `platform-batch5` | 0 | |
| `pnpm lint` | `platform-batch5` | 0 | |
| `pnpm build` | `platform-batch5` | 0 | |
| `pnpm test` | `platform-batch5` | 0 | 20 files, 217 tests (Batch 4 baseline 14 files, 147; +70 new, 2 existing assertions adjusted) |
| `pnpm typecheck && pnpm lint && pnpm test` | scratch integration tree (`platform-batch5` + merge of `origin/person-2-engine` `de6bd40` + the uncommitted SpaceXAI UI) | 0, 0, 0 | 21 files, 232 tests |
| QA system suite (`tests/system/*.test.mjs` from the QA worktree, `QA_REPO_ROOT` = integration tree) | integration tree | 1 | 53 tests, 44 pass, 9 fail (engine/QA-expectation items, see `integration.md`); **control** run on `platform-batch4` + the same engine: identical 44/9, same nine tests, so Batch 5 added no regression |
| real API + worker + web stack, closed-browser, quiet-hours, restart, backup drills | integration tree, local processes | n/a | see `integration.md` |
| `docker compose ...` | | | **NOT RUN** (no Docker) |

Fakes in the automated tests: the engine (`marked`/`readyResult`), the delivery adapter, time (`now` injected). Child processes in `worker-child.ts` are real worker processes with real signals but a fake engine. None of them proves live Gmail, a live model, a live provider send, Office rendering or an elapsed overnight run.

## Scheduling policy (decided before coding)

Full text and examples: `docs/runbook.md` → "Notifications and quiet hours". Summary: outside quiet hours deliver immediately; inside, deliver at the first `digestTime` occurrence at or after now when `digestTime` is outside the window, otherwise at the end of the window; window `[start, end)`; DST gap moves forward, overlap picks the earliest occurrence not before now; local-calendar days, never now + 24 h; equal enabled start/end and non-IANA zones are rejected; groups are one digest per local date and channel, sealed at claim, follow-up digests afterwards. This clarifies the Batch 4 behavior and fixes its quiet-hours violation (defect 3); it adds no public API.

## Role questions

1. **Which restart/lease/stale-owner tests ran, and what prevents duplicate publication?** PASS. Existing: `queue.test.ts` (competing claim, expired lease recovery, stale owner rejected, attempt limit, second commit rejected), worker "restart" and "graceful shutdown". New (`apps/worker/test/batch5.test.ts`): attempt 1 frozen after staging and after promotion, lease expiry, attempt 2 wins, attempt 1 resumes late (twice); unexpired lease not stolen; real child process `SIGKILL` during generation (lease still valid, rival gets nothing, recovery after 95 s, attempt 2, one manifest, one intent); `SIGTERM` real handler (exit 0, released, attempt not consumed). Prevention: `UNIQUE(task, revision, product, format)`, job `done` after commit, owner-token + revision fence, ownership re-check before promotion, immutable hash-qualified paths, manifest insert refuses a conflicting row.
2. **At each crash boundary, which files/rows/intents remain; can a partial result appear ready?** PASS (no). During generation: lease row only, no files. After staging: staging directory only (removed on exit; after a kill it is removed by `cleanStaging` once older than 1 h), no final file. After promotion before commit (real `SIGKILL`): two unreferenced files, zero manifest rows, task `running`, no intent; the retry's manifest never references them and their hashes are unchanged afterwards. After the ready commit before notification: ready + manifest + exactly one intent, engine not rerun, restarted worker delivers once. During provider submission: `submit_started_at` set, see Q11. An incomplete or invalid set stages nothing (`valid first file + bad second file` leaves no final file).
3. **At 23:30 local, when is the digest scheduled and does generation finish?** PASS. `2026-10-24T06:30:00Z` (23:30 on Oct 23) → `2026-10-24T15:00:00Z` (08:00 PDT), local date `2026-10-24`: pure test, controlled-clock worker test (both tasks `ready` with 2 files before any delivery, nothing sent) and a real run (task `ready` ~1 s after injection while quiet hours were active; see integration).
4. **Which DST/midnight/restart tests prove grouping with no duplicate entries?** PASS. `batch5-schedule.test.ts` (19): spring forward Mar 7 23:30 PST → `2026-03-08T15:00:00Z` (7.5 h, not 24 h), results either side of the missing hour share the digest, a digest slot in the gap → `10:30Z` (03:30 PDT), a quiet end in the gap; fall back Oct 31 23:30 PDT → `2026-11-01T16:00:00Z` (9.5 h), both occurrences of 01:30 → one local-date group, repeated-hour wall time picks `08:20Z` vs `09:20Z` correctly; after-midnight arrival; window edges; same-day window; Asia/Tokyo. `batch5-notifications.test.ts`: reopened database keeps rows, schedule and members; a late-night arrival after restart joins the same digest.
5. **Are generation retries separate from notification retries, including uncertain deliveries?** PASS. Worker tests: three transient notification failures (backoff, stop at 3) and a provider timeout (`DELIVERY_UNCERTAIN`, one submission) leave `tasks`, `jobs` (status/attempts) and `artifacts` byte-for-byte unchanged and the engine called once; recovery also never touches them.
6. **Which persistent host/volume/config path was exercised versus authored?** Exercised: the exact compose commands (`node --import tsx apps/{api,worker}/src/main.ts`) as local processes against a persistent local directory, restarted by `SIGTERM`; backup/restore into a separate directory. Authored only: `docker-compose.yml` changes, volume, `init`, healthchecks, HTTPS. Docker **NOT RUN**; remote host **BLOCKED**.
7. **Does browser closure leave the worker processing; what happens on host sleep?** PASS for closure: the worker process was paused with `SIGSTOP`, a demo request was created from the browser, the browser pane was closed, then the worker was resumed and finished the task with no browser open (timeline in `integration.md`); the reopened browser showed the result. The `SIGSTOP` is a test device to order the events, not a claim about sleep. Host sleep: **NOT RUN** (not simulated); documented as stopping all processing (timers and worker).
8. **Can the runbook recover a stopped service without losing approved work/artifacts?** PASS for local processes (restart kept tasks, approved state, manifests, settings, worker health; backup restored into a new directory verified rows + SHA-256). **NOT RUN** under Docker and on a host.
9. **What prevents a stale attempt corrupting winning physical files beyond rejecting its DB commit?** PASS. Different bytes → different path; `link()` never replaces; identical path with different bytes is refused; ownership is re-checked before promotion. Tested with an independent byte/hash/mtime comparison of the winner's files after a deliberately late stale attempt (`batch5-artifacts` and worker tests).
10. **Which digest-member/settings-change races were exercised?** PASS. Task ready before the claim → in the snapshot, in order; after the claim → follow-up digest `…/2`, sealed row unchanged, each task delivered exactly once; arrival while a sealed digest is backing off after a retryable failure → follow-up; replay of the intent on either route → no-op; DB refuses a duplicate member; two overdue digests for different dates merge without loss; quiet-hours edit with a queued entry keeps its schedule and new work uses the new settings; channel/recipient edits → `POLICY_CHANGED`, provider not called (data + worker tests); no phone number appears in any DTO or claim (asserted); the fingerprint is not part of any DTO by construction.
11. **Process death during an externally submitted notification before the response is persisted?** PASS (fake provider). Marker set, process frozen, lease expires → `failed` + `DELIVERY_UNCERTAIN`, provider call count 0 by the survivor, never claimable again, task/jobs/artifacts unchanged; a late result from the old process is refused (`completeNotification` returns false). Death before the marker → released and retried. A transient rejection clears the marker; a later death is uncertain again.
12. **Which exact local/UTC/DST/equal-time/late-start examples passed?** PASS. See Q3/Q4; equal enabled start/end → 400 over HTTP and in the data layer with the message "…same time, which is ambiguous…"; invalid zone `Not/AZone`, `UTC+3` and times `9:00`, `24:00` → 400; stored equal → treated as no quiet hours; late start in quiet hours → deferred to `2026-10-25T15:00:00Z`; late start outside quiet hours → one immediate dispatch.
13. **Was a consistent backup restored to an isolated location and checked?** PASS. Unit tests (WAL file present while backing up; changes after the snapshot do not leak in; tampered/missing artifact and non-empty destinations refused) and a real run against the running stack: tasks 3, artifacts 6, 309,425 bytes, notifications 2, schema 3; `verify` exit 0; `restore` into a new directory exit 0 and verified; second restore refused, exit 1.
14. **Which runtime/volume/proxy/cookie configuration actually ran?** Ran: API on loopback only, worker as a separate process, Next dev proxy `/api/*` → API, `PUBLIC_APP_URL` over `http`, login through the proxy. Cookie flags were not re-inspected in this run (Batch 4 evidence and the session unit tests cover them). Prepared only: Docker volume permissions, `init`, healthchecks, `Secure` cookie under real HTTPS (covered by an existing unit test, not re-run through a TLS proxy), OAuth callback on a public host.
15. **Which earlier real integration checks remain blocked and what independent work was done?** Live Gmail, live model, live WhatsApp remain **BLOCKED** (no credentials/eligibility). Independent: everything above ran with fixtures, the real engine in fixture mode, and the outbox.

## Universal questions

1. **Input/output and candidate:** `0af9ff3` + `56977d6` (+ tests/docs commit); examples are the expected-vs-observed values above and in `integration.md`.
2. **Checks and exit codes:** table above.
3. **Modes:** intake demo; intelligence fixture (real engine `de6bd40` in the integration tree, fake engines in unit tests); delivery outbox/simulated or fake provider; time controlled except one real ~4-minute elapsed run. No live label was used or claimed.
4. **Contract and policy match:** DTOs, routes, states, env unchanged; tightenings listed in `contract-change-requests.md`; scheduling policy documented in the runbook before the tests were written.
5. **Failure without fake success:** unusable stored schedule → immediate with a warning event (a ready commit never fails on it); hung engine → deadline; uncertain send → failed and never resent; stale intent → blocked; backup of a damaged file → refused.
6. **Persistence:** manifests, approved state, settings, schedules and digest membership verified across `SIGTERM` restarts of the real stack and across a reopened database in tests.
7. **Boundaries:** no secret in any report, log line, DTO or commit; the fake WhatsApp recipient numbers in tests are `+1555…` placeholders; no external call or message was made; every killed or stopped process was started by the test, every directory removed was a scratch one; no system clock change.
8. **Remaining:** FAIL: 9 QA-suite checks that need engine/QA triage (Joanne, `integration.md`). BLOCKED: live Gmail/model/WhatsApp, remote host. NOT RUN: Docker build/up/restart, host sleep, hard kill of a real-engine job (it finishes in ~50–100 ms), Office visual rendering, a real all-night run. These keep the live-core and deployment gates open; they do not block the local Batch 5 platform gate.

## Next handoff

- **Joanne:** triage `A4`, `A5`, `I1` (new with engine `de6bd40`) and the known DEF-2/3/4/6 items; honour `AbortSignal`.
- **Maricella:** schedule/failure presentation notes in `docs/backend-handoff.md`; fix login to return to the opened deep link; delivery adapter timeout < 60 s with `DELIVERY_UNCERTAIN`.
- **Darren (me):** push `platform-batch5` only when told; decide how `platform-batch4`'s three unpushed commits and this branch are merged; run the Docker and host checks when Docker/host access exists.
