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
| Gmail OAuth connection | **NOT RUN** | offline OAuth tests PASS; needs Darren's Google client and consent |
| Real Gmail email → queued task | **NOT RUN** | `pnpm gmail:poll-once` and procedure ready and tested with a fake inbox |
| Gmail → live Claude → verified files | **NOT RUN** | needs a separate paid authorization |
| Live WhatsApp delivery | **NOT RUN** | adapter tests with fake provider only |
| Docker/remote deployment | **NOT RUN** | Docker not installed here; no host |
| Actual unattended overnight operation | **NOT RUN** | no always-on host |

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
