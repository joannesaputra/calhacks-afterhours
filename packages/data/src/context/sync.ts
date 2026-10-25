// Bounded, resumable synchronization of authorized email history. This code only STORES messages as searchable
// context. It never calls the task intake path, so backfilled history can never create a task or a job.
import type { Db } from "../db";
import { addSeconds, iso, newId, parseJson } from "../util";
import { activeGrants, getAccount, type GrantRow } from "./accounts";
import { auditContext } from "./audit";
import { registerFile, registerVersion } from "./files";
import type { ContextLimits } from "./limits";
import { upsertEmail } from "./mail";
import { ProviderError, type MailProvider } from "./mailProvider";

const OVERLAP_SECONDS = 120;
export const MAX_SYNC_ATTEMPTS = 8;
export const SYNC_LEASE_SECONDS = 120;
export const backoffSeconds = (attempts: number): number => Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));

interface CursorRow {
  id: string; owner_id: string; account_id: string; scope: "backfill" | "incremental"; status: "pending" | "running" | "complete" | "failed" | "paused";
  cursor_json: string; pages_done: number; items_done: number; window_start: string | null; window_end: string | null;
  attempts: number; next_attempt_at: string | null; last_error: string | null; lease_owner: string | null; lease_until: string | null;
}
interface BackfillCursor { fromSec: number; toSec: number; pageToken: string | null; lookbackDays: number }
interface IncrementalCursor { afterSec: number; pageToken: string | null }

const sec = (d: Date) => Math.floor(d.getTime() / 1000);

function ensureCursors(db: Db, ownerId: string, accountId: string, grant: GrantRow, now: Date): void {
  const t = iso(now);
  const lookback = grant.lookback_days ?? 90;
  const from = sec(now) - lookback * 86_400;
  const backfill = db.prepare("SELECT * FROM sync_cursors WHERE owner_id=? AND account_id=? AND scope='backfill'").get(ownerId, accountId) as CursorRow | undefined;
  if (!backfill) {
    db.prepare(`INSERT INTO sync_cursors (id, owner_id, account_id, scope, status, cursor_json, window_start, window_end, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(newId(), ownerId, accountId, "backfill", "pending", JSON.stringify({ fromSec: from, toSec: sec(now), pageToken: null, lookbackDays: lookback } satisfies BackfillCursor), iso(new Date(from * 1000)), t, t, t);
  } else {
    const c = parseJson<BackfillCursor>(backfill.cursor_json, { fromSec: from, toSec: sec(now), pageToken: null, lookbackDays: lookback });
    if (lookback > c.lookbackDays) {
      // The user widened the lookback: fetch only the newly authorized older range.
      db.prepare("UPDATE sync_cursors SET status='pending', cursor_json=?, window_start=?, attempts=0, next_attempt_at=NULL, last_error=NULL, updated_at=? WHERE id=?")
        .run(JSON.stringify({ fromSec: from, toSec: c.fromSec + 86_400, pageToken: null, lookbackDays: lookback } satisfies BackfillCursor), iso(new Date(from * 1000)), t, backfill.id);
    } else if (backfill.status === "paused") {
      db.prepare("UPDATE sync_cursors SET status='pending', updated_at=? WHERE id=?").run(t, backfill.id);
    }
  }
  const inc = db.prepare("SELECT * FROM sync_cursors WHERE owner_id=? AND account_id=? AND scope='incremental'").get(ownerId, accountId) as CursorRow | undefined;
  if (!inc) {
    db.prepare(`INSERT INTO sync_cursors (id, owner_id, account_id, scope, status, cursor_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(newId(), ownerId, accountId, "incremental", "pending", JSON.stringify({ afterSec: sec(now) - OVERLAP_SECONDS, pageToken: null } satisfies IncrementalCursor), t, t);
  } else if (inc.status === "paused") {
    db.prepare("UPDATE sync_cursors SET status='pending', updated_at=? WHERE id=?").run(t, inc.id);
  }
}

const due = (c: CursorRow, now: Date): boolean =>
  (c.status === "pending" || c.status === "running") && (!c.next_attempt_at || c.next_attempt_at <= iso(now)) && (!c.lease_until || c.lease_until <= iso(now));

export interface SyncStepResult {
  scope: "backfill" | "incremental" | null;
  stored: number; skipped: number; pages: number; done: boolean;
  paused: string | null; error: string | null; retryAt: string | null;
}
const idle = (paused: string | null = null): SyncStepResult => ({ scope: null, stored: 0, skipped: 0, pages: 0, done: false, paused, error: null, retryAt: null });

export interface SyncDeps { db: Db; ownerId: string; accountId: string; provider: MailProvider; now: () => Date; limits: ContextLimits; workerId?: string }

/** One bounded step. Safe to call repeatedly and from several processes: a lease keeps one runner per cursor. */
export async function runSyncStep(deps: SyncDeps): Promise<SyncStepResult> {
  const { db, ownerId, accountId, provider, limits } = deps;
  const now = deps.now();
  const account = getAccount(db, ownerId, accountId);
  if (!account || account.provider !== "gmail") return idle("no_account");
  const grant = activeGrants(db, ownerId, accountId, "email", now)[0];
  if (!grant || account.state === "disconnected") {
    db.prepare("UPDATE sync_cursors SET status='paused', updated_at=? WHERE account_id=? AND status IN ('pending','running')").run(iso(now), accountId);
    db.prepare("UPDATE connected_accounts SET sync_status='paused', updated_at=? WHERE id=?").run(iso(now), accountId);
    return idle(grant ? "disconnected" : "no_active_grant");
  }
  ensureCursors(db, ownerId, accountId, grant, now);
  const cursors = db.prepare("SELECT * FROM sync_cursors WHERE owner_id=? AND account_id=? ORDER BY scope").all(ownerId, accountId) as CursorRow[];
  const cursor = cursors.find((c) => c.scope === "backfill" && due(c, now)) ?? cursors.find((c) => c.scope === "incremental" && due(c, now));
  if (!cursor) return idle("nothing_due");
  const owner = deps.workerId ?? `sync-${newId().slice(0, 8)}`;
  const leased = db.prepare("UPDATE sync_cursors SET lease_owner=?, lease_until=?, status='running', updated_at=? WHERE id=? AND (lease_until IS NULL OR lease_until <= ?)")
    .run(owner, iso(addSeconds(now, SYNC_LEASE_SECONDS)), iso(now), cursor.id, iso(now));
  if (leased.changes === 0) return idle("leased_elsewhere");

  const result: SyncStepResult = { scope: cursor.scope, stored: 0, skipped: 0, pages: 0, done: false, paused: null, error: null, retryAt: null };
  const lookbackFloorMs = now.getTime() - (grant.lookback_days ?? 90) * 86_400_000;
  try {
    const mailbox = await provider.address();
    const bf = cursor.scope === "backfill" ? parseJson<BackfillCursor>(cursor.cursor_json, { fromSec: 0, toSec: sec(now), pageToken: null, lookbackDays: 90 }) : null;
    const inc = cursor.scope === "incremental" ? parseJson<IncrementalCursor>(cursor.cursor_json, { afterSec: sec(now) - OVERLAP_SECONDS, pageToken: null }) : null;
    const page = await provider.list({
      afterSec: bf ? bf.fromSec : inc!.afterSec, beforeSec: bf ? bf.toSec + 1 : null,
      pageToken: (bf ? bf.pageToken : inc!.pageToken) ?? null, max: limits.syncPageSize,
    });
    let fetched = 0;
    let handledAll = true;
    let newestSec = 0;
    for (const id of page.ids) {
      if (db.prepare("SELECT 1 FROM emails WHERE owner_id=? AND account_id=? AND provider_message_id=?").get(ownerId, accountId, id)) { result.skipped += 1; continue; }
      if (fetched >= limits.syncMessagesPerStep) { handledAll = false; break; }
      let msg;
      try { msg = await provider.get(id); } catch (e) {
        const pe = e instanceof ProviderError ? e : null;
        if (pe?.kind === "not_found") { result.skipped += 1; continue; }
        throw e;
      }
      fetched += 1;
      if (msg.internalDateMs < lookbackFloorMs) { result.skipped += 1; continue; }
      newestSec = Math.max(newestSec, Math.floor(msg.internalDateMs / 1000));
      const from = msg.from?.email ?? "unknown@invalid";
      const outbound = from.toLowerCase() === mailbox || msg.labelIds.includes("SENT");
      db.transaction(() => {
        const { id: emailId, inserted } = upsertEmail(db, ownerId, accountId, grant.id, {
          providerMessageId: msg.id, threadId: msg.threadId, direction: outbound ? "outbound" : "inbound", fromAddress: from, fromName: msg.from?.name ?? null,
          to: msg.to, cc: msg.cc, subject: msg.subject, bodyText: msg.bodyText, receivedAt: new Date(msg.internalDateMs).toISOString(),
          provenance: cursor.scope === "backfill" ? "gmail_backfill" : "gmail_incremental", attachments: msg.attachments,
        }, now);
        if (!inserted) return;
        for (const a of msg.attachments) {
          // Metadata only: bytes are fetched later, and only for files that look like the one being asked about.
          const file = registerFile(db, { ownerId, accountId, provider: "gmail", providerFileId: `${msg.id}#${a.key}`, kind: "attachment", name: a.filename, mimeType: a.mimeType, parentEmailId: emailId, parentRef: JSON.stringify({ messageId: msg.id, key: a.key }) }, now);
          registerVersion(db, { ownerId, fileId: file.id, versionKey: `pending:${file.id}`, snapshotKind: "attachment_snapshot", sizeBytes: a.sizeBytes, sentAt: new Date(msg.internalDateMs).toISOString() }, now);
        }
        result.stored += 1;
      }).immediate();
    }
    result.pages = handledAll ? 1 : 0;
    const t = deps.now();
    if (bf) {
      const next = handledAll ? page.next : bf.pageToken;
      const complete = handledAll && !page.next;
      db.prepare("UPDATE sync_cursors SET status=?, cursor_json=?, pages_done=pages_done+?, items_done=items_done+?, attempts=0, next_attempt_at=NULL, last_error=NULL, lease_owner=NULL, lease_until=NULL, updated_at=? WHERE id=?")
        .run(complete ? "complete" : "running", JSON.stringify({ ...bf, pageToken: next } satisfies BackfillCursor), result.pages, result.stored, iso(t), cursor.id);
      result.done = complete;
    } else {
      const caughtUp = handledAll && !page.next;
      const afterSec = caughtUp ? Math.max(inc!.afterSec, newestSec ? newestSec - OVERLAP_SECONDS : sec(now) - OVERLAP_SECONDS) : inc!.afterSec;
      db.prepare("UPDATE sync_cursors SET status='pending', cursor_json=?, pages_done=pages_done+?, items_done=items_done+?, attempts=0, next_attempt_at=NULL, last_error=NULL, lease_owner=NULL, lease_until=NULL, updated_at=? WHERE id=?")
        .run(JSON.stringify({ afterSec, pageToken: handledAll ? page.next : inc!.pageToken } satisfies IncrementalCursor), result.pages, result.stored, iso(t), cursor.id);
      result.done = caughtUp;
    }
    const backfillState = (db.prepare("SELECT status FROM sync_cursors WHERE owner_id=? AND account_id=? AND scope='backfill'").get(ownerId, accountId) as { status: string } | undefined)?.status;
    db.prepare("UPDATE connected_accounts SET sync_status=?, last_sync_at=?, last_error=NULL, state=CASE WHEN state='error' THEN 'connected' ELSE state END, updated_at=? WHERE id=?")
      .run(backfillState === "complete" ? "incremental" : "backfilling", iso(t), iso(t), accountId);
    auditContext(db, ownerId, "sync.step", { type: "account", id: accountId }, { scope: cursor.scope, stored: result.stored, skipped: result.skipped, done: result.done }, t);
    return result;
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError("temporary", "Synchronization failed unexpectedly.");
    const t = deps.now();
    if (pe.kind === "auth" || pe.kind === "forbidden" || pe.kind === "unsupported") {
      db.prepare("UPDATE sync_cursors SET status='paused', last_error=?, lease_owner=NULL, lease_until=NULL, updated_at=? WHERE id=?").run(pe.message, iso(t), cursor.id);
      db.prepare("UPDATE connected_accounts SET sync_status='paused', state=CASE WHEN ?='unsupported' THEN state ELSE 'error' END, last_error=?, updated_at=? WHERE id=?").run(pe.kind, pe.message, iso(t), accountId);
      result.paused = pe.kind; result.error = pe.message;
    } else {
      const attempts = cursor.attempts + 1;
      const retryAt = iso(addSeconds(t, backoffSeconds(attempts)));
      const failed = attempts >= MAX_SYNC_ATTEMPTS;
      db.prepare("UPDATE sync_cursors SET status=?, attempts=?, next_attempt_at=?, last_error=?, lease_owner=NULL, lease_until=NULL, updated_at=? WHERE id=?")
        .run(failed ? "failed" : "running", attempts, failed ? null : retryAt, pe.message, iso(t), cursor.id);
      db.prepare("UPDATE connected_accounts SET sync_status=?, last_error=?, updated_at=? WHERE id=?").run(failed ? "error" : "partial", pe.message, iso(t), accountId);
      result.error = pe.message; result.retryAt = failed ? null : retryAt;
    }
    auditContext(db, ownerId, "sync.error", { type: "account", id: accountId }, { scope: cursor.scope, kind: pe.kind }, t);
    return result;
  }
}

/** Run steps until nothing more is due now or `maxSteps` is reached (used by the worker and by tests). */
export async function runSyncUntilIdle(deps: SyncDeps, maxSteps = 50): Promise<SyncStepResult[]> {
  const out: SyncStepResult[] = [];
  for (let i = 0; i < maxSteps; i += 1) {
    const r = await runSyncStep(deps);
    if (r.scope === null) break;
    out.push(r);
    if (r.error || (r.done && r.scope === "incremental")) break;
    if (r.done && r.scope === "backfill") continue;
  }
  return out;
}

export interface Coverage { backfill: "none" | CursorRow["status"]; complete: boolean; oldestSyncedAt: string | null; lookbackFrom: string | null; messages: number; note: string }

/** What the user can be told about how much history was actually read. Incomplete coverage is stated, not hidden. */
export function coverageOf(db: Db, ownerId: string, accountId: string, now: Date): Coverage {
  const grant = activeGrants(db, ownerId, accountId, "email", now)[0];
  const cursor = db.prepare("SELECT status, last_error FROM sync_cursors WHERE owner_id=? AND account_id=? AND scope='backfill'").get(ownerId, accountId) as { status: CursorRow["status"]; last_error: string | null } | undefined;
  const stats = db.prepare("SELECT COUNT(*) n, MIN(received_at) oldest FROM emails WHERE owner_id=? AND account_id=? AND invalidated_at IS NULL").get(ownerId, accountId) as { n: number; oldest: string | null };
  const lookbackFrom = grant ? iso(addSeconds(now, -(grant.lookback_days ?? 0) * 86_400)) : null;
  if (!grant) return { backfill: cursor?.status ?? "none", complete: false, oldestSyncedAt: stats.oldest, lookbackFrom: null, messages: stats.n, note: "Email history is not authorized, so past messages are not searched." };
  const complete = cursor?.status === "complete";
  const note = complete ? `History for the last ${grant.lookback_days} days has been read (${stats.n} messages).`
    : cursor?.status === "failed" ? `History sync stopped after repeated errors (${stats.n} messages read so far). Results may be missing earlier mail.`
    : cursor?.status === "paused" ? `History sync is paused (${stats.n} messages read so far). Results may be missing earlier mail.`
    : `History sync is still running (${stats.n} messages read so far). Results may be missing earlier mail.`;
  return { backfill: cursor?.status ?? "pending", complete, oldestSyncedAt: stats.oldest, lookbackFrom, messages: stats.n, note };
}
