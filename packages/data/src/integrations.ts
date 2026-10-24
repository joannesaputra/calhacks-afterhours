import type { Db } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import { addSeconds, iso, newId, randomToken, sha256Hex } from "./util";

export interface GmailTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  token_type?: string | null;
}

export interface GmailCheckpoint {
  /** internalDate (ms) anchor: everything at or before this has been handled. */
  afterMs: number;
  /** Recently handled provider message IDs, to make the overlap window idempotent. */
  handled: string[];
  /**
   * Upper bound (ms) of the listing window when the open window was too large to list within the
   * per-cycle page cap. The window is halved until it fits, drained oldest-first, then reopened.
   */
  windowEndMs?: number | null;
}

interface GmailRowRaw {
  id: string; state: "disconnected" | "connected" | "error"; account: string | null;
  connected_at: string | null; last_poll_at: string | null; last_error: string | null;
  checkpoint_json: string; credentials_enc: string | null;
  connection_token: string | null; auth_failed_at: string | null;
}

export function getGmailRow(db: Db): GmailRowRaw | null {
  return (db.prepare("SELECT * FROM integrations WHERE provider='gmail'").get() as GmailRowRaw | undefined) ?? null;
}

/**
 * Save a new connection. The integration id stays stable across reconnects (it is part of the message
 * dedupe key); the connection token rotates so late work from an older connection cannot write here.
 */
export function saveGmailConnection(
  db: Db, key: Buffer, args: { account: string; tokens: GmailTokens }, now: Date,
): string {
  const enc = encryptSecret(key, JSON.stringify(args.tokens));
  const checkpoint: GmailCheckpoint = { afterMs: now.getTime(), handled: [] };
  const existing = getGmailRow(db);
  const id = existing?.id ?? newId();
  db.prepare(
    `INSERT INTO integrations (id, provider, state, account, connected_at, last_poll_at, last_error, checkpoint_json,
       credentials_enc, connection_token, auth_failed_at, updated_at)
     VALUES (?, 'gmail', 'connected', ?, ?, NULL, NULL, ?, ?, ?, NULL, ?)
     ON CONFLICT(provider) DO UPDATE SET state='connected', account=excluded.account, connected_at=excluded.connected_at,
       last_poll_at=NULL, last_error=NULL, checkpoint_json=excluded.checkpoint_json,
       credentials_enc=excluded.credentials_enc, connection_token=excluded.connection_token, auth_failed_at=NULL,
       updated_at=excluded.updated_at`,
  ).run(id, args.account, iso(now), JSON.stringify(checkpoint), enc, randomToken(16), iso(now));
  return id;
}

export function getGmailTokens(db: Db, key: Buffer): GmailTokens | null {
  const row = getGmailRow(db);
  if (!row?.credentials_enc) return null;
  return JSON.parse(decryptSecret(key, row.credentials_enc)) as GmailTokens;
}

/** True while `connectionToken` still identifies the stored, connected credentials. */
export function isCurrentGmailConnection(db: Db, connectionToken: string): boolean {
  return !!db.prepare(
    "SELECT 1 FROM integrations WHERE provider='gmail' AND connection_token=? AND credentials_enc IS NOT NULL AND state != 'disconnected'",
  ).get(connectionToken);
}

/**
 * Store refreshed tokens for one connection. A refresh response without refresh_token keeps the existing
 * one. Read-merge-write is one IMMEDIATE transaction, and nothing is written when the connection was
 * disconnected or replaced meanwhile, so a late refresh can never resurrect deleted credentials.
 */
export function updateGmailTokens(db: Db, key: Buffer, incoming: GmailTokens, now: Date, connectionToken: string): boolean {
  return db.transaction((): boolean => {
    if (!isCurrentGmailConnection(db, connectionToken)) return false;
    const cur = getGmailTokens(db, key);
    if (!cur) return false;
    const merged: GmailTokens = { ...cur, ...incoming, refresh_token: incoming.refresh_token ?? cur.refresh_token };
    db.prepare("UPDATE integrations SET credentials_enc=?, updated_at=? WHERE provider='gmail' AND connection_token=?").run(
      encryptSecret(key, JSON.stringify(merged)), iso(now), connectionToken,
    );
    return true;
  }).immediate();
}

export function getGmailCheckpoint(db: Db): GmailCheckpoint {
  const row = getGmailRow(db);
  try {
    const c = JSON.parse(row?.checkpoint_json ?? "{}") as Partial<GmailCheckpoint>;
    const end = Number(c.windowEndMs);
    return {
      afterMs: Number(c.afterMs ?? 0),
      handled: Array.isArray(c.handled) ? c.handled : [],
      windowEndMs: Number.isFinite(end) && end > 0 ? end : null,
    };
  } catch {
    return { afterMs: 0, handled: [], windowEndMs: null };
  }
}

/**
 * Record a poll outcome for one connection. Writes nothing (returns false) when the connection was
 * disconnected or replaced during the cycle, so a finishing poll cannot flip state back to connected.
 * `authFailed` pauses polling until the operator reconnects.
 */
export function recordGmailPoll(
  db: Db, now: Date, connectionToken: string,
  result: { checkpoint?: GmailCheckpoint; error?: string | null; authFailed?: boolean },
): boolean {
  if (result.error) {
    return db.prepare(
      `UPDATE integrations SET state='error', last_error=?, last_poll_at=?, auth_failed_at=?, updated_at=?
       WHERE provider='gmail' AND connection_token=? AND credentials_enc IS NOT NULL`,
    ).run(result.error.slice(0, 500), iso(now), result.authFailed ? iso(now) : null, iso(now), connectionToken).changes > 0;
  }
  return db.prepare(
    `UPDATE integrations SET state='connected', last_error=NULL, last_poll_at=?, auth_failed_at=NULL,
       checkpoint_json=COALESCE(?, checkpoint_json), updated_at=?
     WHERE provider='gmail' AND connection_token=? AND credentials_enc IS NOT NULL`,
  ).run(iso(now), result.checkpoint ? JSON.stringify(result.checkpoint) : null, iso(now), connectionToken).changes > 0;
}

/** Delete credentials and stop polling. Task history, intake records and artifacts are kept. */
export function disconnectGmail(db: Db, now: Date): void {
  db.prepare(
    `UPDATE integrations SET state='disconnected', credentials_enc=NULL, account=NULL, connected_at=NULL,
       last_error=NULL, checkpoint_json='{}', connection_token=NULL, auth_failed_at=NULL, updated_at=? WHERE provider='gmail'`,
  ).run(iso(now));
}

// ---- OAuth state: bound to a session, short-lived, single use ----
export const OAUTH_STATE_TTL_SECONDS = 600;

export function createOauthState(db: Db, sessionId: string, now: Date): string {
  const state = randomToken(24);
  db.prepare("INSERT INTO oauth_states (state_hash, session_id, created_at, expires_at) VALUES (?,?,?,?)").run(
    sha256Hex(state), sessionId, iso(now), iso(addSeconds(now, OAUTH_STATE_TTL_SECONDS)));
  db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(iso(addSeconds(now, -86400)));
  return state;
}

export type OauthStateResult = "ok" | "invalid" | "expired" | "replayed" | "session_mismatch";

export function consumeOauthState(db: Db, state: string | undefined, sessionId: string | null, now: Date): OauthStateResult {
  if (!state) return "invalid";
  return db.transaction((): OauthStateResult => {
    const row = db.prepare("SELECT * FROM oauth_states WHERE state_hash=?").get(sha256Hex(state)) as
      | { session_id: string; expires_at: string; consumed_at: string | null }
      | undefined;
    if (!row) return "invalid";
    if (row.consumed_at) return "replayed";
    db.prepare("UPDATE oauth_states SET consumed_at=? WHERE state_hash=?").run(iso(now), sha256Hex(state));
    if (row.expires_at <= iso(now)) return "expired";
    if (!sessionId || row.session_id !== sessionId) return "session_mismatch";
    return "ok";
  }).immediate();
}
