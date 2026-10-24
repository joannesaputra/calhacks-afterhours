# Runbook (platform)

## Local setup

```bash
pnpm install && pnpm setup:local && pnpm db:migrate && pnpm db:seed && pnpm check:ready
pnpm dev
```

`setup:local` is idempotent: it never overwrites an existing value in `.env`. The login password is
`APP_PASSWORD` in `.env`.

## Release candidate (Batch 6)

The tested candidate, versions and command ledger are in `docs/release/candidate.md`; what is real, simulated, blocked or not
run is in `docs/release/capability-matrix.md`; the allowed claims, limits, fallback and the rehearsed demo are in
`docs/release/status.md`. Two ways to run it were exercised:

- **Source dev:** `pnpm dev` (`[web]`, `[api]`, `[worker]` prefixes) then `pnpm demo:proposal` / `pnpm demo:report` or the UI buttons.
- **Built runtime (what the compose file runs):** `pnpm build` (set `API_ORIGIN` to the API's real address first: Next bakes the
  `/api` rewrite at build time), then `node --import tsx apps/api/src/main.ts`, `node --import tsx apps/worker/src/main.ts` and
  `pnpm --filter @afterhours/web start`.

If port 4000 is taken by another program, set `API_PORT` and `API_ORIGIN` together (`pnpm check:ready` fails when they
disagree). Never stop a process you did not start. Reloading a task page always shows the stored state.

## Modes — always disclosed in the UI and status endpoint

- `GENERATION_MODE=fixture` (default): Person 2's fixture intelligence. Disclose as fixture output.
- `GENERATION_MODE=live`: requires `MODEL_PROVIDER=openai`, `MODEL_NAME` and `OPENAI_API_KEY` (the engine implements
  only OpenAI; `anthropic` fails with `MODEL_PROVIDER_UNSUPPORTED`). Anything missing → `GET /api/integrations` shows
  `model.configured=false`, `pnpm check:ready` prints an INFO line, and live tasks fail nonretryably with
  `MODEL_NOT_CONFIGURED` before the engine runs. There is never a fixture fallback.
  Mode and the organization profile are snapshotted per task at ingestion; changing them affects only new tasks.
- Demo injection (`ingestionMode=demo`) vs real Gmail (`ingestionMode=gmail`) is stored per task.

## Gmail (P1) — Google Cloud console steps

1. Create/choose a Google Cloud project. Enable **Gmail API**.
2. OAuth consent screen: User type **External**, publishing status **Testing**. Add the dedicated test inbox under
   **Test users**. Scope: `https://www.googleapis.com/auth/gmail.readonly` only.
3. Credentials → Create **OAuth client ID** → **Web application**. Authorized redirect URI must exactly equal
   `GOOGLE_REDIRECT_URI`, and `GOOGLE_REDIRECT_URI` must be exactly `PUBLIC_APP_URL` + `/api/integrations/gmail/callback`
   (local default `http://localhost:3000/api/integrations/gmail/callback`). It is the **browser-facing web origin**,
   never the private API port (4000/4177): the session cookie lives on the web origin and the Next proxy forwards
   `/api/*` to the API. A mismatch makes `pnpm check:ready` FAIL and Connect return `503 GMAIL_REDIRECT_MISMATCH` (a browser is sent back to `/settings?gmail=error&reason=redirect_mismatch`).
4. Put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`. Restart API and worker.
5. In the app: Settings → add the test sender to **allowed senders** (exact address) → Connect Gmail.
6. Send a new email from the allowed sender to the test inbox. The worker polls every
   `GMAIL_POLL_INTERVAL_SECONDS` (15 s). Only messages received after connecting are processed.

### Polling behaviour (Batch 4)

- History: a message whose Gmail `internalDate` is more than 30 s before `connectedAt` is never ingested. The listing
  itself overlaps 120 s behind the checkpoint; the handled-id list plus the unique `gmail:<integration>:<messageId>`
  source key make repeats harmless.
- Bounds per 15 s cycle: at most 5 list pages × 50 ids, at most 10 messages fetched, oldest first. The checkpoint
  only advances to the newest message actually processed.
- More than 250 new messages in the window: the window's end is halved and saved, nothing is processed that cycle,
  and halving repeats until the window lists completely. It is then drained oldest-first and reopened. The checkpoint
  never moves past an unlisted message.
- A malformed message is recorded in `intake_audit` (`malformed_message`) and skipped; it cannot block the inbox.
- Gating before any download, task or model call: exact allowed-sender match; an explicit `dmarc=fail` in Gmail's
  `Authentication-Results` for an allowed address is refused (`sender_authentication_failed`). Fixture `.example`
  addresses are never live senders unless the operator adds them. Unknown senders only add a bounded audit row.
- Gmail is read-only: no remote images, links or macros are fetched; HTML is reduced to text locally.
- Revoked/expired credentials pause polling (no calls to Google) until Reconnect. Quota/5xx errors keep polling.
- Disconnect deletes the stored tokens first, then revokes at Google. Each connection has a rotating
  `connection_token`; a token refresh or poll result from a disconnected or replaced connection is discarded.

Testing-mode limits: refresh tokens for unverified apps in Testing status expire after about 7 days; only listed test
users can connect. A successful test connection is **not** Google production verification.

### Gmail troubleshooting

| Symptom | Fix |
|---|---|
| `/settings?gmail=error&reason=session` or `invalid_state` | Start Connect again from the same logged-in browser tab within 10 minutes. |
| `reason=no_refresh_token` | Remove the app at myaccount.google.com/permissions, then reconnect (consent is forced). |
| Status `error`: "Reconnect Gmail in Settings" | Token revoked/expired (Testing tokens expire ~7 days). Disconnect and reconnect. Task history is kept. |
| `503 GMAIL_NOT_CONFIGURED` (browser: `/settings?gmail=error&reason=not_configured`) | Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. |
| `503 GMAIL_REDIRECT_MISMATCH` | Set `GOOGLE_REDIRECT_URI` to `PUBLIC_APP_URL` + `/api/integrations/gmail/callback`, and register that exact URI in Google Cloud. |
| `reason=scope` | The Gmail read permission was unticked on Google's consent screen. Connect again and allow it. |
| `reason=expired` | More than 10 minutes passed between Connect and the callback. Start again. |
| Mail ignored | Sender not in allowed senders (exact match), automation disabled, or message older than the connection. |

## Using a different API port locally

Port 4000 may be taken by another project. Three things read the API address and they must agree:

| Reader | Variable |
|---|---|
| API (`apps/api`) listens on | `API_PORT` |
| Web proxy (`apps/web/next.config.mjs`, `/api/*` → `/v1/*`) calls | `API_ORIGIN` |
| Demo CLI (`pnpm demo:proposal`, `demo:report`) calls | `API_ORIGIN` |

Set both to the same port. Use either your own untracked `.env` (git-ignored) or shell variables; never edit `.env.example` for a machine-specific port. Example with port 4177 and a throwaway database, using only shell variables:

```bash
export API_PORT=4177 API_ORIGIN=http://127.0.0.1:4177
export DATABASE_PATH=/tmp/ah-scratch/db.sqlite ARTIFACTS_DIR=/tmp/ah-scratch/artifacts
pnpm check:ready   # fails with "API_PORT matches API_ORIGIN" if the two disagree
pnpm dev
```

Shell variables win over `.env` values. If `API_ORIGIN` is left unset the default is port 4000 everywhere, so setting only `API_PORT` is a mismatch: `pnpm check:ready` fails and the API logs a warning at startup. Non-loopback origins (Docker Compose uses `http://api:4000`) are not checked. Verified together on 4177 for the API, the web proxy on port 3000 and the demo CLI (see `docs/batches/batch-2/darren.md`).

## Worker behaviour (Batch 5)

- One engine job at a time. 90 s lease, renewed every 15 s by a job heartbeat that is separate from the worker's own
  heartbeat (`worker_status`, written every 10 s; "Worker healthy" means it is < 45 s old). 240 s hard deadline. At most
  2 automatic attempts per revision (a transient error is retried once after about 30 s). Expired leases are recovered
  on start and between jobs.
- **Fenced publication.** Files are staged privately, then hard-linked to an immutable, content-qualified path
  `<task>/r<revision>/<artifactId>.<sha256[:16]>.<format>` (never overwritten, never replaced), re-verified against the
  manifest bytes, and only then committed (manifest + ready status + one notification intent in one transaction). The
  public artifact id stays deterministic per task/revision/product/format; only the physical file name carries the hash.
  An attempt that lost its lease can neither promote files (ownership is re-checked first) nor change the winner's bytes
  (different content means a different path). A dead attempt's files stay on disk, unreferenced; nothing ever links them
  into a manifest.
- **Orphan files.** Cleaned at most every 6 h by the worker, and only when a file is a regular file (no symlink), under
  `<task>/r<n>/`, referenced by no manifest row, older than 24 h, and its task revision has no queued/running job.
  `.staging` leftovers older than 1 h are removed separately. Referenced files are never deleted.
- **SIGTERM/SIGINT** (a container stop): stop claiming and polling, wait up to 10 s for the running job, then abort it,
  return it to the queue without consuming an attempt (only a lease this process owns), close the database, exit 0.
  Compose gives 20 s (`stop_grace_period`).
- **SIGKILL / power loss / OOM**: nothing can run. The job keeps its lease until it expires (≤ 90 s), then the next
  worker loop requeues it (`LEASE_EXPIRED`, attempt 2 of 2) and completes it. A healthy worker's unexpired lease is never
  taken. If the second attempt also dies the task fails with a retryable error and can be retried from the UI.
- An engine that ignores the `AbortSignal` cannot hold the worker: the deadline and a lost lease reject the wait. The
  engine's own CPU/network work may still continue in the background; its late progress and result are discarded.
- **A sleeping laptop stops all processing** (timers and the worker both pause). Closing the browser does not: only the
  worker process matters. Overnight operation needs an always-on host with a persistent disk. A demo that compresses
  "overnight" into minutes must say it is time-compressed.

## Notifications and quiet hours (Batch 5 policy)

Default channel `outbox`: messages are composed and stored as `simulated`; nothing is sent. Live WhatsApp needs Twilio
credentials, `WHATSAPP_USE_CASE_ELIGIBLE=true` (operator-confirmed), an operator-designated recipient
`TWILIO_WHATSAPP_TO`, and an open customer-service window (`WHATSAPP_CUSTOMER_SERVICE_WINDOW_UNTIL`) or an approved
`TWILIO_CONTENT_SID`. `accepted` is provider acceptance only, never "delivered".

**Schedule** (pure function `computeDeliverySchedule`, `packages/data/src/schedule.ts`; persisted as UTC instants):

| Situation | Delivery time |
|---|---|
| Quiet hours off, or now outside the window | immediately (generation is never delayed either way) |
| Now inside the window, `digestTime` outside it | first `digestTime` wall-clock occurrence at or after now |
| Now inside the window, `digestTime` inside it | end of the window containing now (never inside quiet hours) |

Window is `[start, end)`; `start > end` crosses midnight. Example (default 22:00–08:00, digest 08:00,
`America/Los_Angeles`): a result at `2026-10-24T06:30:00Z` (23:30 on Oct 23) is delivered at `2026-10-24T15:00:00Z`
(08:00 PDT). "Next morning" is a local calendar date, never now + 24 h (spring forward: 7.5 h later; fall back: 9.5 h).
DST gap (a time that does not exist, e.g. 02:30 on 8 Mar): moved forward by the gap (03:30 PDT). DST overlap (a time that
occurs twice): the earliest occurrence that is not before now. A repeated local hour never creates a second digest: groups
are keyed by the local date of the scheduled instant. Invalid IANA zones (including `UTC+3`), non-`HH:mm` times and an
enabled window with identical start and end are rejected by `PATCH /api/settings` with 400; if one is already stored,
identical start/end is treated as "no quiet hours" so a ready commit cannot fail.

**Membership and dedupe.** One row per task revision per channel in `notification_members` (UNIQUE), shared by immediate
and digest routes, so a revision cannot be delivered twice. During quiet hours results join the open digest for the
target local date (key `digest/<localDate>/<channel>`). When the worker claims a notification it **seals** its members
(snapshot). A result arriving after the seal is never appended: it starts a follow-up digest (`.../2`, `.../3`) or, if
not in quiet hours, an immediate notification. After a restart the pending schedule is read from the database; nothing
lives in memory.

**Dispatch re-checks current policy.** At claim time quiet hours are evaluated again against the current settings: a
worker that starts late during quiet hours does not send; it moves the row to the next eligible time (overdue digests for
different dates are merged into one). A worker that starts late outside quiet hours sends the overdue message once.
Editing quiet hours or the digest time affects new results; queued ones keep their schedule unless dispatch lands in
quiet hours. For live channels a queued message is blocked with `POLICY_CHANGED` if the Settings channel or recipient
changed after it was queued (it is never rerouted), and the usual operator checks (`blocked`, terminal) run at dispatch.
Outbox rows send nothing and never go stale. The ready files stay reviewable in every case.

**Uncertain submissions.** Before the provider is called the worker durably records `submit_started_at`. If the worker
dies or the lease (60 s) expires after that on a live channel, recovery records `failed` with `DELIVERY_UNCERTAIN` and does
not resend (no reconciliation or manual resend exists yet). Death before the marker releases the row for a normal retry.
A delivery adapter must therefore time out in well under 60 s. A provider timeout (`DELIVERY_UNCERTAIN`) is terminal;
other errors retry only when marked `retryable` (3 attempts, 60 s × attempt backoff). Notification code never touches
jobs or task status: generation is not rerun and ready work stays ready.

## Deployment (single host)

```bash
cp .env.example .env   # or `pnpm setup:local`; set PUBLIC_APP_URL + GOOGLE_REDIRECT_URI to the public HTTPS URL
docker compose up -d --build
```

- Only `web:3000` is published; put HTTPS (reverse proxy or platform TLS) in front. `api` is reachable only at
  `http://api:4000` inside the compose network. `API_ORIGIN` for web is `http://api:4000` (the loopback port check does
  not apply to non-loopback hosts).
- `api` and `worker` share the `afterhours-var` volume (SQLite + artifacts) on local disk. Never run replicas, never put
  it on a network filesystem. With a bind mount instead of the named volume, `chown 1000:1000` it (the `node` user).
- Start order: `api` (runs migrations) → `worker` (waits for `api` healthy) and `web`. Commands run `node --import tsx`
  directly (no `pnpm` wrapper) so SIGTERM reaches the process. `init: true` reaps children. The worker's health check is
  `scripts/worker-health.ts` (heartbeat fresh), also `pnpm check:worker` locally.
- `NODE_ENV=production` is set per service (it overrides a `.env` copied from the example). With an `https://`
  `PUBLIC_APP_URL` session cookies are `Secure`. Secrets come from `.env` (`env_file`), never the image (`.dockerignore`).
- Closing the browser never stops work; no request is the worker.

**Not verified here:** Docker is not installed on the machine used for Batch 5, so `docker compose build/up/restart` and
volume persistence under Docker were **NOT RUN**. The same commands were run as local processes against a persistent
local directory, with SIGTERM restarts (see `docs/batches/batch-5/integration.md`). A real deployment on a host is
**BLOCKED** on host access and its existing approval.

## Backup and restore (consistent, tested)

Do **not** copy `afterhours.sqlite` alone while the app runs: in WAL mode recent commits can still be in the `-wal` file.
Use the supported online method (SQLite backup API) which also copies the referenced artifact files:

```bash
pnpm backup -- create /safe/place/afterhours-backup-2026-10-24     # app may keep running; destination must be new/empty
pnpm backup -- verify /safe/place/afterhours-backup-2026-10-24     # integrity, foreign keys, size + SHA-256 of every file
pnpm backup -- restore /safe/place/afterhours-backup-2026-10-24 /srv/afterhours-restored   # NEW empty directory
```

Order matters and is built in: snapshot the database first, then copy the files that snapshot references (published files
are immutable and promoted before their manifest row commits, so they always exist). Unreferenced crash leftovers are not
copied. The backup never contains `.env`. After a restore: stop the old services, point `DATABASE_PATH` and
`ARTIFACTS_DIR` at the restored paths, keep the **same** `TOKEN_ENCRYPTION_KEY` (otherwise saved Gmail tokens cannot be
decrypted: reconnect Gmail) and start. Sessions may need a fresh login. A raw copy of a *stopped, checkpointed* database
is also safe, but `pnpm backup` is the tested path. Never restore over the live directories.

## Recovering a stopped service

1. `docker compose ps` / `pnpm check:worker`: is the worker healthy?
2. `docker compose up -d` (or start the three processes). Expired job leases are requeued automatically; notification
   leases are released or marked `DELIVERY_UNCERTAIN` (see above).
3. Look for `failed` tasks (retry from the UI) and `failed` notifications with `DELIVERY_UNCERTAIN` (check the provider
   console before sending by hand; the app will not resend).
4. If the disk was lost: restore the latest verified backup into a new directory as above.

## Known limits and blocked checks

- No real all-night run was observed; scheduling is covered by pure-function tests, a controlled-clock worker test and one
  real ~4-minute elapsed-time run. Host sleep, remote deployment and Docker are not verified.
- Live Gmail, live model and live WhatsApp are BLOCKED on credentials and eligibility (never exercised by tests).
- No destructive public reset route exists. `pnpm db:reset -- --demo-only` is a local CLI that refuses real data.
