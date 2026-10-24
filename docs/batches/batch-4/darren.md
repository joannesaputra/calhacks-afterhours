# Batch 4 — Darren (platform: Gmail live intake and live wiring)

- **Branch:** `platform-batch4`, created from `origin/platform` @ `aaed3db` (the Batch 3 platform handoff). `platform` and `main` are untouched.
- **Candidate:** implementation commit `72ecb27` (this report is committed on top of it).
- **Team branches seen on origin:** `main` `5d8f342`, `platform` `aaed3db`, `person-2-engine` `258e2eb`. No `engine-batch4`, no Maricella branch.
- **Credentials on this machine (names only):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `MODEL_NAME` and all `TWILIO_*` are empty. So every live check below is **BLOCKED** (external prerequisite), not failed.

## What changed (owned files only)

Migration `packages/data/migrations/002_batch4_gmail_live.sql`; `packages/data/src/{integrations,gmail/poll,ingest,config,notifications,queries,settings,tasks}.ts`;
`packages/contracts/src/api.ts` (stricter settings patch); `apps/api/src/{main.ts,routes/integrations.ts}`; `apps/worker/src/worker.ts`; `scripts/ready.ts`;
tests `packages/data/test/batch4.test.ts`, `apps/api/test/batch4.test.ts`, `apps/worker/test/batch4.test.ts` (+ two existing tests adjusted to the new signatures);
docs `runbook.md`, `backend-handoff.md` (Batch 4 section), `contract-change-requests.md` (platform note). Details: `docs/backend-handoff.md` → "Batch 4 platform".

Defects found in the existing foundation code and fixed here:

1. A poll that finished after Disconnect set `state='connected'` again (unconditional UPDATE). Now writes require the current `connection_token`.
2. A token refresh from an old connection could overwrite a reconnected account's tokens. Same fix, IMMEDIATE transaction.
3. More than 250 new messages: the oldest unlisted ones were skipped and the checkpoint moved past them. Now the window is halved until it lists completely.
4. One malformed message (parse or envelope error) failed every later cycle. Now it is audited and skipped.
5. Mail up to 120 s before connecting counted as new. Now the history cutoff is `connectedAt − 30 s`.
6. Revoked credentials were re-tried against Google every 15 s. Now polling pauses until Reconnect.
7. The worker read the *current* organization settings, so edits changed already-queued work. Now the profile is snapshotted at ingestion.
8. `model.configured` was true without `MODEL_NAME` and for `anthropic`, which the engine does not implement. Now mirrors the engine.
9. A browser-edited WhatsApp recipient would have been used for live sends. Now live sends go only to operator `TWILIO_WHATSAPP_TO`, checked before the adapter runs.
10. Nested settings patch objects dropped unknown keys silently (e.g. `notifications.eligible`). Now 400.

## Commands and results (all on `72ecb27`, isolated temp DBs)

| Command | Exit | Result |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | no dependency change |
| `pnpm typecheck` | 0 | |
| `pnpm lint` | 0 | |
| `pnpm build` | 0 | |
| `pnpm test` | 0 | 14 files, 145 tests (Batch 3 platform had 98; +47 Batch 4) |
| `node /tmp/b4-proxy/proxy-oauth.mjs` (real API on 4177 + real `next dev` proxy, fake Google client id) | 0 | see Q10 |
| migrate a **copy** of the local `var/afterhours.sqlite` | 0 | `002` applied; 1 existing task, snapshot NULL (falls back to settings) |
| `tsx scripts/ready.ts` (live mode, no keys) | 0 | `INFO Gmail — not configured`, `INFO Live model — NOT configured: MODEL_NOT_CONFIGURED` |
| `tsx scripts/ready.ts` (Google set, redirect on wrong port) | 1 | `FAIL GOOGLE_REDIRECT_URI matches PUBLIC_APP_URL` |

Mocks: Google token exchange/profile/revoke (injected `GmailOAuthPort`), Gmail API (in-memory `GmailApi`), the engine (spy returning `readyResult`) and the delivery adapter (spy). The consent URL is built by the real `google-auth-library`. None of these prove a live account, model or WhatsApp send.

## Role questions

1. **Real new Gmail → task → files chain:** **BLOCKED.** No Google OAuth client or test account configured, no model key. A mocked chain passes (worker test "mocked Gmail -> worker chain": allowed sender → `ingestionMode=gmail`, `generationMode=live`, engine called once, ready with 2 files; spam reaches nothing). It is wiring evidence only, not live intake.
2. **Scope, state, encryption:** **PASS (unit/route).** Scope `https://www.googleapis.com/auth/gmail.readonly` only, `access_type=offline`, asserted on the real consent URL. Tests: expired state (601 s) → `reason=expired`; no cookie → `session`; forged/missing → `invalid_state`; replay → `invalid_state`; a state burned by a session mismatch cannot be reused; denied → no exchange; missing scope → `reason=scope` + revoke; no refresh token → `no_refresh_token`; exchange error → `exchange_failed` without details. Tokens stored as `v1.` AES-256-GCM; never in status/settings bodies. Live Google: **BLOCKED**.
3. **History, overlap, pagination:** **PASS (mock).** A message 90 s before connect (inside the overlap) and one a day before are not ingested. 300 messages (> 250 cap): window narrows, all 300 ingested exactly once (300 distinct source keys), a further cycle ingests 0. 25 messages: 10 per cycle oldest-first; checkpoint equals the 10th message's internalDate. Failed fetch does not advance (existing test).
4. **Disallowed sender / remote content:** **PASS (mock).** Unknown and fixture `.example` senders: 0 attachment downloads, 0 tasks, 0 jobs (so 0 engine/model calls), audit rows hold only reason + short ref. DMARC-failed allowed address refused. HTML fallback strips images/scripts/links and fetches nothing (existing MIME test); the poller has no URL fetch code path.
5. **Live provider/model:** **BLOCKED** (no key). Fixture fallback impossible: anthropic → `MODEL_PROVIDER_UNSUPPORTED`; openai without key or `MODEL_NAME` → `MODEL_NOT_CONFIGURED`; engine call count 0; no files, no notification. Configured live task reaches the (mocked) engine with `mode=live`. Retryable provider 503: one retry in the same revision after ~30 s, then `failed`, no artifacts.
6. **Revoked / disconnect / quota / missing credentials:** **PASS (mock).** Revoked → `error` + "Reconnect Gmail", polling paused (no Google calls), task kept, Reconnect resumes. Disconnect deletes credentials before revoke, keeps tasks, allows reconnect. Quota → error message, no pause, checkpoint unchanged. Missing Google credentials → `503 GMAIL_NOT_CONFIGURED`, status explains, app usable.
7. **Live notification state:** **BLOCKED** for a real send (no Twilio, no eligibility confirmation, no designated recipient). Evidenced with a mock adapter: blocked (4 operator reasons, adapter not called, no retry), accepted with provider id recorded as `accepted` (never `delivered`), accepted-without-id and `DELIVERY_UNCERTAIN` → `failed`, not resent; outbox → `simulated`.
8. **Remaining live checks:** Gmail account, live model, live WhatsApp all **BLOCKED** on credentials/eligibility. Demo claim must say: Gmail intake and live AI are implemented and unit-tested with mocks, not demonstrated live.
9. **Branch isolation / earlier gates:** `platform-batch4` only; `platform` stays at `aaed3db`. Batch 2 and Batch 3 integrated gates remain **FAIL/BLOCKED**: QA found that the real engine (`258e2eb`) cannot be stored by the platform (file ids contain `/`, DEF-1 in `docs/qa/defects.md` on the QA branch); no experience branch exists for the browser gate.
10. **OAuth through the real proxy/cookie path:** **PASS (no Google network).** API on 4177, real `next dev` on a free port, `PUBLIC_APP_URL` = that web origin: login via `/api/session` → `HttpOnly; SameSite=Lax`, no `Domain`; `/api/integrations/gmail/start` → 302 to `accounts.google.com` with `redirect_uri=http://localhost:<web>/api/integrations/gmail/callback`, readonly scope, offline; callback through the proxy with `error=access_denied` and own state → `/settings?gmail=error&reason=denied` (state accepted = session bound through the proxy); replay → `invalid_state`; no cookie → `session`; forged → `invalid_state`; start without session → 401. The real code exchange needs Google: **BLOCKED**.
11. **Late refresh/poll after disconnect or account change:** **PASS (unit).** Refresh after disconnect returns false, credentials stay deleted. Old-connection refresh after reconnect cannot overwrite new tokens. Disconnect mid-cycle → `superseded`, 0 tasks, state stays disconnected, checkpoint not written.
12. **Prior regressions:** **PASS.** Oversized Gmail attachment not downloaded and the task carries the "larger than 10 MB" warning; `receivedAt` = Gmail internalDate, `createdAt` = ingestion time; Batch 2/3 tests (fixture `receivedAt`, invalid cursor 400, port check, intake limits) all still pass in the 145.
13. **QA reproducibility:** **PASS.** Tests use in-memory/temp DBs; the proxy script builds its own environment from scratch, picks free ports (or `QA_API_PORT`), and kills only its own process group. No shared checkout or real DB is touched.
14. **Live core evidence:** **BLOCKED.** No candidate/request/file evidence exists for live intake. Notification evidence is separate and also BLOCKED.

## Universal questions

1. **Input/output and commit:** `72ecb27`; test names above; proxy transcript in Q10.
2. **Commands/exit codes:** table above.
3. **Modes:** intake demo + gmail (mocked Gmail API); intelligence fixture + live (engine mocked; live provider BLOCKED); delivery simulated + blocked (+ accepted/failed via mocked adapter). No live external call was made.
4. **Contract:** routes, states and DTO shapes unchanged. One tightening: strict nested settings patch (platform note in `contract-change-requests.md`).
5. **Failure without fake success:** missing Google → 503 + status reason; missing model → typed nonretryable task error, no fallback; malformed message → audited skip; quota → retry, no pause; uncertain send → failed, never resent; ready results untouched by delivery failures.
6. **Persistence/integrity:** organization and mode snapshots per task; checkpoint/connection token persisted; migration upgrades an existing DB copy without data loss.
7. **Boundaries:** tokens encrypted, never in DTOs, redirects or errors; provider error text redacted; settings cannot set credentials/eligibility; live WhatsApp only to the operator recipient; nothing was sent anywhere during testing.
8. **Remaining:** live Gmail, live model, live WhatsApp **BLOCKED** (Darren to provide Google client + test account; Joanne/Darren a model key; Maricella/operator Twilio + eligibility). Batch 2/3 gates **FAIL** on DEF-1 (Joanne) and **BLOCKED** on the experience branch (Maricella). These stop the live-core gate.

## Next handoff

- Joanne: fix DEF-1 (`stableId` must not contain `/`), push `engine-batch4` with the OpenAI path.
- Maricella: push the experience branch; settings UI must send only documented fields (strict schema).
- Darren: once both exist, build `integration` from `platform-batch4` + engine + experience, rerun fixture regressions and QA, then the single deliberate live Gmail → live model smoke with real credentials.
