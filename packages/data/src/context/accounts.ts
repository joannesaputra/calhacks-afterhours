import { rmSync } from "node:fs";
import type { Db } from "../db";
import { resolveArtifactPath } from "../artifacts";
import { addSeconds, iso, newId, parseJson } from "../util";
import { auditContext } from "./audit";
import { removeFromIndex } from "./search";

export type AccountProvider = "gmail" | "folder" | "drive";
export interface AccountRow {
  id: string; owner_id: string; provider: AccountProvider; account_ref: string; integration_id: string | null;
  state: "connected" | "disconnected" | "error" | "unavailable";
  sync_status: "idle" | "backfilling" | "incremental" | "partial" | "error" | "paused";
  capabilities_json: string; connected_at: string | null; last_sync_at: string | null; last_error: string | null;
  created_at: string; updated_at: string;
}
export interface SelectedItem { providerId: string; kind: "file" | "folder"; label: string }
export interface GrantRow {
  id: string; owner_id: string; account_id: string; kind: "email" | "files"; lookback_days: number | null; include_sent: number;
  selected_json: string; created_at: string; expires_at: string | null; revoked_at: string | null; revoke_reason: string | null;
  purged_at: string | null; updated_at: string;
}

export const selectedOf = (g: Pick<GrantRow, "selected_json">): SelectedItem[] => parseJson<SelectedItem[]>(g.selected_json, []);

export function upsertAccount(
  db: Db, ownerId: string, provider: AccountProvider, accountRef: string,
  opts: { integrationId?: string | null; state?: AccountRow["state"]; capabilities?: Record<string, unknown> }, now: Date,
): AccountRow {
  const ref = accountRef.trim().toLowerCase();
  const t = iso(now);
  const existing = db.prepare("SELECT * FROM connected_accounts WHERE owner_id=? AND provider=? AND account_ref=?").get(ownerId, provider, ref) as AccountRow | undefined;
  if (existing) {
    db.prepare("UPDATE connected_accounts SET integration_id=COALESCE(?, integration_id), state=COALESCE(?, state), capabilities_json=COALESCE(?, capabilities_json), connected_at=CASE WHEN ?='connected' AND connected_at IS NULL THEN ? ELSE connected_at END, updated_at=? WHERE id=?")
      .run(opts.integrationId ?? null, opts.state ?? null, opts.capabilities ? JSON.stringify(opts.capabilities) : null, opts.state ?? "", t, t, existing.id);
    return getAccount(db, ownerId, existing.id)!;
  }
  const id = newId();
  db.prepare(`INSERT INTO connected_accounts (id, owner_id, provider, account_ref, integration_id, state, capabilities_json, connected_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, ownerId, provider, ref, opts.integrationId ?? null, opts.state ?? "connected", JSON.stringify(opts.capabilities ?? {}),
    (opts.state ?? "connected") === "connected" ? t : null, t, t);
  auditContext(db, ownerId, "account.connected", { type: "account", id }, { provider }, now);
  return getAccount(db, ownerId, id)!;
}

/** Owner-scoped lookup: an account id that belongs to another owner is simply not found. */
export function getAccount(db: Db, ownerId: string, accountId: string): AccountRow | null {
  return (db.prepare("SELECT * FROM connected_accounts WHERE id=? AND owner_id=?").get(accountId, ownerId) as AccountRow | undefined) ?? null;
}
export function findAccount(db: Db, ownerId: string, provider: AccountProvider): AccountRow | null {
  return (db.prepare("SELECT * FROM connected_accounts WHERE owner_id=? AND provider=? ORDER BY created_at LIMIT 1").get(ownerId, provider) as AccountRow | undefined) ?? null;
}
export const listAccounts = (db: Db, ownerId: string): AccountRow[] =>
  db.prepare("SELECT * FROM connected_accounts WHERE owner_id=? ORDER BY created_at").all(ownerId) as AccountRow[];

export class GrantError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "GrantError"; }
}

/**
 * One email-history grant per account: asking again changes its lookback and expiry. Email history and files are
 * separate grants, so granting one never grants the other.
 */
export function createEmailGrant(
  db: Db, ownerId: string, accountId: string, opts: { lookbackDays: number; expiresAt?: Date | null }, now: Date,
): GrantRow {
  const account = getAccount(db, ownerId, accountId);
  if (!account) throw new GrantError("ACCOUNT_NOT_FOUND", "That connected account does not exist.");
  if (account.provider !== "gmail") throw new GrantError("WRONG_PROVIDER", "Email history needs a connected mailbox.");
  if (account.state === "disconnected") throw new GrantError("ACCOUNT_DISCONNECTED", "Connect the mailbox before granting access to its history.");
  if (!Number.isInteger(opts.lookbackDays) || opts.lookbackDays < 1 || opts.lookbackDays > 730) throw new GrantError("BAD_LOOKBACK", "The lookback must be between 1 and 730 days.");
  const t = iso(now);
  const exp = opts.expiresAt ? iso(opts.expiresAt) : null;
  const existing = activeGrants(db, ownerId, accountId, "email", now)[0];
  if (existing) {
    db.prepare("UPDATE context_grants SET lookback_days=?, expires_at=?, updated_at=? WHERE id=?").run(opts.lookbackDays, exp, t, existing.id);
    auditContext(db, ownerId, "grant.updated", { type: "grant", id: existing.id }, { kind: "email", lookbackDays: opts.lookbackDays }, now);
    return db.prepare("SELECT * FROM context_grants WHERE id=?").get(existing.id) as GrantRow;
  }
  const id = newId();
  db.prepare(`INSERT INTO context_grants (id, owner_id, account_id, kind, lookback_days, selected_json, created_at, expires_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, ownerId, accountId, "email", opts.lookbackDays, "[]", t, exp, t);
  auditContext(db, ownerId, "grant.created", { type: "grant", id }, { kind: "email", lookbackDays: opts.lookbackDays }, now);
  return db.prepare("SELECT * FROM context_grants WHERE id=?").get(id) as GrantRow;
}

export function createFilesGrant(
  db: Db, ownerId: string, accountId: string, selected: SelectedItem[], opts: { expiresAt?: Date | null }, now: Date,
): GrantRow {
  const account = getAccount(db, ownerId, accountId);
  if (!account) throw new GrantError("ACCOUNT_NOT_FOUND", "That connected account does not exist.");
  if (account.provider === "gmail") throw new GrantError("WRONG_PROVIDER", "File access needs a file source, not a mailbox.");
  if (account.state === "unavailable") throw new GrantError("PROVIDER_UNAVAILABLE", "This file source is not available in this installation.");
  if (selected.length === 0) throw new GrantError("NOTHING_SELECTED", "Choose at least one file or folder. Whole-drive access is not offered.");
  const t = iso(now);
  const id = newId();
  db.prepare(`INSERT INTO context_grants (id, owner_id, account_id, kind, selected_json, created_at, expires_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, ownerId, accountId, "files", JSON.stringify(selected), t, opts.expiresAt ? iso(opts.expiresAt) : null, t);
  auditContext(db, ownerId, "grant.created", { type: "grant", id }, { kind: "files", items: selected.length }, now);
  return db.prepare("SELECT * FROM context_grants WHERE id=?").get(id) as GrantRow;
}

export function activeGrants(db: Db, ownerId: string, accountId: string, kind: "email" | "files", now: Date): GrantRow[] {
  return db.prepare(
    `SELECT * FROM context_grants WHERE owner_id=? AND account_id=? AND kind=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at`,
  ).all(ownerId, accountId, kind, iso(now)) as GrantRow[];
}

export const isActive = (g: GrantRow, now: Date): boolean => !g.revoked_at && (!g.expires_at || g.expires_at > iso(now));

/** Earliest received_at an email may have to be visible, or null when no email grant is active. */
export function emailCutoff(db: Db, ownerId: string, accountId: string, now: Date): string | null {
  const grants = activeGrants(db, ownerId, accountId, "email", now);
  if (!grants.length) return null;
  const days = Math.max(...grants.map((g) => g.lookback_days ?? 0));
  return iso(addSeconds(now, -days * 86_400));
}

/** Stop access. Retained copies stay until purgeGrantData() runs. */
export function revokeGrant(db: Db, ownerId: string, grantId: string, reason: string, now: Date): boolean {
  const r = db.prepare("UPDATE context_grants SET revoked_at=?, revoke_reason=?, updated_at=? WHERE id=? AND owner_id=? AND revoked_at IS NULL")
    .run(iso(now), reason.slice(0, 120), iso(now), grantId, ownerId);
  if (r.changes > 0) auditContext(db, ownerId, "grant.revoked", { type: "grant", id: grantId }, { reason }, now);
  return r.changes > 0;
}

export function disconnectAccount(db: Db, ownerId: string, accountId: string, reason: string, now: Date): void {
  db.transaction(() => {
    const account = getAccount(db, ownerId, accountId);
    if (!account) return;
    db.prepare("UPDATE connected_accounts SET state='disconnected', sync_status='paused', updated_at=? WHERE id=?").run(iso(now), accountId);
    for (const g of db.prepare("SELECT id FROM context_grants WHERE owner_id=? AND account_id=? AND revoked_at IS NULL").all(ownerId, accountId) as Array<{ id: string }>) {
      revokeGrant(db, ownerId, g.id, reason, now);
    }
    db.prepare("UPDATE sync_cursors SET status='paused', lease_owner=NULL, lease_until=NULL, updated_at=? WHERE account_id=? AND status IN ('pending','running')").run(iso(now), accountId);
    auditContext(db, ownerId, "account.disconnected", { type: "account", id: accountId }, { reason }, now);
  }).immediate();
}

export interface PurgeSummary { emails: number; files: number; chunks: number; blobs: number; links: number; runsRedacted: number }

/**
 * Delete what was retained under a grant: messages, attachment and file records, extracted text, search entries, entity
 * links, summaries and the evidence bundles stored with retrieval runs. Revoking a grant stops access; this removes data.
 * Database backups made earlier are not rewritten.
 */
export function purgeGrantData(db: Db, artifactsDir: string, ownerId: string, grantId: string, now: Date): PurgeSummary {
  const grant = db.prepare("SELECT * FROM context_grants WHERE id=? AND owner_id=?").get(grantId, ownerId) as GrantRow | undefined;
  if (!grant) throw new GrantError("GRANT_NOT_FOUND", "That grant does not exist.");
  if (isActive(grant, now)) throw new GrantError("GRANT_ACTIVE", "Revoke the grant before purging what it retained.");
  const summary: PurgeSummary = { emails: 0, files: 0, chunks: 0, blobs: 0, links: 0, runsRedacted: 0 };
  const blobPaths: string[] = [];
  db.transaction(() => {
    const emailIds: string[] = [];
    const fileIds: string[] = [];
    if (grant.kind === "email") {
      for (const e of db.prepare("SELECT id, provider_thread_id FROM emails WHERE owner_id=? AND grant_id=?").all(ownerId, grantId) as Array<{ id: string; provider_thread_id: string | null }>) emailIds.push(e.id);
      for (const id of emailIds) for (const f of db.prepare("SELECT id FROM source_files WHERE owner_id=? AND parent_email_id=?").all(ownerId, id) as Array<{ id: string }>) fileIds.push(f.id);
    } else {
      for (const f of db.prepare("SELECT id FROM source_files WHERE owner_id=? AND account_id=? AND provider IN ('folder','drive')").all(ownerId, grant.account_id) as Array<{ id: string }>) fileIds.push(f.id);
    }
    const versionIds: string[] = [];
    for (const fid of fileIds) {
      for (const v of db.prepare("SELECT id, blob_rel_path FROM file_versions WHERE file_id=?").all(fid) as Array<{ id: string; blob_rel_path: string | null }>) {
        versionIds.push(v.id);
        if (v.blob_rel_path) blobPaths.push(v.blob_rel_path);
      }
    }
    const chunkIds = versionIds.flatMap((v) => (db.prepare("SELECT id FROM content_chunks WHERE file_version_id=?").all(v) as Array<{ id: string }>).map((c) => c.id));
    removeFromIndex(db, "chunk", chunkIds);
    removeFromIndex(db, "email", emailIds);
    summary.chunks = chunkIds.length;
    const targets = [...emailIds.map((id) => ["email", id]), ...fileIds.map((id) => ["file", id]), ...versionIds.map((id) => ["file", id])] as Array<[string, string]>;
    const delLink = db.prepare("DELETE FROM entity_links WHERE owner_id=? AND target_type=? AND target_id=?");
    for (const [type, id] of targets) summary.links += delLink.run(ownerId, type, id).changes;
    const entityIds = new Set<string>();
    for (const row of db.prepare("SELECT DISTINCT entity_id FROM project_summaries WHERE owner_id=?").all(ownerId) as Array<{ entity_id: string }>) entityIds.add(row.entity_id);
    // Summaries quote the sources they were built from; rebuild them later from what remains.
    for (const id of entityIds) db.prepare("DELETE FROM project_summaries WHERE entity_id=?").run(id);
    for (const fid of fileIds) { db.prepare("DELETE FROM source_files WHERE id=?").run(fid); summary.files += 1; }
    for (const id of emailIds) { db.prepare("DELETE FROM emails WHERE id=?").run(id); summary.emails += 1; }
    const refs = new Set([...emailIds, ...versionIds]);
    for (const run of db.prepare("SELECT id FROM retrieval_runs WHERE owner_id=?").all(ownerId) as Array<{ id: string }>) {
      const touches = (db.prepare("SELECT source_id FROM retrieval_sources WHERE run_id=?").all(run.id) as Array<{ source_id: string }>).some((s) => refs.has(s.source_id));
      if (!touches) continue;
      db.prepare("UPDATE retrieval_runs SET bundle_json=NULL, candidates_json='[]', questions_json='[]' WHERE id=?").run(run.id);
      db.prepare("DELETE FROM retrieval_sources WHERE run_id=?").run(run.id);
      summary.runsRedacted += 1;
    }
    db.prepare("UPDATE context_grants SET purged_at=?, updated_at=? WHERE id=?").run(iso(now), iso(now), grantId);
  }).immediate();
  const stillUsed = new Set((db.prepare("SELECT DISTINCT blob_rel_path p FROM file_versions WHERE blob_rel_path IS NOT NULL").all() as Array<{ p: string }>).map((r) => r.p));
  for (const rel of new Set(blobPaths)) {
    if (stillUsed.has(rel)) continue;
    const full = resolveArtifactPath(artifactsDir, rel);
    if (full) { rmSync(full, { force: true }); summary.blobs += 1; }
  }
  auditContext(db, ownerId, "grant.purged", { type: "grant", id: grantId }, { ...summary }, now);
  return summary;
}

/**
 * Keep connected_accounts in step with the Gmail integration: connected creates or updates the account, disconnected
 * revokes every grant and pauses sync (history stays until purged), an auth failure marks the account as errored.
 */
export function reflectGmailIntegration(db: Db, ownerId: string, now: Date): AccountRow | null {
  const row = db.prepare("SELECT id, state, account, auth_failed_at, last_error FROM integrations WHERE provider='gmail'").get() as
    | { id: string; state: "disconnected" | "connected" | "error"; account: string | null; auth_failed_at: string | null; last_error: string | null } | undefined;
  const existing = findAccount(db, ownerId, "gmail");
  if (!row || row.state === "disconnected" || !row.account) {
    if (existing && existing.state !== "disconnected") disconnectAccount(db, ownerId, existing.id, "gmail_disconnected", now);
    return existing ? getAccount(db, ownerId, existing.id) : null;
  }
  if (existing && existing.account_ref !== row.account.toLowerCase()) {
    // A different mailbox was connected: the previous mailbox's grants never carry over.
    disconnectAccount(db, ownerId, existing.id, "mailbox_changed", now);
  }
  const acct = upsertAccount(db, ownerId, "gmail", row.account, { integrationId: row.id, state: row.state === "error" ? "error" : "connected", capabilities: { scope: "gmail.readonly" } }, now);
  db.prepare("UPDATE connected_accounts SET last_error=?, updated_at=? WHERE id=?").run(row.state === "error" ? row.last_error : null, iso(now), acct.id);
  return getAccount(db, ownerId, acct.id);
}

/** Purge data retained under grants revoked more than `retentionDays` ago. Returns how many grants were purged. */
export function purgeRevokedPastRetention(db: Db, artifactsDir: string, ownerId: string, retentionDays: number, now: Date): number {
  const before = iso(addSeconds(now, -retentionDays * 86_400));
  const rows = db.prepare("SELECT id FROM context_grants WHERE owner_id=? AND revoked_at IS NOT NULL AND revoked_at <= ? AND purged_at IS NULL").all(ownerId, before) as Array<{ id: string }>;
  for (const g of rows) purgeGrantData(db, artifactsDir, ownerId, g.id, now);
  return rows.length;
}
