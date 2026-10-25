> **Batch 7 (final):** this record describes `0e8395e` (Batch 6). The current integration candidate is `09f54cc` on `integration/batch7`; see `docs/batches/batch-7/integration.md`. Rows here about the UI (SpaceXAI snapshot), delivery (foundation stub), the engine (`person-2-engine`) and the browser suite (NOT RUN) are superseded: the candidate now has Maricella's UI re-themed in the SpaceXAI style, the Twilio delivery adapter (mock-tested), `engine-batch7`, the Claude provider, and a browser suite that ran 25 passed / 1 skipped. The current integration candidate is `ae422e6` on `integration/batch7`; see `docs/batches/batch-7/integration.md`. The engine row below is superseded by Joanne's `engine-batch6`.

# Release candidate record (Darren)

Everything below was observed on this exact candidate. Old hashes, test counts, task ids and artifacts from earlier batches are not evidence for it.

## Identity

| Item | Value |
|---|---|
| Release branch | `platform-batch6` (local; **not pushed**, see "Push status") |
| **Tested implementation candidate** | `0e8395ed18941cd08e99e1c64b0b6a421a0eb3dd` (short `0e8395e`) |
| Later commits | docs-only recording commits (`docs/release/*`, `docs/batches/batch-6/*`, runbook, a one-line correction in `docs/batches/batch-5/integration.md`). They add no code and were not themselves re-run. `git diff 0e8395e HEAD --stat` must list only `docs/` paths. |
| Working tree when tested | clean clone of the branch at that commit (`git clone --no-hardlinks`, `git status` empty after every command) |
| Base | `platform-batch5` @ `d11127b` (Batch 5 platform, pushed), on `platform-batch4` @ `af24fef` (three commits that were never pushed on their own; they are ancestors of `origin/platform-batch5`), on `platform` @ `aaed3db`, on the foundation `main` @ `5d8f342` |
| Engine | `origin/person-2-engine` @ `de6bd404c97d64f12e4fd47b8eda28030d0d3118` (Joanne), merged in `186a6e7`. No `engine-batch5/6` branch exists on origin. |
| Engine fixes made by Darren (isolated commits, Joanne to review or replace) | `8bcdbb4` DOCX tables get a fixed grid (DEF-4); `15b15f8` plan title for a skipped message (DEF-6); `f6e3be1` neutral duration labels after clarification answers (DEF-3); `68ea1ec` report narrative derived from computed metrics (DEF-2). Each has a regression test that fails without it. |
| Web UI | Darren's SpaceXAI-style UI, copied **unchanged** from the uncommitted working tree of `ui/spacexai-style` into `664cc98`. It is not Maricella's work: no experience branch exists on origin. Darren's decision that this style wins is recorded. |
| Web fix by Darren | `79a35af` + `1e29d42`: after sign-in return to the page that was opened (same-origin relative path only), with a unit test. |
| Delivery | `packages/delivery` is still the **foundation stub** (outbox returns `simulated`; every live channel returns `blocked`). There is no Twilio/WhatsApp adapter. |
| Merge-brought test change | the engine branch replaced the platform test "foundation engine stub fails honestly" with "runs the real fixture engine through the worker" (`apps/worker/test/worker.test.ts`). It is the only platform test file changed since `d11127b`; no assertion was removed to hide a failure. |

Platform code (`packages/data`, `packages/contracts`, `apps/api`, `apps/worker`, `scripts`, `docker-compose.yml`, `Dockerfile`, root `package.json`) is byte-identical to the Batch 5 candidate `d11127b` apart from that test file. Batch 5 runtime evidence for that code therefore still applies, and is labelled as such below.

## Runtime and packages

Node `v20.20.2` (engines `>=20.19`; Docker image uses Node 22, not run); pnpm `10.33.4` (pinned by `packageManager`); TypeScript `~5.9.3`; Vitest `4.1.12`; Next `16.4.3`; React `19.3.1`; better-sqlite3 `^12.11.1`; docx `9.5.1`.
Lockfile: `pnpm-lock.yaml` is the result of a plain git merge of the engine branch's lockfile (no manual edit). `pnpm install --frozen-lockfile` succeeded and `pnpm install --lockfile-only --offline` produced **no diff**, so the lockfile matches every `package.json`. The install used the local pnpm store (`--offline`), so it proves the lockfile resolves, not that the registry is reachable.

## Environment variable names (values never recorded)

`NODE_ENV PUBLIC_APP_URL API_ORIGIN API_PORT DATABASE_PATH ARTIFACTS_DIR SESSION_SECRET APP_PASSWORD TOKEN_ENCRYPTION_KEY DEMO_ENABLED DEMO_CLI_TOKEN GENERATION_MODE MODEL_PROVIDER MODEL_NAME OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI GMAIL_POLL_INTERVAL_SECONDS NOTIFICATION_CHANNEL WHATSAPP_USE_CASE_ELIGIBLE WHATSAPP_CUSTOMER_SERVICE_WINDOW_UNTIL TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_WHATSAPP_FROM TWILIO_WHATSAPP_TO TWILIO_CONTENT_SID NEXT_PUBLIC_APP_NAME` (unchanged from `.env.example`). `pnpm setup:local` generates the secrets and the login password for a clean checkout.

## Modes of the tested candidate

Intake: demo injection (`ingestionMode=demo`). Intelligence: fixture (`generationMode=fixture`). Delivery: outbox (`simulated`). No Gmail, no model call, no WhatsApp, no external message was made at any point. `GENERATION_MODE=live` without a key was exercised separately and fails honestly (below).

## Supported scope of this candidate

An authenticated synthetic request (the four demo scenarios: proposal, report, unclear request, no-action) becomes a persisted task and job, is processed by the separate worker with the real engine, produces a real DOCX and a five-slide PPTX (proposal+deck, or report+deck), shows a content preview and sources, can be downloaded and marked reviewed (records acceptance only), and survives restarts. Inputs: plain text, Markdown, CSV (engine limits: five files, 10 MB each, 20 MB total, 60,000 characters). Not supported: PDF/DOCX/XLSX input, OCR, live Gmail (untested), live model (untested), WhatsApp (not implemented).

## Missing prerequisites

Google OAuth client and test inbox; an OpenAI key and `MODEL_NAME`; Twilio account, eligibility confirmation and designated recipient *and* a delivery adapter (not written); Docker; an always-on host; an Office-compatible renderer for full visual review (macOS Quick Look thumbnails were used for first-page checks only).

## Check ledger (clean clone at `0e8395e`, shell exit codes)

| # | Command | Exit | Observed |
|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile --offline` | 0 | lockfile consistent |
| 2 | `pnpm setup:local` | 0 | created `.env`, `var/`, secrets (not printed) |
| 3 | `pnpm db:migrate` (ports overridden by shell variables) | 0 | applied `001`, `002`, `003` |
| 4 | `pnpm db:seed` | 0 | default settings present |
| 5 | `pnpm db:migrate` again | 0 | "No pending migrations" (idempotent) |
| 6 | `pnpm check:ready` | 0 | config, migrations, port agreement, engine and delivery exports OK |
| 7 | `pnpm typecheck` | 0 | all workspace packages including `apps/web` |
| 8 | `pnpm lint` | 0 | |
| 9 | `pnpm build` | 0 | includes `next build` (`/`, `/login`, `/settings`, `/tasks/[id]`) |
| 10 | `pnpm test` | 0 | **22 files, 241 tests** |
| 11 | `pnpm test:e2e` | 0 | prints `SKIPPED: tests/e2e is empty`: **NOT RUN, no browser suite exists** |
| 12 | QA system suite from the QA worktree (`QA_REPO_ROOT` = the clone; real API + worker child processes, real engine, throwaway DBs) | 1 | 53 tests, **50 pass, 3 fail** (A4, A5, I1: see `docs/batches/batch-6/integration.md`) |
| 13 | `pnpm dev` on a second clean clone of the same commit, API port overridden | n/a | `[web]`, `[api]`, `[worker]` came up; `pnpm demo:proposal` and `pnpm demo:report` queued tasks, both `ready` with 2 files; login through the web proxy `/api/session` set `ah_session; HttpOnly; SameSite=Lax`; the API listened on `127.0.0.1` only |
| 14 | built runtime: `next build` then `next start`, `node --import tsx apps/api/src/main.ts`, `node --import tsx apps/worker/src/main.ts` | n/a | the commands the compose file uses; two full demo rehearsals, `SIGTERM` restart, backup/restore (see integration report) |

Not run: any `docker`/`docker compose` command (Docker is not installed), any live Gmail/model/WhatsApp call, any remote-host check, any real all-night run.

## Push status

`platform-batch5` (with the Batch 4 commits) is already on `origin`. `platform-batch6` has **not** been pushed: it contains the SpaceXAI UI snapshot, which Darren decided not to push without an explicit go-ahead, and engine fixes that Joanne has not seen. Push only on Darren's yes.
