# Backend handoff (Person 1 — platform and integration)

## Foundation commit

Foundation commit: see `git log --oneline` for the commit titled **"Foundation: workspace, contracts, platform
backend, stubs"** on `main`. Branch from that exact commit:

| Branch | Owner | Owns |
|---|---|---|
| `platform` | Person 1 | root config, lockfile, Docker, `packages/contracts`, `packages/data`, `apps/api`, `apps/worker`, platform docs |
| `engine` | Person 2 | `packages/engine` (+ its package.json/tests), `fixtures/**`, engine docs |
| `experience` | Person 3 | `apps/web` (+ package.json, next.config), `packages/delivery`, `tests/e2e/**`, UX/demo/notification docs |

Do not edit another owner's paths, migrations, API routes, shared types, root dependencies, or the lockfile without
coordinating. Contract changes go through `docs/contract-change-requests.md`.

**Stubs ready for replacement now:**
- `packages/engine/src/index.ts` — throws `EngineError("ENGINE_NOT_IMPLEMENTED")`. Person 2 replaces; keep exports.
- `packages/delivery/src/index.ts` — outbox returns `simulated`, WhatsApp returns `blocked`. Person 3 replaces.
- `apps/web/app/*` — labeled foundation screen. Person 3 replaces. Keep the `/api` rewrite in `next.config.mjs`.
- `fixtures/**` — minimal valid placeholders (text marked FOUNDATION PLACEHOLDER). Person 2 replaces content;
  keep paths, the `DemoFixture` shape, and sender addresses under a `.example` domain. Each attachment's
  `sizeBytes` in the envelope must equal the real file size (the loader verifies it).

## Toolchain (verified on the dev machine)

- Node 20.20.2, pnpm 10.33.4 (`packageManager` pinned). `engines.node >= 20.19`. Docker image: Node 22.
- TypeScript ~5.9.3, Vitest 4, ESLint 10 + typescript-eslint, Zod 4, Fastify 5, Next 16.4.3, React 19.3.1,
  better-sqlite3 12.11.1 (v13 needs Node 22+, so it is pinned to 12).
- **macOS 27 / Xcode note:** if `better-sqlite3` cannot download a prebuilt binary it compiles from source, and the
  Command Line Tools linker fails on the macOS 27 SDK (`tapi error: malformed file ... unknown architecture`).
  Fix by building with full Xcode:
  ```bash
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  export SDKROOT=$DEVELOPER_DIR/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.4.sdk
  pnpm install
  ```

## Scripts (all exercised locally unless noted)

| Command | Result in this environment |
|---|---|
| `pnpm install` | OK (with the Xcode env above). |
| `pnpm setup:local` | OK; second run is a no-op ("No missing secrets to generate"). |
| `pnpm db:migrate`, `pnpm db:seed` | OK. |
| `pnpm check:ready` | OK (config, migrations, ports, engine/delivery exports). |
| `pnpm typecheck` | OK, all 7 packages. |
| `pnpm lint` | OK, 0 problems. |
| `pnpm test` | OK, 61 tests in 6 files (data, API, worker). |
| `pnpm build` | OK (`next build` + package type checks). |
| `pnpm dev` | OK: web :3000, API, worker started; graceful worker stop logged on SIGTERM. |
| `pnpm demo:proposal` | OK: real HTTP POST with the CLI token; task queued; worker ran it; with the stub engine it fails honestly with `ENGINE_NOT_IMPLEMENTED`. |
| `pnpm test:e2e` | Prints SKIPPED until Person 3 adds `tests/e2e`. |
| `docker compose up` | **Not exercised** (no Docker run in this environment). |

## Routes (backend paths; browser uses `/api/...`)

Implemented exactly as in `docs/CONTRACT.md` §10: `GET /health`, `POST|GET|DELETE /v1/session`,
`GET /v1/tasks`, `GET /v1/tasks/:id`, `POST /v1/tasks/:id/answers|retry|review`, `GET /v1/artifacts/:id/download`,
`GET|PATCH /v1/settings`, `GET /v1/integrations`, `GET /v1/integrations/gmail/start`,
`GET /v1/integrations/gmail/callback`, `DELETE /v1/integrations/gmail`, `POST /v1/demo/inject`,
`GET /v1/notifications`.

- Envelopes: `{ data }`, lists `{ data: { items, nextCursor } }` (default 30, max 100, `createdAt DESC, id DESC`),
  errors `{ error: { code, message, details?, requestId } }`. No stacks or secrets.
- Auth: session cookie `ah_session` (HttpOnly, SameSite=Lax, Path=/, no Domain, Secure when `PUBLIC_APP_URL` is
  https, 7 days). Mutations require `Origin` = `PUBLIC_APP_URL` origin (403 `BAD_ORIGIN`).
- `DEMO_CLI_TOKEN` bearer works **only** on `POST /v1/demo/inject` (verified: 401 on tasks/settings/etc.).
- Verified live through the Next rewrite: login cookie set and sent back, Origin enforced, OAuth callback 302
  `Location` passes through to the browser.
- Error codes the UI should handle: `UNAUTHENTICATED` 401, `BAD_ORIGIN` 403, `VALIDATION_ERROR` 400,
  `NOT_FOUND` 404, `STALE_REVISION` 409 (`details.currentRevision`), `INVALID_TRANSITION` 409,
  `RATE_LIMITED` 429, `GMAIL_NOT_CONFIGURED` 503, `DEMO_REJECTED` 403.
- Gmail callback redirect markers: `/settings?gmail=connected`, or `/settings?gmail=error&reason=` one of
  `invalid_state | expired | session | denied | no_refresh_token | exchange_failed`.

## Engine and delivery integration

```ts
import { runWork, EngineError } from "@afterhours/engine";          // worker only
import { sendNotification, composeNotification, DeliveryError } from "@afterhours/delivery"; // worker only
import type { EngineInput, EngineResult, DeliveryInput } from "@afterhours/contracts";
import { EngineResultSchema, DeliveryResultSchema } from "@afterhours/contracts";
```

What the worker guarantees / checks:
- Builds `EngineInput` from the task's immutable snapshot: stored envelope, stored attachment bytes, settings
  organization, cumulative answers, injected `now`, `mode` snapshotted at ingestion, `fixtureScenario` for demo tasks
  (`null` for Gmail).
- Live mode without model credentials fails before calling the engine (`MODEL_NOT_CONFIGURED`, non-retryable).
- `signal` aborts at 240 s. `onProgress` stages `generate|verify|export` move the task planning → running; a
  `plan` in progress is stored and shown early.
- Result validation (`validateEngineResult`): schema; every evidence `sourceId` must exist in `sources`; unique
  product IDs; exactly one file per product (`proposal|report` → docx, `presentation` → pptx); file `mimeType` must be
  the exact Office MIME; bytes must be a real ZIP with `[Content_Types].xml` and `word/document.xml` /
  `ppt/presentation.xml`. File IDs must match `[A-Za-z0-9._-]{1,200}`. Failures → `ENGINE_INVALID_RESULT` /
  `ARTIFACT_INVALID`, non-retryable, no files published.
- Errors: throw an object with `code: string` and `retryable: boolean` (`EngineError`). Retryable → one automatic
  retry after ~30 s in the same revision. Anything else becomes `ENGINE_UNEXPECTED_ERROR`.
- Delivery: throw `DeliveryError` with `code/retryable`. Retryable → up to 3 attempts with backoff.
  `DELIVERY_UNCERTAIN` is never retried. `blocked` is final, its `reason` is stored and shown.

## Data model summary (`packages/data/migrations/001_init.sql`)

`workspace_settings` (one row, validated JSON) · `sessions` (token hash only) · `oauth_states` (hashed, session-bound,
10 min, single use) · `integrations` (Gmail; AES-256-GCM encrypted tokens; checkpoint JSON) · `intake_messages`
(unique `source_key`) · `intake_audit` (bounded to 500 rows) · `tasks` · `task_attachments` (input snapshot bytes) ·
`answer_history` (old answers stay traceable) · `task_sources` · `task_events` · `jobs` (unique task/revision, lease,
attempts) · `artifacts` (unique task/revision/product/format, relative path only) · `notifications` (unique dedupe key,
lease, schedule) · `worker_status`.

Files: `ARTIFACTS_DIR/<taskId>/r<revision>/<fileId>.<docx|pptx>`, written to `.staging/` then renamed; the DB
manifest is committed only after the full set is on disk, in the same transaction as status, events and the
notification intent.

## Tested flows (automated, `pnpm test`)

Ingest dedupe across connections · unknown sender audited, no task · demo namespace cannot authorize a real sender ·
two-worker atomic claim · lease expiry recovery + stale owner rejection + attempt limit · transient retry vs
terminal failure · ready commit (manifest + one notification) · incomplete/invalid artifact set publishes nothing ·
no duplicate manifests · skipped/needs_input create no files · review only from ready, stale 409, terminal states ·
answers validation/revision bump/history · retry only from failed · planning→running on generation · quiet hours
across midnight, 23:30 → next-morning digest, spring-forward DST, nonexistent local time, digest grouping +
restart persistence · outbox immediate send, blocked final, retry backoff, `DELIVERY_UNCERTAIN` not retried, crashed
live send not resent · token encryption/tamper/refresh-token retention · session hash/expiry/revocation · OAuth state
mismatch/replay/expiry · settings validation · artifact path traversal/symlink rejection · Gmail MIME nested parts,
HTML sanitizing without fetching, overlap idempotency, no checkpoint advance past a failed fetch, revoked-token
guidance · API auth on every private route, Origin check, CLI scope, demo disable, pagination, download headers,
OAuth route flow with an injected Google port · worker end-to-end with a fake engine, stub engine fails honestly,
deadline abort, crash/restart recovery without duplicate results, graceful shutdown release, needs_input → answers →
revision 2 ready.

## Environment the humans must provide (no values here)

- Always: nothing beyond `pnpm setup:local` (generates `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `DEMO_CLI_TOKEN`,
  `APP_PASSWORD`).
- Live model: `GENERATION_MODE=live`, `MODEL_PROVIDER`, `MODEL_NAME`, and `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.
- Gmail: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (see runbook).
- WhatsApp (only if eligible): `NOTIFICATION_CHANNEL=whatsapp`, `WHATSAPP_USE_CASE_ELIGIBLE`,
  `WHATSAPP_CUSTOMER_SERVICE_WINDOW_UNTIL`, `TWILIO_*`.

## Not done / not verified — be explicit in the demo

- **Engine, real files, previews:** depend on Person 2. With the stub, no task can reach `ready` outside tests.
- **Live Gmail:** OAuth and polling code is implemented and unit-tested against a fake Gmail API, but **not tested
  against Google** (no OAuth client configured). P1 is not complete until a real new email reaches `ready`.
- **Live model:** not tested (no key; engine not merged).
- **Live WhatsApp:** not implemented (delivery stub). Outbox `simulated` is the working fallback.
- **Docker/Compose:** written, not run.
- **Shared acceptance suite / browser e2e:** waits on engine + experience merges.
- Rate limiting is per client IP as seen by the web proxy (one trusted hop).
- Gmail polling lists at most 5 pages × 50 messages and processes 10 per 15 s cycle; a backlog beyond the listing
  cap is reported as `truncated` in the poll result only.
- MIME text is decoded as UTF-8; other charsets may render imperfectly.

## Next integration step

1. Persons 2 and 3 branch from the foundation commit and replace their stubs.
2. Person 1 merges `engine` first, then runs `pnpm demo:proposal` / `demo:report` to a `ready` task and checks
   downloads open in Word/PowerPoint.
3. Then Gmail with a configured Google test client, then quiet-hours rehearsal with a controlled clock.


## Batch 3 platform semantics (clarification, revisions, state integrity)

Everything below is covered by tests that use a **fake engine** where an engine is needed. None of it proves real
document generation.

### Route and validation semantics

| Request | Success | Failure codes |
|---|---|---|
| `POST /v1/tasks/:id/answers` `{revision, answers[1..50]}` | 200 `TaskSummary`, `status: "queued"`, `revision + 1` | 400 `VALIDATION_ERROR` (empty list, non-integer revision, unknown question id, duplicate id, required question missing or blank, answer > 5000 chars); 409 `STALE_REVISION` (`details.currentRevision`); 409 `INVALID_TRANSITION` (task not `needs_input`); 404 `NOT_FOUND`; 403 `BAD_ORIGIN`; 401 |
| `POST /v1/tasks/:id/retry` `{revision}` | 200, `queued`, `revision + 1` | 409 `INVALID_TRANSITION` unless `failed`; 409 `STALE_REVISION` |
| `POST /v1/tasks/:id/review` `{revision, action}` | 200, `approved` or `dismissed`, same revision | `approve` only from `ready`; `dismiss` from `ready`, `needs_input`, `failed`, `skipped`; otherwise 409 `INVALID_TRANSITION`; stale 409 `STALE_REVISION` |
| Bad body / JSON / query / cursor | 400 `VALIDATION_ERROR` or `BAD_REQUEST` | oversized body 413 `PAYLOAD_TOO_LARGE` (limit 256 KiB); a malformed `cursor` is now 400 (it used to silently return page 1) |

Order of checks: revision first (stale wins), then state, then answer content. A failed validation writes nothing.
All checks and writes happen in one `BEGIN IMMEDIATE` transaction, so concurrent submits serialize across processes.

### Revision behaviour
- Answers and manual retry create revision N+1 and exactly one job (`UNIQUE(task_id, revision)`), in the same transaction as the status change and event.
- Retained answers merge by question id into `TaskDetail.answers`; every submitted answer is also archived with its question text in `answer_history` (not exposed; see CCR-1).
- `TaskDetail.artifacts` = current revision only. `events` = all revisions, each keeping its `revision`. `sources` = latest revision that has stored sources. `questions` is empty once answered.
- A worker or review action carrying an old revision is rejected: `LeaseLostError` for workers (writes nothing), `STALE_REVISION` for reviews.
- Notification dedupe keys are `<taskId>/<revision>/<channel>`; a task that is ready in two revisions gets two intents.

### Intake boundaries (single enforcement point: `ingestMessage`)
Max 5 files, 10 MB per file, 20 MB total, no repeated attachment ids, body cut at 60,000 chars. A file that is not stored
gets a visible `warning` event on the task ("Attachment X was not read: <reason>"). If the envelope still lists it, the worker
fails the task with `ATTACHMENT_UNAVAILABLE` (non-retryable) before calling the engine. Demo attachments come only from
`fixtures/` via `resolveFixturePath` (rejects traversal, absolute paths, NUL, symlink escapes).
Extracted-text caps for model input are the engine's job.

### State machine
`packages/data/src/state.ts` is the only transition table; `setStatus` is the only code that writes `tasks.status`.
`packages/data/test/batch3.test.ts` checks all 81 (from, to) pairs against the spec table, plus the recovery exception.

### Tests added in Batch 3 (fake engine where noted)
- `packages/data/test/batch3.test.ts` — state table, answers (valid/invalid/stale/duplicate/retained), 6-process answer race, approve/dismiss process race, stale worker after retry, notification dedupe across revisions, intake limits, fixture path safety.
- `apps/api/test/batch3.test.ts` — status × action matrix over HTTP, answer error codes, 10 simultaneous HTTP submits, resumed-clarification task detail, malformed/oversized requests.
- `apps/worker/test/batch3.test.ts` — **fake engine**: four scenarios through `injectDemo` and the worker, real fixture bytes reach the engine, resumed clarification, dropped attachment, notification failure does not rerun generation.

### Still blocked (needs teammates' branches)
Real engine outputs for report, ambiguous and no_action; real browser clarification flow; Eden's independent run; the merged
Batch 2/3 gate. See `docs/batches/batch-3/darren.md` and `docs/batches/batch-2/integration.md`.

## Batch 4 platform: Gmail live intake and live wiring (branch `platform-batch4`)

Migration `002_batch4_gmail_live.sql` adds `integrations.connection_token`, `integrations.auth_failed_at` and
`tasks.organization_json`. It applies to existing databases (checked on a copy of a local DB); older tasks keep a NULL
snapshot and fall back to current settings.

- **OAuth** (`apps/api/src/routes/integrations.ts`): scope `gmail.readonly` only; state is 24 random bytes, stored as a
  hash, bound to the session, 10-minute expiry, consumed on first use even when that use fails. New: start refuses with
  `503 GMAIL_REDIRECT_MISMATCH` unless `GOOGLE_REDIRECT_URI` = `PUBLIC_APP_URL/api/integrations/gmail/callback`; the
  callback refuses tokens that lack the read scope (`reason=scope`, token revoked). Disconnect deletes locally, then revokes.
- **Connection identity** (`packages/data/src/integrations.ts`): `connection_token` rotates per connect. `updateGmailTokens`
  and `recordGmailPoll` write only for the current token (IMMEDIATE transaction), so a late refresh or a finishing poll
  cannot resurrect a disconnected or replaced connection.
- **Polling** (`packages/data/src/gmail/poll.ts`): see runbook "Polling behaviour". New exports: `CONNECT_SKEW_SECONDS`,
  `PAGE_SIZE`, `MAX_PAGES`, `MAX_MESSAGES_PER_CYCLE`, `isGmailAuthError`; `PollResult.status` adds `paused` and `superseded`.
- **Live model** (`packages/data/src/config.ts`): `liveModelProblem(config)` mirrors the engine's requirements;
  `modelStatus().configured` uses it. The worker fails unconfigured live tasks with `MODEL_NOT_CONFIGURED` or
  `MODEL_PROVIDER_UNSUPPORTED` before calling `runWork`. Engine error messages are passed through `redact()` before storage.
- **Snapshots**: `ingestMessage` stores the organization profile; the worker uses it for every revision of that task.
- **Delivery** (`whatsappPolicyProblem` in `packages/data/src/notifications.ts`): operator-only policy, enforced in the
  worker before `sendNotification`; designated recipient only; `accepted` without a provider id, or `simulated` from a
  live channel, is recorded as failed and not resent.
- **Status**: `GET /v1/integrations` explains a disconnected Gmail (missing credentials or redirect mismatch) and the
  WhatsApp block reason in `lastError`; never secrets.

Tests: `packages/data/test/batch4.test.ts` (17), `apps/api/test/batch4.test.ts` (15), `apps/worker/test/batch4.test.ts`
(15). Google, the engine and the delivery adapter are mocks in these tests, except that the consent URL is built by the
real `google-auth-library`. Not proven: a live Google account, a live model call, a live WhatsApp send.

## Batch 5 platform: durability, quiet hours, one-host runtime (branch `platform-batch5`)

Migration `003_batch5_durability.sql` adds `notification_members` (UNIQUE per task revision and channel),
`notifications.kind/sealed_at/submit_started_at/recipient_fp`, and backfills existing rows. It applies to existing
databases (tested on a database built from migrations 001–002). No public DTO, route, state name or env var changed.

**For Joanne (engine boundary)**
- `GeneratedFile.id` is ignored apart from "must be nonempty": the platform derives `art_<hash>` itself (Batch 4) and
  now stores each file at `<task>/r<rev>/<artifactId>.<sha256[:16]>.<format>`, never overwriting. Do not depend on paths.
- Honour `deps.signal`. If it is ignored the worker stops waiting at the deadline (240 s) or on a lost lease, records the
  outcome and discards any late `onProgress`/result, but the engine's own work keeps running in the background.
- A progress call after the worker lost ownership throws `LeaseLostError`; treat it as cancellation.

**For Maricella (UI and delivery)**
- Schedule policy: `docs/runbook.md` → "Notifications and quiet hours". `NotificationRecord.scheduledFor` is the *current*
  plan: a queued row can move later if dispatch lands in quiet hours (late worker start, edited settings). Do not present it
  as a promise.
- More than one digest can exist for a local date (a result arrives after a digest was claimed). Digests list their tasks
  in `taskIds`; render the bounded list plus remainder count in `composeNotification`.
- `blocked` with `lastError` starting `POLICY_CHANGED:` means the channel or recipient was edited after queueing; show it
  as "not sent" with the safe reason. `failed` with `DELIVERY_UNCERTAIN` means the provider may have accepted; show that
  honestly and do not offer an automatic resend.
- `PATCH /api/settings` now returns 400 for an unknown IANA zone (offset forms such as `UTC+3` are rejected), a non-`HH:mm`
  time, and an enabled quiet window whose start equals its end. Show the `error.message`.
- The delivery adapter must time out well under the 60 s notification lease and must throw `DELIVERY_UNCERTAIN`
  (`retryable=false`) when a timeout happens after the request was sent.
- After a session expires the login page lands on `/`, not on the deep link that was opened (spec: continue to the task).

**Platform exports added** (`@afterhours/data`): `computeDeliverySchedule`, `parseHHmm`, `isValidIanaZone`, `ScheduleError`,
`stageArtifactFiles`, `promoteStagedFiles`, `verifyStoredFiles`, `cleanOrphanArtifacts`, `jobStillOwned`, `markSubmitStarted`,
`stalePolicyProblem`, `recipientFingerprint`, `UNCERTAIN_MESSAGE`, `createBackup`, `verifyBackup`, `restoreBackup`.
Worker: `installShutdownHandlers`, `WorkerDeps.testHooks` (internal fault seams; never wired to a route or `main.ts`).
New scripts: `pnpm backup -- create|verify|restore`, `pnpm check:worker`.

Tests: `packages/data/test/batch5-{schedule,notifications,artifacts,backup}.test.ts`, `apps/worker/test/batch5.test.ts`
(includes real child-process SIGKILL/SIGTERM drills), `apps/api/test/batch5.test.ts`. Evidence and unrun items:
`docs/batches/batch-5/darren.md`, `docs/batches/batch-5/integration.md`.
