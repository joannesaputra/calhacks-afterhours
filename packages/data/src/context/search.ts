// Search over messages and extracted file text. Every query is scoped by owner, account and the active grant window in
// SQL before any text is loaded or ranked. FTS5 is used when the SQLite build has it; otherwise a bounded scan of the
// same scoped rows runs instead, and a truncated scan is reported so it is never mistaken for "nothing matched".
import type { Db } from "../db";
import { ftsQuery, tokenize } from "./text";

export type SearchBackend = "fts5" | "scan";

export function searchBackend(db: Db, force?: SearchBackend): SearchBackend {
  if (force === "scan") return "scan";
  const meta = db.prepare("SELECT value FROM context_meta WHERE key='search_backend'").get() as { value: SearchBackend } | undefined;
  if (meta && !force) return meta.value;
  let backend: SearchBackend = "fts5";
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS context_fts USING fts5(title, body, tokenize='unicode61 remove_diacritics 2')");
  } catch {
    backend = "scan";
  }
  db.prepare("INSERT INTO context_meta (key, value) VALUES ('search_backend', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(backend);
  return backend;
}

/** Create the FTS5 index when the SQLite build supports it. Safe to call repeatedly; reports which backend search will use. */
export const ensureSearchIndex = (db: Db): SearchBackend => searchBackend(db);

const BODY_CAP = 100_000;

export function indexDoc(
  db: Db, doc: { ownerId: string; accountId: string; refType: "email" | "chunk"; refId: string; title: string; body: string },
): void {
  db.prepare("INSERT OR IGNORE INTO search_docs (owner_id, account_id, ref_type, ref_id) VALUES (?,?,?,?)").run(doc.ownerId, doc.accountId, doc.refType, doc.refId);
  const row = db.prepare("SELECT id FROM search_docs WHERE ref_type=? AND ref_id=?").get(doc.refType, doc.refId) as { id: number };
  if (searchBackend(db) === "fts5") {
    db.prepare("DELETE FROM context_fts WHERE rowid=?").run(row.id);
    db.prepare("INSERT INTO context_fts (rowid, title, body) VALUES (?,?,?)").run(row.id, doc.title.slice(0, 500), doc.body.slice(0, BODY_CAP));
  }
}

export function removeFromIndex(db: Db, refType: "email" | "chunk", refIds: string[]): void {
  const fts = searchBackend(db) === "fts5";
  for (const id of refIds) {
    const row = db.prepare("SELECT id FROM search_docs WHERE ref_type=? AND ref_id=?").get(refType, id) as { id: number } | undefined;
    if (!row) continue;
    if (fts) db.prepare("DELETE FROM context_fts WHERE rowid=?").run(row.id);
    db.prepare("DELETE FROM search_docs WHERE id=?").run(row.id);
  }
}

export interface EmailScope {
  ownerId: string;
  accountId: string;
  /** Earliest received_at the active grant allows. Without one nothing is searchable. */
  cutoff: string | null;
  /** Latest received_at (a request cannot use mail that arrived after it). */
  until?: string | null;
}
export interface SearchHit { id: string; score: number }
export interface SearchResult { hits: SearchHit[]; backend: SearchBackend; capped: boolean }

export function searchEmails(db: Db, scope: EmailScope, terms: string[], limit: number, opts: { scanCap?: number; backend?: SearchBackend } = {}): SearchResult {
  const backend = searchBackend(db, opts.backend);
  if (!scope.cutoff) return { hits: [], backend, capped: false };
  const until = scope.until ?? "9999-12-31T23:59:59.999Z";
  const q = ftsQuery(terms);
  if (!q) return { hits: [], backend, capped: false };
  if (backend === "fts5") {
    const rows = db.prepare(
      `SELECT e.id AS id, context_fts.rank AS rank
         FROM context_fts
         JOIN search_docs sd ON sd.id = context_fts.rowid
         JOIN emails e ON e.id = sd.ref_id
        WHERE context_fts MATCH ? AND sd.owner_id = ? AND sd.account_id = ? AND sd.ref_type = 'email'
          AND e.owner_id = ? AND e.account_id = ? AND e.invalidated_at IS NULL AND e.received_at >= ? AND e.received_at <= ?
        ORDER BY rank LIMIT ?`,
    ).all(q, scope.ownerId, scope.accountId, scope.ownerId, scope.accountId, scope.cutoff, until, limit) as Array<{ id: string; rank: number }>;
    return { hits: rows.map((r) => ({ id: r.id, score: -r.rank })), backend, capped: false };
  }
  const cap = opts.scanCap ?? 3_000;
  const rows = db.prepare(
    `SELECT id, subject, body_text FROM emails WHERE owner_id=? AND account_id=? AND invalidated_at IS NULL AND received_at >= ? AND received_at <= ?
      ORDER BY received_at DESC LIMIT ?`,
  ).all(scope.ownerId, scope.accountId, scope.cutoff, until, cap) as Array<{ id: string; subject: string; body_text: string }>;
  const wanted = terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);
  const scored = rows.map((r) => {
    const subject = r.subject.toLowerCase();
    const body = r.body_text.toLowerCase();
    let score = 0;
    for (const t of wanted) { if (subject.includes(t)) score += 3; if (body.includes(t)) score += 1; }
    return { id: r.id, score };
  }).filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return { hits: scored, backend, capped: rows.length >= cap };
}

/** Search extracted text of the given file versions only (already scoped by the caller's grant checks). */
export function searchChunks(
  db: Db, ownerId: string, versionIds: string[], terms: string[], limit: number, opts: { backend?: SearchBackend } = {},
): Array<{ chunkId: string; versionId: string; ordinal: number; score: number }> {
  if (!versionIds.length) return [];
  const backend = searchBackend(db, opts.backend);
  const q = ftsQuery(terms);
  if (!q) return [];
  const marks = versionIds.map(() => "?").join(",");
  if (backend === "fts5") {
    return (db.prepare(
      `SELECT cc.id AS chunkId, cc.file_version_id AS versionId, cc.ordinal AS ordinal, context_fts.rank AS rank
         FROM context_fts
         JOIN search_docs sd ON sd.id = context_fts.rowid
         JOIN content_chunks cc ON cc.id = sd.ref_id
        WHERE context_fts MATCH ? AND sd.owner_id = ? AND sd.ref_type = 'chunk' AND cc.owner_id = ? AND cc.file_version_id IN (${marks})
        ORDER BY rank LIMIT ?`,
    ).all(q, ownerId, ownerId, ...versionIds, limit) as Array<{ chunkId: string; versionId: string; ordinal: number; rank: number }>)
      .map((r) => ({ chunkId: r.chunkId, versionId: r.versionId, ordinal: r.ordinal, score: -r.rank }));
  }
  const wanted = terms.map((t) => t.toLowerCase());
  const rows = db.prepare(`SELECT id, file_version_id, ordinal, text FROM content_chunks WHERE owner_id=? AND file_version_id IN (${marks}) LIMIT 5000`).all(ownerId, ...versionIds) as Array<{ id: string; file_version_id: string; ordinal: number; text: string }>;
  return rows.map((r) => ({ chunkId: r.id, versionId: r.file_version_id, ordinal: r.ordinal, score: wanted.reduce((n, t) => n + (r.text.toLowerCase().includes(t) ? 1 : 0), 0) }))
    .filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

export { tokenize };
