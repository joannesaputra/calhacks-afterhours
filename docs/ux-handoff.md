# UX handoff (Person 3)

## What exists

`apps/web` (Next 16 App Router, React 19, TanStack Query, lucide-react, plain CSS) and `packages/delivery`.

| Route | Purpose |
|---|---|
| `/login` | Password login (`POST /api/session`), `returnTo` limited to same-origin relative paths |
| `/` | Work queue: filters, cards, demo menu (only when the server reports `DEMO_ENABLED=true`) |
| `/tasks/[id]` | Review: summary, files, Content preview, review/answers/retry, tabs (request, plan, sources, activity, notifications) |
| `/notifications` | Notification history, honest per-state labels |
| `/settings` | Organization, Automation, Gmail, Model and worker, Notifications |

Auth is enforced by the API; the shell redirects to `/login?returnTo=…` on `authenticated:false` or any 401, and sign-out clears
the query cache. All requests use relative `/api/*`. Demo availability comes from a server component reading
`DEMO_ENABLED` at request time (no probing).

## API assumptions

Only the contract routes. Every response is parsed with the shared Zod schemas. Review/answers/retry send the revision from the
loaded task; a 409 (stale revision or invalid transition) shows "This task changed. Refresh to review the latest version.",
refetches, and never resubmits. Queue = up to 500 newest tasks in one list (5 pages × 100) filtered client-side with an explicit
"showing the most recent N" notice when capped; no contract amendment needed. Polling: queue/detail 2 s while active,
slower otherwise, off in hidden tabs, stopped on terminal states.

## Preview rendering

`ProductPreview` renders the same `WorkProduct` the files came from: document page, or slide navigator plus 16:9-style slide card
(layouts title, bullets, two_column, chart, closing). Tables scroll horizontally on phones. Charts are SVG drawn only from the
structured values, with an `aria-label` summary and a data table. Evidence chips open a native modal dialog (focus trap, Esc,
focus return) showing source title, locator, and quote, plus whether the quote really occurs in the extracted text. Unread
(unsupported/failed) sources are visibly flagged. Basis labels: Calculated, Recommendation, Assumption; a `source` block with no
evidence shows "No source reference".

Downloads fetch the file, then check it against the manifest (size, ZIP signature, content type, SHA-256 when the browser
supports it) before saving, and report success only afterwards. Failures show inline with a retry.

## Design notes

Palette from the brief. One deliberate change: secondary text is `#52687F` (not `#627D98`) and primary buttons use `#0F766E`
(accent `#14B8A6` stays for focus rings and highlights) so small text and white-on-teal meet WCAG AA contrast.

## Timestamps

Two different times are always labeled separately: **Entered the system** is `task.createdAt` (ingestion time) and
**Email sent** is `email.receivedAt` (the message's own time). Demo fixtures carry an intentionally old
`receivedAt`, so the two differ. Task header and the Original request tab show both; queue cards show only "entered the
system N ago" because `TaskSummary` has no `receivedAt`. E2E test 11 checks both labels against the API values.

## Running locally (ports)

`API_PORT` and `API_ORIGIN` must name the same port (see `docs/runbook.md`, "Using a different API port locally"; `pnpm
check:ready` verifies). The web proxy reads `API_ORIGIN` at `next dev`/`next build`. The browser suite does not touch your
`.env` or database: `pnpm test:e2e` starts API :4100, worker, and web :3100 on temp storage with matching values
(`E2E_API_PORT`/`E2E_WEB_PORT` override). Exit code 3 means "BLOCKED": some tests could not run because the real engine is
missing. That is never a pass.

## Checks actually run (Batch 2, merged baseline `b442c71` + experience)

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (100 tests, 26 of them delivery), `pnpm build`: pass.
- `pnpm test:e2e` against the real merged baseline (engine is still the foundation stub): 5 pass, 8 BLOCKED (exit 3).
  The 5: honest stub failure (`ENGINE_NOT_IMPLEMENTED`, no files, no review button, retry offered), duplicate `replayKey`,
  unauthenticated deep link + login return + open-redirect rejection + CLI token/download 401, settings persistence,
  timestamp labels.
- The 8 BLOCKED tests (proposal flow, report, ambiguous, no_action, notifications, stale review, mobile, keyboard) need a
  ready task. They passed (12/12 applicable) only against a **local scratch engine that is not committed and is not
  Joanne's engine**. That run shows the UI, API, worker, downloads, and review persistence work together. It is **not** the
  Batch 2 gate: its Office files are synthetic ZIPs, not real documents.
- Worker stopped (manual, real API + web, no worker process): banner "The worker is not running", task page
  "Waiting for the worker", card "Waiting for the worker to start"; after the worker started the banner disappeared and
  the task reached ready (scratch engine).
- Desktop 1440 px and phone 390 px screenshots inspected manually; no horizontal overflow (asserted in test 9).

## Update: real engine (local integration)

With `experience` + `platform` `aaed3db` + `person-2-engine` `a45bd5a` merged locally: 139 unit tests, typecheck, lint, build pass and `pnpm test:e2e` exits 0 (12 passed, 1 not applicable). Details and file evidence: `docs/batches/batch-2/maricella.md`, Update 2. Downloaded files were opened by LibreOffice, not Word/PowerPoint.

## Batch 3 (clarification, retry, charts, sources, layout)

Details and evidence: `docs/batches/batch-3/maricella.md`. Summary: the clarification form keeps unsent text across polling,
conflicts and revision changes; stale/invalid answers show real server outcomes; retry is single-shot per click; charts and
source dialogs render only returned data; long content no longer stretches the page at 390 px. The browser suite now also
starts a second stack whose live model has no credentials, to exercise the real `MODEL_NOT_CONFIGURED` failure, retry and
dismiss paths. Open gap: the real engine returns `quote: null` for every evidence reference (Joanne), so the real-quote
browser test is BLOCKED and the runner exits 3.

## Batches 4 to 6 (live status wording, overnight display, release)

Reports: `docs/batches/batch-{4,5,6}/maricella.md`; demo: `docs/release/demo-script.md`; video claims: `docs/release/video-claim-check.md`.
Notification wording comes from `describeNotification` (uncertain, policy-changed, queued-is-a-plan); the task and notification
views show "Files prepared" and "Currently planned for" in the workspace timezone; offline banner; mutations never queue while
offline; Gmail callback markers `not_configured`, `redirect_mismatch`, `scope`; chart text readable on phones. Everything live
(Gmail, live model, WhatsApp) is BLOCKED for lack of accounts and is shown as disconnected/not configured/blocked.

## Not verified / remaining

- Real engine output (Joanne), live model, live Gmail, live WhatsApp: none exercised from the UI.
- Downloaded files were checked as ZIP containers only; opening them in Word/PowerPoint was not done.
- Stale-worker banner and queued-while-worker-offline wording are implemented from `IntegrationStatus.worker.healthy` but not
  covered by an automated test. The needs_input → "retained answers" prefill is implemented, not separately tested.
- No keyboard-only or screen-reader audit beyond semantic markup; no automated a11y scan.
- Unsaved-changes guard covers browser unload and in-app nav links; browser back is not intercepted.
- The queue has no task preview pane (cards link to the detail page).
- Dev mode shows the Next.js dev indicator over the sidebar; not present in production builds.

## Integration notes for Person 1

- Dependencies added: `apps/web` (`@tanstack/react-query`, `lucide-react`, `zod`, `@playwright/test@1.63.0`), `packages/delivery`
  (`twilio`). `pnpm-lock.yaml` changed; regenerate/merge it with `pnpm install`.
- `scripts/e2e.mjs` (root) was replaced as the stub asked. `tests/e2e/package.json` sets CommonJS and `tests/e2e/tsconfig.json`
  maps `@playwright/test` to the web app's install, because the workspace does not include `tests/`.
- The e2e runner uses ports 3100/4100 (override with `E2E_WEB_PORT`/`E2E_API_PORT`) and a temp directory, never `var/`.
- Delivery: `DELIVERY_UNCERTAIN` must stay non-retryable (already handled in the worker).
