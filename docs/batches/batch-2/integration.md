# Batch 2 integration checkpoint

Recorded by: Darren (Person 1). Date of check: 2026-10-23.

## Status: **BLOCKED — integrated gate not run**

| Item | Value |
|---|---|
| Foundation commit | `5d8f342` |
| `origin/main` | `5d8f342` |
| `origin/platform` | Batch 2 platform work `e5b8510` (parent `5d8f342`), plus a docs-only commit recording this hash |
| `origin/engine` (Joanne) | **does not exist** |
| `origin/experience` (Maricella) | **does not exist** |
| Merged integration commit | none |

`git fetch origin` and `git branch -r` at the end of the session list only `origin/main` and `origin/platform`.

## What was checked on the platform side (not an integration result)

Platform commit state: `e5b8510` on `platform`. Foundation engine and delivery stubs, placeholder fixtures.

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (74 tests), `pnpm build`: exit 0.
- Two-process live run (API :4177, worker) with a temp DB: `POST /v1/demo/inject` via `pnpm demo:proposal` → task `a6a7547c-f612-4305-91e5-3f7ac5bc9faf` rev 1 → worker `job.start` → task `failed` with `ENGINE_NOT_IMPLEMENTED` (engine stub, `retryable:false`). Worker heartbeat healthy. This is the correct honest behavior of a missing engine, not a pass.
- Ready/review/download/notification path: proven only with test-only fake engines (`apps/worker/test/worker.test.ts`, `packages/data/src/testing.ts`).

## Gate checklist (shared smoke list items touched by Batch 2)

| Step | Status | Note |
|---|---|---|
| Start app, API, worker from documented commands | PASS (API + worker); web is the foundation stub | `pnpm dev` verified at foundation; two-process run today |
| Log in, refresh, session survives | PASS (API level) | browser refresh NOT RUN (no UI) |
| Inject proposal fixture through the API | PASS | task id above |
| Real progress then ready | BLOCKED | needs Joanne's engine |
| Previews, real DOCX/PPTX download, open outside app | BLOCKED | needs engine + UI |
| Mark reviewed, refresh, state survives | PASS (API restart test); browser NOT RUN | |
| Replay key → no duplicate | PASS | 25 concurrent HTTP, 6 processes |
| Worker stop/restart recovery | PASS (unit, fake engine) | real-engine drill is Batch 5 |
| Outbox honest status | PASS (simulated/blocked only) | |
| Mobile-size browser | NOT RUN | UI owner |

## Exact steps to complete the gate when branches arrive

1. Joanne pushes `engine`; Maricella pushes `experience` (both from `5d8f342`).
2. Darren creates `integration` from `platform`, merges `engine`, then `experience`. Conflicts only expected in `pnpm-lock.yaml`: rerun `pnpm install` and review the dependency diff; do not pick a side blindly.
3. On macOS 27 build native deps with full Xcode (see `docs/backend-handoff.md`).
4. Run `pnpm install && pnpm setup:local && pnpm check:ready && pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
5. `pnpm dev`, then `pnpm demo:proposal`. Expect task → `planning` → `running` → `ready` with `Proposal` DOCX and 5-slide PPTX in the task's artifacts.
6. Download both through `/api/artifacts/<id>/download` while logged in; open in Word/PowerPoint (or record that no renderer was available); record filenames, sizes, SHA-256.
7. Mark reviewed; reload; restart API; reload again.
8. Record the merged commit hash here and flip the status above.

## Owners of what is missing

- Real `runWork`, real fixtures, real DOCX/PPTX: **Joanne**.
- Dashboard, previews, download buttons, review button, outbox display: **Maricella**.
- Merge, integration run, platform failures: **Darren**.

Do not start Batch 3 until this file records a passing merged commit.


## Batch 3 status (appended)

Re-checked with `git fetch origin`: still only `origin/main` (`5d8f342`) and `origin/platform` (`b442c71`). No `engine`, `experience` or Eden QA branch. The Batch 2 gate remains **BLOCKED**, so Batch 3 is also **BLOCKED** at the integrated level.

Platform-only Batch 3 work (fake-engine tests, 98 tests, all checks exit 0) is described in `docs/batches/batch-3/darren.md`. It does not close either gate. When the branches exist, follow the numbered steps above, then run all four scenarios through the real worker and record the merged commit, task ids/revisions and Office file metadata here.
