# Batch 5 — integration record (Darren)

Honest status: **local platform gate PASSES on the integration candidate; the live-core and deployment gates stay open.**
Nothing here is a production-readiness or overnight-trial claim. No branch was merged and nothing was pushed to `platform` or `main`.

## Candidate actually tested

| Part | Source |
|---|---|
| Platform | `platform-batch5` @ `9bfd28b` (code `0af9ff3`, `56977d6`; tests/docs `9bfd28b`) on `platform-batch4` @ `af24fef` |
| Engine | `origin/person-2-engine` @ `de6bd40` (fetched 2026-10-23), merged **uncommitted** into a scratch worktree (clean merge, no conflicts; the lockfile is the merge result of the engine branch's changes, with no manual edit) |
| Experience | Darren's SpaceXAI UI: the **uncommitted** working tree of the `ui/spacexai-style` checkout, copied into the scratch tree. There is still no experience branch from Maricella, so no teammate-owned UI was tested. |
| Mode | demo ingestion, fixture intelligence (real engine code, fixture scenario), outbox notifications |
| Not present | Gmail, a live model, WhatsApp, Docker, a remote host |

The scratch trees and their runtime directories live outside the repository and contain only generated test data. They were removed or are removable; nothing from them is committed.

## 1. Closed browser: work continues without any browser

Setup: real API, a separately started worker process (own PID) and the Next dev proxy, all as local processes. Clock is the real clock (UTC).

| UTC time | Event |
|---|---|
| 06:40:10 | worker paused (`SIGSTOP`) so the order of events is controlled |
| 06:40:14.857 | "Run demo proposal" clicked in the browser → task `0b92aab5-b9b1-4a4c-818c-40784e705304` created, status `queued` (page said "Being prepared. You can close this page; the worker keeps going.") |
| before 06:40:25.3 | browser tab closed; the Browser pane closed |
| 06:40:25.3 | worker resumed (`SIGCONT`) |
| 06:40:25.837 | `job.start` (attempt 1) |
| 06:40:25.929 | `job.done`, outcome `ready`, 92 ms: 2 files |
| 06:40:30.905 | notification `88f4f010…` `simulated` (outbox) |

Browser reopened: the task page showed **Ready to review**, the plan, the progress log above, source references and the content preview. Files for this task (manifest ↔ disk): `pptx` 92,951 B sha256 `6c42505d220f553e…`, `docx` 10,191 B `c87528baf902de33…`; download via the authenticated API returned HTTP 200, the right MIME types and `Content-Disposition`, identical sizes and hashes; the PPTX has 5 slides, the DOCX contains the proposal title. **Not** visually rendered (no Office viewer here): structure and text only.

What this proves: the worker completes and persists work with no browser attached. What it does not: that a host stays up (host sleep **NOT RUN**), or any live model quality (fixture intelligence).

## 2. Quiet hours, real elapsed time, with a worker restart in between

Settings set through the API: quiet `23:36`–`23:45` `America/Los_Angeles` (the real local clock was ~23:41), `digestTime` `23:45`.

| UTC time | Event |
|---|---|
| 06:41:07 | two demo proposals injected with the CLI (real HTTP POST, bearer token): tasks `1c5540ea-7ec6-49df-98f9-3e62db8c5347`, `62cb82ec-e33f-47d1-be8e-e711cd1e03f8` |
| 06:41:07–08 | both `ready` with 2 files each (generation unaffected by quiet hours); one digest row `ebaf661e…` `queued`, `scheduled_for` `2026-10-24T06:45:00.000Z`, local date `2026-10-23`, members 2; nothing sent |
| 06:41:18 | `SIGTERM` to API and worker; `worker.stopped` logged at 06:41:18.201, exit; processes started again (`worker.start` 06:41:23.077); schedule and membership unchanged |
| 06:45:04.688 | send marker written; 06:45:04.747 `notification.done` `simulated`; digest sealed 06:45:04.021 (5 s poll loop) |

Result: exactly one digest, two members, one send, after ~3 min 57 s of real waiting across a restart. Task events show `Quiet hours: notification scheduled for 2026-10-23 …`. This is a ~4-minute real run; it is **not** an overnight trial.

## 3. Restart persistence, review, mobile

- Graceful `SIGTERM` of API and worker (twice), restart with the same commands the compose file uses (`node --import tsx apps/{api,worker}/src/main.ts`): WAL checkpointed (0-byte `-wal` after stop), tasks, manifests, settings and health intact; `check:worker` exit 0 (heartbeat fresh).
- Session expired on purpose (sessions table of the scratch database) → deep link to a task redirected to `/login` → logged in again → **landed on `/`, not on the task** (finding for the experience owner, spec asks to continue to the requested task). Opening the task again worked.
- Phone viewport 375×812: no horizontal overflow (`scrollWidth` 375 = `clientWidth`); both file downloads fetched by the page: HTTP 200, correct MIME and filename, sizes and hashes equal to the manifest (`728d449020360898…`, `16589fd9e1fd100a…`); "Mark reviewed" → `approved`; full stack restart and refresh → still **Marked reviewed**, revision 1.
- Not exercised: offline/reconnect without duplicate mutations, keyboard navigation, notification failure display (no real adapter exists; Maricella).

## 4. Backup and restore of the running stack

`pnpm backup -- create` while API and worker were running: tasks 3, artifacts 6 (309,425 B), notifications 2, schema version 3; `verify` exit 0; `restore` into a new directory exit 0 and verified (integrity, foreign keys, size + SHA-256 of every referenced file); a second restore and a create into non-empty directories refused with exit 1. The live directories were never written. Restoring over the original directories is not offered by the tool.

## 5. Prior scenarios (QA system suite, real API + worker child processes, throwaway databases)

`node --import tsx --test tests/system/*.test.mjs` from the QA worktree with `QA_REPO_ROOT` pointing at each tree:

| Tree | Result | Failing |
|---|---|---|
| `platform-batch5` + engine `de6bd40` | 44 / 53 pass | A4, A5, C4, C5, C6, N3.1 (DEF-4), H6, I1, D7 (DEF-3) |
| **control** `platform-batch4` + the same engine | 44 / 53 pass | the same nine |

Both runs are identical, so Batch 5 introduced no regression. Compared with the Batch 4 audit (47/53 on engine `258e2eb`), three checks now fail that passed then: **A4** (preview lacks "October 26-November 22, 2026"), **A5** ("expected at least one verbatim quote"), **I1** (an injection-only brief now produces a `ready` proposal). They follow the engine change (`de6bd40`), or the QA expectations, not the platform; triage belongs to Joanne. DEF-2, DEF-3, DEF-4 are unchanged. Engine lint (earlier DEF-5) now passes (`pnpm lint` exit 0 on the integration tree).

## 6. What remains

| Item | State | Owner |
|---|---|---|
| Docker `compose build/up/restart`, volume persistence under Docker | **NOT RUN** (Docker not installed) | Darren, when Docker exists |
| Remote always-on host, real overnight trial | **BLOCKED** (host access/approval) / **NOT RUN** | Darren |
| Host sleep behavior | **NOT RUN** (documented, not simulated) | |
| Hard kill of a real-engine job | **NOT RUN** (job lasts 50–100 ms); hard kill proven with a fake blocking engine in a real child process | |
| Live Gmail, live model, live WhatsApp | **BLOCKED** (no credentials/eligibility) | Darren / operator |
| Office visual rendering | **NOT RUN** (no viewer); structural checks only | Joanne |
| QA suite A4, A5, I1 and DEF-2/3/4/6 | **FAIL** (engine side) | Joanne |
| Login does not return to the opened deep link; real delivery adapter and its timeout/uncertain mapping; offline/keyboard checks | open | Maricella |
| Push `platform-batch5`, push/merge `platform-batch4`'s three commits, any `platform`/`main` change | **not done, awaiting Darren's decision** | Darren |

Exit-gate reading: the platform-owned parts of the Batch 5 gate (recoverable persisted jobs, fenced publication, quiet-hour/digest scheduling across restart, safe notification failures, real files without a browser, consistent backup/restore, mobile review of the SpaceXAI UI) are demonstrated locally. The full gate also needs a teammate-owned UI, live integrations and a deployed host; those are open as listed.
