# AfterHours final audit (single agent, all layers)

Auditor: Claude Code session run for Joanne on her machine (macOS 15 / Darwin 24.3, Node 24.19.0, pnpm 10.33.4 via
Corepack). Date: 2026-10-24. Branch `audit/final-all`. No teammate prompt was needed or waited for.

## Result first

| Area | Status | One-line evidence |
|---|---|---|
| CORE APPLICATION AUDIT | **PASS** (4 defects fixed, open items listed) | 356/356 unit tests, browser 25 passed + 1 explained skip, QA 53/53, all on `c20fb24` |
| EXPORTED FILE CONTENT/STRUCTURE | **PASS for re-rendered fixture files / BLOCKED for the original live files** | live `var/live-output/` exists only on Darren's machine; not on this one |
| FULL EXPORTED FILE VISUAL REVIEW | **PARTIAL**: all 30 slides of 6 decks PASS in Microsoft PowerPoint; DOCX page 1 only (Quick Look); full DOCX pages **NOT RUN** | Word and Pages AppleScript export both fail on this machine (-1708) |
| GMAIL OAUTH CONNECTION | **NOT RUN** (offline OAuth boundary tests PASS) | needs Darren's Google Cloud client and consent |
| REAL GMAIL EMAIL → QUEUED TASK | **NOT RUN** (tool and procedure ready: `pnpm gmail:poll-once`) | needs a connected test inbox |
| GMAIL → LIVE CLAUDE → FILES | **NOT RUN** | needs a separate, explicit paid authorization |
| LIVE WHATSAPP DELIVERY | **NOT RUN** | adapter tests with fake provider only |
| OVERNIGHT/REMOTE OPERATION | **NOT RUN** | no always-on host, no Docker here |

**Provider calls and external sends during this audit: zero.** Every automated run used `GENERATION_MODE=fixture` (or a
live stack with an empty key that fails before the engine), `NOTIFICATION_CHANNEL=outbox`, empty Google credentials.

## Candidate and SHAs

| Item | SHA |
|---|---|
| Base (`origin/integration/batch7` when fetched) | `b69ddd5babf2140c647f692c88f945a88e1dccb6` |
| Historical live-tested implementation (Darren) | `9a5684f6d0a504468ce3bb9a38d0d74133e7ca8c`; `b69ddd5` differs by docs only (verified: `git diff --stat 9a5684f b69ddd5` = `docs/batches/batch-7/integration.md`) |
| Audit implementation (code + tests) | `c20fb24e8817f84900263f6fa51425940a77b5cb` |
| Later commits | documentation only (this file and `integration.md`); see `integration.md` for the pushed heads |
| QA harness ref | `origin/qa/system-batch7` at `d248e51a9e8ac3964155e1e68c70cec1f4db5451`, run with `QA_REPO_ROOT` against this checkout from a detached worktree (not merged) |

## Commands and exit codes

| Command | On | Exit | Result |
|---|---|---|---|
| `corepack pnpm install --frozen-lockfile` | `b69ddd5` | 0 | lockfile unchanged |
| `pnpm check:ready` | `b69ddd5` | 0 | fixture / outbox |
| `pnpm typecheck` | `b69ddd5` | 2 then 0 | first failure was stale `apps/web/.next/types` from an older local build (pages moved into `(app)`); after `pnpm build` regenerated them: 0. A fresh clone has no stale folder. |
| `pnpm lint` / `test` / `build` | `b69ddd5` | 0 / 0 / 0 | 345 tests in 29 files |
| `pnpm test:e2e` | `b69ddd5` | 4, then 0 | 4 = Chromium missing (runner prints NOT RUN, not a pass). Installed with `pnpm --filter @afterhours/web exec playwright install chromium` (approved by Joanne). Then 25 passed, 1 skipped |
| QA harness | `b69ddd5` | 0 | 53 tests, 53 pass, 0 skipped |
| `pnpm typecheck` / `test` / `build` | `c20fb24` tree | 0 / 0 / 0 | **356 tests in 32 files** (+11: engine 4, data 5, worker 2; web unit cases extended) |
| `pnpm lint` | `c20fb24` tree | 1, then 0 | the 1 was the audit's own temporary `apps/web/.next-audit` dev build (not ignored by eslint); `eslint . --ignore-pattern 'apps/web/.next-audit/**'` = 0, folder deleted afterwards |
| `pnpm test:e2e` | `c20fb24` | 0 | 25 passed, 1 skipped |
| QA harness | `c20fb24` | 0 | 53/53 |

The one browser skip is `0. with the stub engine, failure is honest`: it applies only when the stub engine is
installed; the real engine is present, so the assertion cannot run. Its sibling path (honest failure with no files) is
covered by `failed-state.spec.ts` and QA suite F (live mode without credentials).

## Findings

Severity: **blocker** (stops the demo or corrupts data), **material** (wrong output, inaccessible, or misleading),
**polish**.

| # | Finding | Severity | Status | Reproduction | Fix / regression |
|---|---|---|---|---|---|
| F1 | Report says a channel "represented 0% of revenue" in a month with no revenue (0 of 0 is undefined), and prints "revenue increased not computable (zero starting value)" | material (factual) | **FIXED** | report fixture with January rows `0,0`: summary, Channel mix, slide 4 | shares are `null` for a zero-revenue month; wording "January 2026 had no recorded revenue, so no channel shares are defined for it; …", "revenue rose from zero, so no percent change is defined". `packages/engine/test/final-audit.test.ts` (preview + DOCX + PPTX text) |
| F2 | Gmail 401 errors whose text has no keyword (Google's "Invalid Credentials" / "invalid authentication credentials") are treated as transient: polling keeps calling Google every 15 s and the user sees "will retry automatically" instead of "Reconnect" | material | **FIXED** | `pollGmailOnce` with an error `{status: 401}` → `status:error`, `auth_failed_at` null | `isGmailAuthError` uses the HTTP status for 401 (403 stays text-based: rate limits and a disabled API also use 403). A disabled Gmail API now says so. `packages/data/test/final-audit.test.ts` |
| F3 | No poll-only command: the controlled intake check required either the normal worker (polls **and** generates, possibly billed) or an improvised script | material (process risk) | **FIXED** | `package.json` had only `worker:once`, which never polls | `pnpm gmail:poll-once` (`apps/worker/src/poll-once*.ts`): one `pollGmailOnce` with the stored connection; imports neither engine nor delivery; reports new task ids/modes/queue counts and warns when a worker is running. `apps/worker/test/poll-once.test.ts` proves a live-mode Gmail task stays `queued`, attempts 0, no progress, files or notification, and a repeat creates nothing |
| F4 | Keyboard focus ring invisible on the white paper previews: 3 px white outline on `#fff` (1:1). Affects every evidence chip and focusable element in the document/slide previews | material (WCAG 2.4.7 / 1.4.11) | **FIXED** | Tab to a source chip in the proposal preview; computed `outline-color: rgb(255,255,255)` on `.doc-page` background `rgb(255,255,255)` | `.doc-page :focus-visible, .slide :focus-visible { outline-color: var(--ink) }` → `#111827` on white (17.7:1). Browser test 12 now asserts `:focus-visible` and ≥ 3:1 |
| F5 | Settings copy: "Your existing inbox is not scanned" understated what the read-only grant allows and what the poller fetches; automation-off and auto-prepare-off behaviour was not stated | material (honesty) | **FIXED** | compare `connections.tsx`/`forms.tsx` with `poll.ts`/`ingest.ts` | copy now states the broad Google grant vs the app's sender filter; automation-off mail is picked up when re-enabled; auto-prepare-off mail is skipped and not kept. Both behaviours are proven by new tests in `packages/data/test/final-audit.test.ts` |
| F6 | `exchange_failed` told the user only "Try again"; the common setup causes (Gmail API disabled, wrong secret) were not named | polish | **FIXED** | `settings-view.tsx` | message names the operator checks; runbook rows added |
| F7 | `safeReturnTo` threw on non-string input | polish (unreachable from `useSearchParams`, which returns string or null) | **FIXED** | `safeReturnTo(42)` → TypeError | returns `/`; unit cases added for `data:`, encoded `//`, `\\`, tab, nested `/login`, numbers, objects |
| F8 | Runbook said Claude "has **not** been run against the real API" | polish (stale doc) | **FIXED** | `docs/runbook.md` | points to the one passing live run and states later changes were offline only |
| O1 | Original live DOCX/PPTX not available on this machine | dependency | **OPEN (BLOCKED)** | `calhacks-afterhours-b7/var/live-output/` does not exist here | Darren: copy the two files and `run-result.json` privately, or inspect them himself with the checklist in `integration.md` |
| O2 | No full-page DOCX render: Word (`save as` → -1708 even on an open document; this Word may be in reduced-functionality mode) and Pages 12.0 (every command -1708) both fail by script | dependency (tooling) | **OPEN (NOT RUN)** | see commands above | Darren: open the DOCX files in Word and use the page checklist |
| O3 | Duplicate `(month, channel)` CSV rows are summed silently | polish | OPEN | append an identical row → ready, doubled values | not changed: multiple rows per channel can be legitimate. A warning would be a new feature |
| O4 | Gmail dedupe key is `gmail:<integration>:<messageId>` and the integration id survives a reconnect to a *different* account; a message-id collision between two mailboxes would be treated as already handled | polish (theoretical) | OPEN | not reproduced (Gmail ids are 64-bit; no collision observed) | reconnect resets the checkpoint and handled list, history before reconnect is never fetched, prior tasks stay as history; no content of the previous account is fetched |
| O5 | Source label "Calculated in code from Proposal and five-slide kickoff deck for Maple & Moss" names the email by its subject | polish (cosmetic, reported by Darren) | OPEN | proposal timeline block | unchanged: the email source title is its subject by contract; renaming touches UI chips and tests |
| O6 | Chart labels show `$15.000` on this machine | not a defect | — | PowerPoint on an `en_ID` locale | the stored number format is `$#,##0`; Office applies the viewer's locale |

No blocker was found.

## Evidence by area

### Platform, worker and data (reused coverage, then targeted checks)

Existing tests that already exercise the required behaviour (all executed in the 356): intake dedupe and concurrent
source keys (`packages/data/test/queue.test.ts`, QA F), lease fencing and stale-owner publication
(`apps/worker/test/batch5.test.ts`, `packages/data/test/batch5-artifacts.test.ts`), files promoted before the manifest
commit and staging leftovers never advertised (`batch5-artifacts`), notifications separate from generation and no
regeneration on notification failure (`batch5-notifications.test.ts`), review/dismiss/retry/answer state machine with
revision checks and 409s (`apps/api/test/batch3.test.ts`, QA L, browser 8 and 13), answer history across revisions and
restart (QA D, `packages/data/test/batch3.test.ts`), bad cursors (`apps/api/test/batch2.test.ts`), CLI bearer limited to
injection (QA G, `apps/api/test/api.test.ts`), traversal-shaped ids and no physical paths/secrets in responses (QA G,
`security.test.ts`), backup consistency (`batch5-backup.test.ts`). I traced one fixture intake end to end in my own
isolated stack (ports 4200/3200, scratch DB): 4 demo injections → queued → worker → ready/needs_input/skipped, previews,
authenticated downloads.

`worker:once` (read, then its test): claims at most one due job and one notification, never polls Gmail, no loop.

### Gmail implementation (`packages/data/src/gmail/*`, `integrations.ts`, `apps/api/src/routes/integrations.ts`)

1. Start requires a session; state is 24 random bytes, stored hashed, bound to the session, 10-minute TTL, single use
   even when the first use fails (`apps/api/test/batch4.test.ts` "OAuth callback failures are safe").
2. Callback must equal `PUBLIC_APP_URL + /api/integrations/gmail/callback`; otherwise Connect returns
   `GMAIL_REDIRECT_MISMATCH` and `check:ready` fails (test "local 4177 override stays consistent").
3. Scope: `GMAIL_SCOPES = [gmail.readonly]` only, `access_type=offline`, `prompt=consent`, `include_granted_scopes=false`.
   The grant reads the whole mailbox; sender filtering is the app's own control.
4. Tokens: AES-256-GCM with `TOKEN_ENCRYPTION_KEY`; refresh merge keeps the old refresh token; status DTO has no token
   fields (test "success stores encrypted tokens only").
5. Late refresh/poll cannot resurrect a disconnected or replaced connection (`connection_token`, tests in
   `batch4.test.ts` "connection identity").
6. Disconnect deletes locally, then revokes best-effort; history kept (test "deletes credentials before revoking").
7. Revoked/expired → paused with reconnect text; quota → keeps polling (tests) — **F2** closed the 401-by-status gap.
8. Bounded listing (5 × 50 ids), 10 messages per cycle, window halving, overlap 120 s, history cutoff 30 s (tests).
9. Reconnect identity: see O4.
10. Exact allowlist, DMARC-fail refusal, MIME without remote fetches (tests). 11. Attachment limits enforced at intake with
    visible warnings; missing bytes fail the task before the engine (`ATTACHMENT_UNAVAILABLE`). 12. `receivedAt` =
    `internalDate`, `createdAt` = ingestion (test). 13. API, worker and the new poll-once all read the same
    `loadConfig()` / `DATABASE_PATH` / key; the web proxy uses `API_ORIGIN`.

### Engine and grounding

- Live spec (`liveSpec.ts`): the JSON Schema is generated from the same `LiveResponseSchema` used for validation, and
  `SYSTEM` is used for both generate and repair (`live.ts`); repair output passes the identical `evaluate`. Darren's
  `live-spec.test.ts` checks enum coverage and that the placeholder example fails grounding. Read: rule 8's limits (2
  blocks, 7 rows, 5 columns) equal `layout.ts` constants. Unchanged by this audit.
- Four scenarios offline (real pipeline): proposal → DOCX + 5-slide PPTX; report → calculated; ambiguous → 4 specific
  questions, then answers → revision 2 (QA D, browser 3); no_action → skipped, no products/files.
- CSV: base 12,000 → 15,000, +3,000, 25%, orders 120 → 150, AOV $100 both months. Changed February website 10,000 →
  11,000: $16,000, +$4,000, 33.3%, AOV $106.67 in prose, tables, chart and both files (`final-audit.test.ts`). Negative,
  blank and locale-formatted (`"10.000"`) amounts → `INVALID_CSV`; mixed currency → `UNSUPPORTED_INPUT`; zero denominator
  → **F1**.
- Dates: deadlines from `email.receivedAt` + organization timezone (DST and relative-date tests in `engine.test.ts`,
  `batch5.test.ts`); engagement end = start + 7N − 1 days, labelled calculated with "confirm it with the client"
  (`batch7.test.ts` A4).
- Grounding: unknown source ids, non-exact or > 300-char quotes, unsupported amounts/percentages/dates, missing basis
  evidence and layout overflow are rejected (`grounding.ts`, `batch5/6/7` tests). Hostile-plus-useful brief → ready with
  an instruction-like warning and no obeyed instruction; injection-only brief → `usable_project_brief` question (I1).

### Exported files (re-rendered from fixtures at the `c20fb24` engine; **not** the historical live files)

Generated with `pnpm exec tsx packages/engine/test/render-samples.ts` into gitignored `var/final-audit/office/`.
Office bytes differ per run (timestamps); hashes identify these copies only.

| File | Bytes | SHA-256 (prefix) | Render | Coverage |
|---|---|---|---|---|
| proposal Maple-Moss-Kickoff-Deck-r1.pptx | 101,292 | `3030673c4108` | PowerPoint → PDF | 5/5 slides |
| proposal Maple-Moss-Proposal-r1.docx | 11,982 | `3f27b665b384` | Quick Look | page 1 only |
| report January-February-2026-Sales-Update-r1.pptx | 119,937 | `e802be94448a` | PowerPoint → PDF | 5/5 slides |
| report January-February-2026-Sales-Performance-Report-r1.docx | 11,488 | `081822c1ebb7` | Quick Look | page 1 only |
| long / hostile proposal decks, changed / many-channel report decks | — | — | PowerPoint → PDF | 4 × 5/5 slides |
| matching 4 DOCX | — | — | Quick Look | page 1 each |

All 30 slides: no title or body overflow, nothing outside the canvas, long client name wraps in two lines, `<Studio>
"Beta"` renders literally, tables (6 rows) fit, chart single-series with data labels, footers and basis lines present.
DOCX page 1: header, title block, basis notes, fixed tables, bullets readable. Quick Look ignores fixed table widths, so
table widths are not evidence of Word layout.

### Web, browser and delivery

- Browser suite: real API + worker + fixture engine + Next dev on temporary storage, Playwright Chromium headless shell
  153. 25 passed (includes login return variants, logout revocation, stale 409, offline failure, phone layouts, failed
  download, quiet-hours label), 1 skipped (explained above).
- Measured contrast (WCAG formula on computed colours, alpha blended over the effective background, every visible text
  node): `/` 76 nodes, `/notifications` 31, `/settings` 86, proposal task 159, report task 163, ambiguous 71, no_action
  55. Failures: only disabled "Save changes" buttons (4.40:1; disabled controls are exempt). Focus ring: white 3 px on
  the dark UI (19.8:1 against `#0a0a0a`), and after F4 `#111827` on paper.
- Viewports: 1440×900, 390×844, 320×640 on task and settings pages: `scrollWidth == innerWidth`, no element beyond the
  viewport; only undersized target is the skip link (visible on focus only).
- Keyboard: Tab order skip link → nav → back → downloads → jump-to-review → preview tabs → evidence chips; all with
  visible focus; source dialog traps focus, Escape closes and returns focus to the chip.
- Return path: unit matrix plus browser tests 7, 21 and 24. Encoded `/%2F%2F…` stays same-origin (asserted with `new URL`).
- Delivery adapter: `packages/delivery/test/delivery.test.ts` covers eligibility gate, missing credentials named not
  revealed, recipient validation, closed window without template, 401/429/503/400/network mapping, timeout →
  `DELIVERY_UNCERTAIN` non-retryable, accepted ≠ delivered, redaction. No live send.

## The 44 questions

Format: status — expected / observed — evidence.

### Platform, worker and Gmail

- **D1** PASS — clean baseline and exact refs / reproduced on `b69ddd5`, harness `d248e51` — command table above.
- **D2** PASS — contract-conforming intake, leases, publication, transitions, downloads, review / all held — reused tests
  listed under "Platform", QA 53/53, browser 1/8/13.
- **D3** PASS — notification failure never regenerates; channels disabled / outbox only, `WHATSAPP_USE_CASE_ELIGIBLE=false`
  — `batch5-notifications.test.ts`, e2e env, my stack env.
- **D4** PASS (offline) — session-bound single-use state, readonly scope, web callback / as expected —
  `apps/api/test/batch4.test.ts`. Live consent NOT RUN.
- **D5** PASS (offline) with O4 open — encrypted, refresh-merge, race-safe disconnect/reconnect / held; 401 gap fixed (F2)
  — `batch4.test.ts`, `final-audit.test.ts`.
- **D6** PASS under tested conditions — no drops/duplicates / held — `batch4.test.ts` history/overlap/pagination,
  `gmail.test.ts`, poll-once repeat test.
- **D7** PASS — ignore vs queue and snapshot documented / documented and proven — runbook "Settings semantics",
  `final-audit.test.ts` two semantics tests, `batch4.test.ts` snapshot test.
- **D8** PASS — secret-free exact steps / `integration.md` "Gmail setup for Darren"; uses web callback only.
- **D9** NOT RUN — no consent occurred. What would prove it: Settings shows the expected account, state connected, no
  error marker. Untested: real token exchange, refresh, revocation, Google error texts.
- **D10** NOT RUN — no inbox. Generation is prevented deterministically by construction (no engine import) and by test
  (`poll-once.test.ts`: live-mode task stays queued, attempts 0).
- **D11** PASS — one candidate / all fixes in `c20fb24`, checks and browser/QA on it — command table.
- **D12** PASS — honest records / this file, `integration.md`; historical record left intact in
  `docs/batches/batch-7/integration.md`.

### Engine, grounding and Office output

- **J1** PASS — spec from the validating schema for generate and repair / unchanged and aligned — `liveSpec.ts`, `live.ts`,
  `live-spec.test.ts`.
- **J2** PASS — bounded failures / invalid kind, malformed JSON, incomplete, failed repair, timeout, cancellation all end
  in typed errors within 3 calls — `batch5.test.ts`, `live-spec.test.ts`.
- **J3** PASS — example never content / example fails grounding (2 calls → `MODEL_INVALID_OUTPUT`); live mode has no
  fixture fallback (`MODEL_CONFIGURATION` before work) — `live-spec.test.ts`, `batch5.test.ts`.
- **J4** PASS — four scenarios / as expected — engine tests, QA A/B/D/E, browser 1/2/3/5.
- **J5** PASS after F1 — metrics and narrative change together, zero denominators honest / yes — `final-audit.test.ts`,
  `batch6.test.ts` sweep.
- **J6** PASS — grounded per contract / rejects unknown ids, inexact quotes, unsupported numbers; labels match meaning —
  `grounding.ts` tests, QA "evidence quotes".
- **J7** PASS — receipt-anchored deadlines, labelled calculated end date / yes — `engine.test.ts`, `batch7.test.ts` A4.
- **J8** PASS — clarify or fail, never invent / missing attachment → `usable_project_brief`, conflicts → questions, bad
  CSV → `INVALID_CSV` — `batch5/7` tests, QA H/I.
- **J9** PASS — `synthetic.ts` hostile-brief (ready, warning, no obeyed instruction) vs injection-only (question) —
  `batch6.test.ts`, `batch7.test.ts` I1.
- **J10** BLOCKED — exact live files not on this machine (O1). Re-rendered fixture files verified instead (5 slide parts,
  facts, quotes via tests).
- **J11** PARTIAL — all 30 slides PASS in PowerPoint; DOCX page 1 only (Quick Look); full DOCX NOT RUN (O2).
- **J12** — Changes after the live proof: `calculations.ts`, `content.ts`, `grounding.ts` (report wording and zero shares
  only; proposal path unchanged). They do not touch `live.ts`, `liveSpec.ts`, the provider or renderers. The historical
  live proposal proof is still applicable to the proposal path in spirit but was **not** re-run on `c20fb24`; live
  report, clarification and no-action remain unverified.

### Web, browser and delivery

- **M1** PASS — real stack / 25 passed, 1 explained skip, 0 failed on `c20fb24`.
- **M2** PASS — deep-link return and hostile rejects / browser 7, 21, 24 plus unit matrix; finite set, not exhaustive.
- **M3** PASS — states, revisions, history, persistence / browser 1, 3, 8, 13, 14; QA D/L restart.
- **M4** PASS after F4 — measured viewports, keyboard order, dialog focus.
- **M5** PASS — measured with WCAG luminance on computed colours (method and counts above); only exempt disabled text below
  4.5:1.
- **M6** PASS — browser 13 (stale answers keep text), 14 (server validation keeps input), 20 (offline, no false success),
  23 (failed download), 8 (409 review).
- **M7** PASS — receivedAt vs createdAt, demo/live, fixture badge, calculated labels shown — browser 11, my own page text
  check on the no_action task.
- **M8** PASS — downloads are authenticated stored bytes with checksum verification; previews are not export evidence —
  browser 1/2, QA B.
- **M9** PASS (offline) — every callback marker has actionable text; F6 improved `exchange_failed` — `settings-view.tsx`,
  `apps/api/test/batch4.test.ts`. Live consent NOT RUN.
- **M10** PASS after F5 — copy matches proven behaviour.
- **M11** PASS — adapter tests listed above; no live send.
- **M12** PASS — fixes use existing tokens and classes; SpaceXAI dark UI unchanged; paper previews stay white.

### Shared release integrity

- **U1** — base `b69ddd5`, code tested `c20fb24`; later commits docs-only (see `integration.md`).
- **U2** PASS — working tree clean after commit; audit-owned temporary folder removed; `main` untouched; pushes recorded in
  `integration.md`.
- **U3** PASS — Joanne's engine, Maricella's UI/delivery/browser suite, Darren's platform and the Claude-only provider
  preserved; no provider or design change.
- **U4** PASS — every check executed; the two non-zero exits (stale `.next` types, own dev build in lint) and the missing
  browser are explained above.
- **U5** PASS — `git ls-files` contains no `.env`, `*.sqlite`, artifacts or logs; the test password, session secret and
  key for my stack were generated per run in a `chmod 600` scratch file outside the repository.
- **U6** PASS — zero provider calls and zero sends: fixture mode, empty model key in the failure stack, outbox channel,
  no Google credentials.
- **U7** — fixed: F1–F8 (tests named above). Open: O1 (Darren's files), O2 (Word/Pages tooling), O3–O5 polish.
  Dependent on accounts: Gmail connection and intake, live Claude beyond one proposal, WhatsApp, host.
- **U8** — Truthful demo now: demo-intake proposal, report, clarification and no-action in fixture mode with honest labels,
  reviewed state persistence, authenticated downloads, all 5 slides per deck rendering in PowerPoint; one historical
  live Claude proposal. Unverified: Gmail connection and intake, Gmail → live Claude, other live scenarios, full Word page
  layout, WhatsApp, overnight/remote.
