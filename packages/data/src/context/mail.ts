import type { Db } from "../db";
import { iso, newId, parseJson } from "../util";
import { indexDoc } from "./search";
import { extractLinkRefs, normalizeSubject, splitBody } from "./text";

export type EmailProvenance = "gmail_backfill" | "gmail_incremental" | "gmail_intake" | "fixture";

export interface EmailRow {
  id: string; owner_id: string; account_id: string; grant_id: string | null; provider_message_id: string; provider_thread_id: string | null;
  direction: "inbound" | "outbound"; from_address: string; from_name: string | null; to_json: string; cc_json: string;
  subject: string; normalized_subject: string; body_text: string; new_text: string; received_at: string; ingested_at: string;
  provenance: EmailProvenance; attachment_count: number; invalidated_at: string | null; invalidation_reason: string | null;
}
export interface EmailView extends EmailRow { to: string[]; cc: string[] }
export const viewEmail = (r: EmailRow): EmailView => ({ ...r, to: parseJson<string[]>(r.to_json, []), cc: parseJson<string[]>(r.cc_json, []) });

export interface AttachmentMeta { key: string; filename: string; mimeType: string; sizeBytes: number }
export interface EmailInput {
  providerMessageId: string;
  threadId: string | null;
  direction: "inbound" | "outbound";
  fromAddress: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  receivedAt: string;
  provenance: EmailProvenance;
  attachments: AttachmentMeta[];
}

export const lower = (a: string) => a.trim().toLowerCase();
const BODY_CAP = 120_000;

/** Contacts are created per address from headers and stay unverified: a header never proves who someone is. */
export function touchContact(db: Db, ownerId: string, address: string, name: string | null, now: Date): void {
  const a = lower(address);
  if (!a || db.prepare("SELECT 1 FROM contact_addresses WHERE owner_id=? AND address=?").get(ownerId, a)) return;
  const id = newId();
  db.prepare("INSERT INTO contacts (id, owner_id, display_name, created_at) VALUES (?,?,?,?)").run(id, ownerId, name, iso(now));
  db.prepare("INSERT INTO contact_addresses (owner_id, address, contact_id, verified, source, created_at) VALUES (?,?,?,?,?,?)").run(ownerId, a, id, 0, "header", iso(now));
}

/** Declare that `alias` is the same person as `address`. Only addresses linked this way are ever merged. */
export function verifyAlias(db: Db, ownerId: string, address: string, alias: string, now: Date): void {
  db.transaction(() => {
    touchContact(db, ownerId, address, null, now);
    touchContact(db, ownerId, alias, null, now);
    const base = db.prepare("SELECT contact_id FROM contact_addresses WHERE owner_id=? AND address=?").get(ownerId, lower(address)) as { contact_id: string };
    const other = db.prepare("SELECT contact_id FROM contact_addresses WHERE owner_id=? AND address=?").get(ownerId, lower(alias)) as { contact_id: string };
    db.prepare("UPDATE contact_addresses SET contact_id=?, verified=1, source='manual' WHERE owner_id=? AND contact_id=?").run(base.contact_id, ownerId, other.contact_id);
    db.prepare("UPDATE contact_addresses SET verified=1, source='manual' WHERE owner_id=? AND address=?").run(ownerId, lower(address));
  }).immediate();
}

/**
 * Addresses that may be treated as the same person. An address with no verified link is only itself: a shared display
 * name or a shared company domain never merges identities.
 */
export function identityAddresses(db: Db, ownerId: string, address: string): string[] {
  const a = lower(address);
  const row = db.prepare("SELECT contact_id, verified FROM contact_addresses WHERE owner_id=? AND address=?").get(ownerId, a) as { contact_id: string; verified: number } | undefined;
  if (!row || !row.verified) return [a];
  return (db.prepare("SELECT address FROM contact_addresses WHERE owner_id=? AND contact_id=? AND verified=1").all(ownerId, row.contact_id) as Array<{ address: string }>).map((r) => r.address);
}

/** Store one message once. Re-delivery, retries and overlapping backfill windows return the existing row untouched. */
export function upsertEmail(
  db: Db, ownerId: string, accountId: string, grantId: string | null, input: EmailInput, now: Date,
): { id: string; inserted: boolean } {
  const existing = db.prepare("SELECT id FROM emails WHERE owner_id=? AND account_id=? AND provider_message_id=?").get(ownerId, accountId, input.providerMessageId) as { id: string } | undefined;
  if (existing) return { id: existing.id, inserted: false };
  const id = newId();
  const body = input.bodyText.slice(0, BODY_CAP);
  const from = lower(input.fromAddress);
  const to = [...new Set(input.to.map(lower))];
  const cc = [...new Set(input.cc.map(lower))];
  db.transaction(() => {
    db.prepare(
      `INSERT INTO emails (id, owner_id, account_id, grant_id, provider_message_id, provider_thread_id, direction, from_address, from_name, to_json, cc_json,
         subject, normalized_subject, body_text, new_text, received_at, ingested_at, provenance, attachment_count)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, ownerId, accountId, grantId, input.providerMessageId, input.threadId, input.direction, from, input.fromName, JSON.stringify(to), JSON.stringify(cc),
      input.subject.slice(0, 500), normalizeSubject(input.subject), body, splitBody(body).fresh, input.receivedAt, iso(now), input.provenance, input.attachments.length);
    const part = db.prepare("INSERT OR IGNORE INTO email_participants (email_id, owner_id, account_id, role, address) VALUES (?,?,?,?,?)");
    part.run(id, ownerId, accountId, "from", from);
    for (const a of to) part.run(id, ownerId, accountId, "to", a);
    for (const a of cc) part.run(id, ownerId, accountId, "cc", a);
    touchContact(db, ownerId, from, input.fromName, now);
    for (const a of [...to, ...cc]) touchContact(db, ownerId, a, null, now);
    const link = db.prepare("INSERT OR IGNORE INTO email_links (email_id, owner_id, provider, file_ref) VALUES (?,?,?,?)");
    for (const l of extractLinkRefs(body)) link.run(id, ownerId, l.provider, l.fileRef);
    indexDoc(db, { ownerId, accountId, refType: "email", refId: id, title: input.subject, body });
  }).immediate();
  return { id, inserted: true };
}

export function getEmail(db: Db, ownerId: string, id: string): EmailView | null {
  const r = db.prepare("SELECT * FROM emails WHERE id=? AND owner_id=?").get(id, ownerId) as EmailRow | undefined;
  return r ? viewEmail(r) : null;
}

export function emailsByIds(db: Db, ownerId: string, ids: string[]): EmailView[] {
  if (!ids.length) return [];
  return (db.prepare(`SELECT * FROM emails WHERE owner_id=? AND id IN (${ids.map(() => "?").join(",")})`).all(ownerId, ...ids) as EmailRow[]).map(viewEmail);
}

export interface MailScope { ownerId: string; accountId: string; cutoff: string | null; until?: string | null }
const until = (s: MailScope) => s.until ?? "9999-12-31T23:59:59.999Z";

export function threadEmails(db: Db, s: MailScope, threadId: string, limit: number): EmailView[] {
  if (!s.cutoff) return [];
  return (db.prepare(
    `SELECT * FROM emails WHERE owner_id=? AND account_id=? AND provider_thread_id=? AND invalidated_at IS NULL AND received_at >= ? AND received_at <= ?
      ORDER BY received_at LIMIT ?`,
  ).all(s.ownerId, s.accountId, threadId, s.cutoff, until(s), limit) as EmailRow[]).map(viewEmail);
}

/** Messages the given addresses sent or received, newest first. */
export function emailsInvolving(db: Db, s: MailScope, addresses: string[], window: { from?: string; to?: string }, limit: number): EmailView[] {
  if (!s.cutoff || !addresses.length) return [];
  const from = window.from && window.from > s.cutoff ? window.from : s.cutoff;
  const marks = addresses.map(() => "?").join(",");
  return (db.prepare(
    `SELECT e.* FROM emails e WHERE e.owner_id=? AND e.account_id=? AND e.invalidated_at IS NULL AND e.received_at >= ? AND e.received_at <= ?
        AND EXISTS (SELECT 1 FROM email_participants p WHERE p.email_id = e.id AND p.owner_id = ? AND p.account_id = ? AND p.address IN (${marks}))
      ORDER BY e.received_at DESC LIMIT ?`,
  ).all(s.ownerId, s.accountId, from, window.to && window.to < until(s) ? window.to : until(s), s.ownerId, s.accountId, ...addresses, limit) as EmailRow[]).map(viewEmail);
}

export function emailsLinkingFile(db: Db, s: MailScope, provider: string, fileRef: string, limit: number): EmailView[] {
  if (!s.cutoff) return [];
  return (db.prepare(
    `SELECT e.* FROM email_links l JOIN emails e ON e.id = l.email_id
      WHERE l.owner_id=? AND l.provider=? AND l.file_ref=? AND e.owner_id=? AND e.account_id=? AND e.invalidated_at IS NULL AND e.received_at >= ? AND e.received_at <= ?
      ORDER BY e.received_at LIMIT ?`,
  ).all(s.ownerId, provider, fileRef, s.ownerId, s.accountId, s.cutoff, until(s), limit) as EmailRow[]).map(viewEmail);
}

export function emailsBySubject(db: Db, s: MailScope, normalizedSubject: string, limit: number): EmailView[] {
  if (!s.cutoff || !normalizedSubject) return [];
  return (db.prepare(
    `SELECT * FROM emails WHERE owner_id=? AND account_id=? AND normalized_subject=? AND invalidated_at IS NULL AND received_at >= ? AND received_at <= ? ORDER BY received_at LIMIT ?`,
  ).all(s.ownerId, s.accountId, normalizedSubject, s.cutoff, until(s), limit) as EmailRow[]).map(viewEmail);
}

/** Mark a message as no longer available (deleted at the provider) and everything derived from it as invalid. */
export function invalidateEmail(db: Db, ownerId: string, accountId: string, providerMessageId: string, reason: string, now: Date): boolean {
  return db.transaction(() => {
    const row = db.prepare("SELECT id FROM emails WHERE owner_id=? AND account_id=? AND provider_message_id=?").get(ownerId, accountId, providerMessageId) as { id: string } | undefined;
    if (!row) return false;
    const t = iso(now);
    db.prepare("UPDATE emails SET invalidated_at=?, invalidation_reason=? WHERE id=?").run(t, reason, row.id);
    db.prepare(`UPDATE file_versions SET invalidated_at=?, invalidation_reason=? WHERE file_id IN (SELECT id FROM source_files WHERE parent_email_id=?)`).run(t, `email_${reason}`, row.id);
    return true;
  }).immediate();
}
