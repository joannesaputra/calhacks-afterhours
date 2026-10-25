# Final integration record and capability matrix

Full findings and the 44 answers: `docs/audits/final/audit.md`. The historical live-smoke record stays in
`docs/batches/batch-7/integration.md` (not rewritten).

## Candidate

| Item | Value |
|---|---|
| Base | `b69ddd5babf2140c647f692c88f945a88e1dccb6` (`origin/integration/batch7` at audit start; code identical to `9a5684f`) |
| Tested implementation | `c20fb24e8817f84900263f6fa51425940a77b5cb` on `audit/final-all` |
| Later commits | documentation only (`docs/audits/final/*`); no source change after the checks |
| Integration | `integration/batch7` fast-forwarded to the audit head; no remote work arrived during the audit (fetched before merging) |
| `main` | untouched |
| QA harness | `origin/qa/system-batch7` `d248e51`, run with `QA_REPO_ROOT`, not merged |

## What changed in this audit (compatible, no contract or schema change)

| Layer | Change | Interface impact |
|---|---|---|
| Engine | zero-revenue month: channel shares `null`, honest wording | `SalesMetrics.sharePercent` / `websiteSharePercent` values may be `null` (engine-internal type; also visible to the live model as `calculatedMetrics`). No contract change. |
| Data (Gmail) | 401 by HTTP status is an auth failure; disabled-API message | none |
| Worker | `pnpm gmail:poll-once` (new root script, new files only) | new command; no new dependency; lockfile unchanged |
| Web | paper focus ring; `safeReturnTo(unknown)`; Settings and OAuth-error copy | none |
| Docs | runbook live status, settings semantics, intake procedure, troubleshooting | — |

## Final capability matrix

| Capability | Status | Evidence / limit |
|---|---|---|
| Core merged local application | **PASS** | `c20fb24`: frozen install, readiness, typecheck, lint, 356 tests, build; browser 25 + 1 explained skip; QA 53/53 |
| Offline proposal/report/clarification/no-action | **PASS** | real pipeline in fixture mode; QA A/B/D/E; browser 1/2/3/5 |
| Historical live proposal generation | **PASS (historical, one run)** | Darren, task `ac55e3c3-…`, `9a5684f`, one call, 5 slides; not repeated here |
| Applicability of that live proof to current code | **PARTIAL** | proposal path unchanged since `9a5684f`; report wording changed (F1) and was tested offline only |
| Actual exports: content/package validity | **BLOCKED** (live files) / **PASS** (re-rendered fixture files) | live `var/live-output/` exists only on Darren's machine |
| Actual exports: complete visual inspection | **PARTIAL** | 30/30 slides in PowerPoint PASS; DOCX page 1 only (Quick Look); full Word pages NOT RUN |
| Browser workflow and persisted review | **PASS** | browser 1, 3, 8, 13; QA restart |
| Gmail OAuth connection | **PASS (Joanne's machine, one account)** | see "Live Gmail check" below; Darren's machine still needs its own client or connection |
| Real Gmail email → queued task | **PASS (one email)** | `pnpm gmail:poll-once`: 1 task queued, repeat 0, zero model calls; see below |
| Gmail → live Claude → verified files | **PASS (one proposal, Joanne's machine)** | authorized by Joanne; see "Gmail → live Claude run" below |
| Live WhatsApp delivery | **NOT RUN** | adapter tests with fake provider only |
| Docker/remote deployment | **NOT RUN** | Docker not installed here; no host |
| Actual unattended overnight operation | **NOT RUN** | no always-on host |

## Live Gmail check (2026-10-24, Joanne's machine, code `8e1cda8`)

OAuth connection verified; one real email reached the queue. This is not Gmail → live Claude.

- Google Cloud project `afterhours-512701` (owned by Joanne): Gmail API enabled; Auth platform External / Testing, one
  test user (Joanne's own inbox); Data Access only `gmail.readonly`; Web application client "AfterHours local web" with the
  single redirect URI `http://localhost:3000/api/integrations/gmail/callback`. Client ID and secret live only in Joanne's
  untracked `.env`.
- Only the API and web app were running (`pnpm dev:api`, `pnpm dev:web`); no worker (`pnpm check:worker`: stale).
  `GENERATION_MODE=fixture`, `NOTIFICATION_CHANNEL=outbox`.
- Connect: Google showed the expected "hasn't verified this app" warning for a Testing app; Joanne approved. Settings
  then showed Connected with the expected account; `integrations.state=connected`, credentials stored as `v1.` AES-GCM;
  no secret or token pattern in the API log (0 matches).
- Intake: approved sender = the same inbox (self-sent mail lands in Inbox); Automation and Prepare automatically on for
  the window only. One new synthetic Maple & Moss email sent by Joanne. `pnpm gmail:poll-once` → `status ok, ingested 1,
  ignored 2` (two unrelated new inbox messages: `sender_not_allowed` audit rows only, no task), new task
  `e8ec9d9e-f54c-4760-99a2-739606190eb1`: `ingestionMode=gmail`, `generationMode=fixture`, `queued`, receivedAt
  `2026-10-25T02:08:56Z` (Gmail internalDate) vs createdAt `02:09:08.674Z`, body 1,450 chars, 0 attachments; job
  `queued`, attempts 0, no lease; only event "Gmail message received and queued."; 0 artifacts.
- Repeat `pnpm gmail:poll-once` → `ingested 0`, no new task, queue still 1.
- Automation turned off afterwards. The task stays queued and unexecuted. Running it later in fixture mode needs a worker;
  a live Claude run needs a new task ingested in live mode (mode is snapshotted) and separate paid authorization.
- Model calls: 0. Sends: 0.

## Gmail → live Claude run (2026-10-24, code `70de6a0`, authorized by Joanne)

- Clean queue first: the earlier fixture Gmail task was run once with `worker:once` in fixture mode (free) → `needs_input`
  (the fixture engine only knows the demo scenarios). Queue then empty.
- `.env` switched to `GENERATION_MODE=live`, `MODEL_PROVIDER=anthropic`, `MODEL_NAME=claude-sonnet-5-5` (key pasted by
  Joanne, never displayed). Automation on, one new self-sent synthetic email ("AfterHours live test — Maple & Moss
  proposal"). `pnpm gmail:poll-once` → 1 task `d6c264d8-6e14-4850-8fdc-7cc063e9715b`, `gmail`, `live`, queued; it was the
  only queued job.
- `pnpm worker:once` → `ready` in 26.3 s. **Provider usage: 1 call (generate), no repair, 5,071 input / 4,648 output
  tokens.** Notification `simulated` (outbox). No email or message sent.
- Files (authenticated download through the web proxy = stored bytes):
  `Proposal-for-Maple-Moss-Brand-Positioning-Audience-Research-and-Launch-Roadmap-r1.docx` 11,311 B `e318e4ec48261d95…`;
  `Maple-Moss-Brand-Positioning-Audience-Research-and-Launch-Roadmap-r1.pptx` 99,520 B `80dce910bdeb30d3…`, exactly 5 slide
  parts. Copies in gitignored `var/final-audit/live-gmail/`.
- Content vs the email: client, agency, "sustainable lifestyle brand", scope (positioning, audience research, launch
  roadmap), USD 6,000, four weeks from October 26, 2026, exclusions (paid advertising spend, campaign execution) and the
  payment-milestone open item all match; slides follow the requested order (overview, objectives, scope, timeline and
  fee, next steps); objectives and next steps are labelled RECOMMENDATION; one assumption cites Harbor Creative's own
  standard exclusions (organization profile). No end date was stated or invented. Due date shown in the task (Oct 26,
  9:00 AM PDT), not in the files. Quotes are exact substrings (checked by the engine's grounding verifier).
- Visual: all 5 slides rendered in Microsoft PowerPoint → PDF: no overflow or clipping. DOCX page 1 via Quick Look:
  readable; pages 2+ not rendered (same Word tooling gap as O2).
- Afterwards: Automation off, `GENERATION_MODE=fixture` in `.env`. Cosmetic: the DOCX subtitle and the standard
  "Prepared by … internal review" line say nearly the same thing.

## Full live check with the real worker (2026-10-24, code `dbb37fe`, authorized by Joanne)

Re-checks first: `pnpm test:e2e` 25 passed + 1 explained skip (after stopping the audit's own web server, which blocked a
second `next dev`); QA harness 53/53. Joanne opened the live proposal DOCX in Word and reported every page clean (Word's
scripting refuses PDF export on this Mac, so this page check is human, not automated).

Then `GENERATION_MODE=live`, the normal worker (`pnpm dev:worker`, polls Gmail every 15 s **and** generates), Automation on,
one approved sender. Joanne's self-sent emails arrived without subject or body text, each carrying fixture files only
(sent from Finder), which made them adversarial cases:

| Email (as received) | Task | Outcome | Claude usage |
|---|---|---|---|
| no text; `sales.csv` + `maple-and-moss-brief.md` + `prompt-injection.txt` | `85d0938b` | `needs_input`: which deliverables, whether the CSV is a usable baseline, start date | 1 call, 5,843 / 1,242 |
| no text; `maple-and-moss-brief.md` only | `7744cb4d` | `ready`: proposal + deck from the brief | 1 call, 4,983 / 2,794 |
| no text; `sales.csv` only | `01b1ae6e` | `needs_input`: deliverables, purpose/owner, proposal scope | 1 call, 5,278 / 927 |
| no text; `prompt-injection.txt` only | `97ecc354` | `skipped`; no instruction followed | 1 call, 4,748 / 517 |
| answers to `01b1ae6e` in the UI (report + 5-slide deck, internal, fictional data) | `01b1ae6e` r2 | `ready` | 1 call, 5,899 / 4,944 |

All calls: one generate call each, no repair, no retry. Notifications: 3 `simulated`. No email or message sent.

Report check (`01b1ae6e` r2, files in gitignored `var/final-audit/live-gmail/report/`): revenue USD 12,000 → 15,000
(+3,000, 25%), orders 120 → 150 (+30), AOV USD 100 both months, Website 66.7% / Partnerships 33.3% both months, channel
values 8,000/10,000 and 4,000/5,000: all equal to the CSV. Answer history kept (3 rows). Five slide parts; all 5 rendered
in PowerPoint (native two-series chart, no overflow). Finding: the attachment-only brief (`7744cb4d`) produced a
proposal without any request in the email; see audit O7.

Persistence: marked `01b1ae6e` reviewed, stopped the worker, restarted the API: status `approved` and "Marked reviewed"
still shown; the task keeps its `live` label while the app shows Fixture mode (snapshot). Afterwards: Automation off,
`GENERATION_MODE=fixture`, worker stopped (heartbeat stale), Gmail still connected.

## O7 live re-check (2026-10-24, code `1ef0060`)

Checks on `1ef0060`: typecheck, lint, build 0; 361 tests in 32 files; browser 25 passed + 1 explained skip; QA 53/53.
`GENERATION_MODE=live`, API and web only, Automation on for the window. Joanne sent the same case as before: no subject,
no text, only `maple-and-moss-brief.md` (task `0bc377e7-8b21-4c32-b7dd-dea7c3e98172`). `gmail:poll-once` → 1 live task;
`worker:once` → `needs_input` in 5 ms, **0 Claude calls**, question "What would you like prepared…". Answered in the UI
("proposal and five-slide kickoff deck for Maple & Moss from the attached brief") → revision 2, `worker:once` → `ready`,
1 call (5,215 / 4,223 tokens), 5 slide parts, USD 6,000 and four weeks quoted from the brief, notification simulated.
Afterwards Automation off, `GENERATION_MODE=fixture`, no worker, queue empty.

## Gmail setup for Darren (no secrets here)

1. Google Cloud project → enable **Gmail API**.
2. Google Auth platform → Branding (app name, support email) → Audience **External**, status **Testing**, add the exact
   receiving test inbox under **Test users** → Data Access: only `https://www.googleapis.com/auth/gmail.readonly`.
3. Clients → **Web application** → Authorized redirect URI exactly `http://localhost:3000/api/integrations/gmail/callback`
   (the web origin, never the API port; do not mix `localhost` and `127.0.0.1`).
4. In your own untracked `.env` (do not run `setup:local` over it, do not change `TOKEN_ENCRYPTION_KEY`):
   `PUBLIC_APP_URL=http://localhost:3000`, `GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/gmail/callback`,
   `GOOGLE_CLIENT_ID=<private>`, `GOOGLE_CLIENT_SECRET=<private>`, `NOTIFICATION_CHANNEL=outbox`.
5. `pnpm check:ready` (must not FAIL on the redirect), then start **API and web only**:
   `pnpm dev:api` and `pnpm dev:web`. Do not start a worker.
6. Settings: Automation **off**, then **Connect Gmail**, choose the test inbox, approve the read permission. Evidence of
   connection: back on Settings without an error marker, the expected account shown, state Connected.
7. Intake check (zero model calls): follow `docs/runbook.md` "Controlled Gmail intake check": one approved sender,
   Automation and Prepare automatically on, send **one new** email after connecting, run `pnpm gmail:poll-once`, run it
   again (must ingest 0), turn Automation off, note the task id. The task stays queued.

Draft test email (send it yourself from the approved sender; the agent did not send it):

> Subject: AfterHours Gmail test — Maple & Moss proposal
>
> This is a synthetic demonstration request using fictional business information. Please prepare a strategy proposal and
> exactly five presentation slides for Maple & Moss. The agency is Harbor Creative. The engagement fee is USD 6,000 and the
> duration is four weeks, starting October 26, 2026. Please have the draft ready October 26, 2026 at 9:00 AM in
> America/Los_Angeles. The scope is brand positioning, audience research and a launch roadmap. Payment milestones have not
> been agreed, so flag them rather than inventing them. Prepare the files for review only. Do not send or submit anything.

Attach only a `.md` or `.txt` brief (the engine extracts text, Markdown and CSV; PDF and Office attachments are not
extracted and lead to a clarification question). Testing-mode refresh tokens expire after about 7 days; a test connection
is not Google verification. Workspace accounts may be blocked by admin policy.

## Checklist for the original live files (Darren)

Files: `Launch-Strategy-Proposal-for-Maple-Moss-r1.docx` (11,576 B, `9ef799d3b74a97f9…`) and `Maple-Moss-Kickoff-r1.pptx`
(98,898 B, `a41cb5532b1832a9…`) in `calhacks-afterhours-b7/var/live-output/`. Keep them out of git.

- `shasum -a 256` both files and compare with the prefixes above.
- PowerPoint: slides 1–5: titles inside the title box, no body text below the footer line, no clipped table or chart,
  `USD 6,000`, `October 26-November 22, 2026` labelled calculated, due `Monday, October 26, 2026 at 9:00 AM PDT`, no
  "EXAMPLE" text.
- Word: every page: header and "Page X of Y" footer, no blank page, tables not split across pages mid-row, basis line
  under each heading, Source notes at the end with exact quotes, no payment milestones invented.
- Record PASS/FAIL per page/slide in `docs/audits/final/audit.md` (O1, O2).

## Safe reproduction (no model calls, no sends)

```bash
corepack pnpm install --frozen-lockfile && corepack pnpm check:ready
corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test && corepack pnpm build
corepack pnpm test:e2e      # needs: pnpm --filter @afterhours/web exec playwright install chromium
git worktree add --detach ../qa-harness origin/qa/system-batch7
QA_REPO_ROOT=$PWD node --import tsx --test ../qa-harness/tests/system/*.test.mjs
corepack pnpm exec tsx packages/engine/test/render-samples.ts var/final-audit/office   # fixture exports to inspect
```

## Local state left on Joanne's machine

- `var/final-audit/office/` (gitignored): re-rendered fixture DOCX/PPTX, PowerPoint PDFs, slide contact sheets, Quick Look
  page-1 images. Disposable.
- Playwright Chromium in `~/Library/Caches/ms-playwright` (installed with approval for the browser suite).
- No connected Gmail database or encryption key was created or touched; the audit stack's scratch database lived in the
  session scratch folder and its processes were stopped.
