// File identity, immutable version snapshots, grant-scoped provider access and the parse cache.
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import path from "node:path";
import type { Db } from "../db";
import { iso, newId } from "../util";
import { putBlob, readBlob, sha256 } from "./blobs";
import type { ExtractOutcome, Extractor } from "./extractTypes";
import { Budget } from "./limits";
import { indexDoc, removeFromIndex } from "./search";
import type { FileProviderId } from "./types";
import type { SelectedItem } from "./accounts";

export type ExtractionStatus = "pending" | "complete" | "unsupported" | "encrypted" | "oversized" | "failed" | "unavailable";

export interface SourceFileRow {
  id: string; owner_id: string; account_id: string; provider: FileProviderId; provider_file_id: string; kind: "attachment" | "linked" | "folder_file";
  name: string; mime_type: string; parent_email_id: string | null; parent_ref: string | null; mutable: number;
  state: "active" | "deleted" | "unavailable" | "forbidden"; created_at: string; updated_at: string;
}
export interface FileVersionRow {
  id: string; owner_id: string; file_id: string; version_key: string; snapshot_kind: "attachment_snapshot" | "provider_revision" | "local_file";
  checksum_sha256: string | null; size_bytes: number; modified_at: string | null; sent_at: string | null; blob_rel_path: string | null;
  acquire_state: "metadata_only" | "stored" | "unavailable"; extraction_status: ExtractionStatus; extraction_detail: string | null;
  parser_version: string | null; unit_count: number | null; discovered_at: string; invalidated_at: string | null; invalidation_reason: string | null;
}

// ---- provider contract ----
export interface ProviderEntry {
  id: string; name: string; mimeType: string; parentId: string | null; isFolder: boolean;
  /** Set when this entry is a shortcut/link; the grant policy is applied to the TARGET, never the shortcut's own location. */
  shortcutTargetId: string | null;
  sizeBytes: number | null; modifiedAt: string | null; versionKey: string | null; mutable: boolean;
}
export type ProviderMissing = { missing: true; reason: "deleted" | "forbidden" | "unavailable" | "temporary"; message: string };
export type ProviderOpen = { ok: true; bytes: Uint8Array; entry: ProviderEntry } | { ok: false; reason: ProviderMissing["reason"]; message: string };

export interface FileProvider {
  readonly id: "folder" | "drive";
  readonly available: boolean;
  /** Why the provider cannot be used, in words a user can act on. Null when it works. */
  readonly limitation: string | null;
  /** Who enforces the selected-folder restriction. Never claims more than is true. */
  readonly scopeNote: string;
  stat(id: string): Promise<ProviderEntry | ProviderMissing>;
  list(folderId: string, opts: { pageToken: string | null; limit: number }): Promise<{ entries: ProviderEntry[]; next: string | null } | ProviderMissing>;
  open(id: string): Promise<ProviderOpen>;
  /** Folder ids from the entry's parent up to the root, nearest first; null when the entry is unknown. */
  ancestors(id: string): Promise<string[] | null>;
}

export interface MailAttachmentFetcher { fetchAttachment(messageId: string, attachmentKey: string): Promise<Uint8Array> }

export class ProviderRegistry {
  constructor(
    readonly files: Partial<Record<"folder" | "drive", FileProvider>> = {},
    readonly mail: ((accountId: string) => (MailAttachmentFetcher & MailProviderLike) | null) | null = null,
  ) {}
}
/** The slice of the mail provider that retrieval needs: it never lists or searches the mailbox. */
export interface MailProviderLike { fetchAttachment(messageId: string, attachmentKey: string): Promise<Uint8Array> }

export type ScopeDecision = { ok: true; via: "file" | "folder"; rootId: string } | { ok: false; reason: "outside_grant" | "shortcut_outside_grant" | "not_found" | "forbidden" | "unavailable" };

const MAX_DEPTH = 24;

/**
 * Is this provider entry inside what the user selected? Shortcuts are resolved first and judged by where they point.
 * Parent and sibling folders of a selected folder, and unrelated shared drives, are never in scope.
 */
export async function scopeDecision(provider: FileProvider, entryId: string, selected: SelectedItem[]): Promise<ScopeDecision> {
  let id = entryId;
  let viaShortcut = false;
  for (let hop = 0; hop < 4; hop += 1) {
    const e = await provider.stat(id);
    if ("missing" in e) return { ok: false, reason: e.reason === "deleted" ? "not_found" : e.reason === "forbidden" ? "forbidden" : "unavailable" };
    if (!e.shortcutTargetId) { id = e.id; break; }
    id = e.shortcutTargetId;
    viaShortcut = true;
    if (hop === 3) return { ok: false, reason: "shortcut_outside_grant" };
  }
  const direct = selected.find((s) => s.kind === "file" && s.providerId === id);
  if (direct) return { ok: true, via: "file", rootId: direct.providerId };
  const folders = new Set(selected.filter((s) => s.kind === "folder").map((s) => s.providerId));
  const chain = await provider.ancestors(id);
  if (chain) {
    for (const [i, a] of chain.entries()) {
      if (i >= MAX_DEPTH) break;
      if (folders.has(a)) return { ok: true, via: "folder", rootId: a };
    }
  }
  return { ok: false, reason: viaShortcut ? "shortcut_outside_grant" : "outside_grant" };
}

// ---- local folder provider ----
const MIME_BY_EXT: Record<string, string> = {
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
};

/**
 * A folder on the host running Afterhours, confined to one operator-configured root. Entry ids are paths relative to
 * that root. A symbolic link is a shortcut: it is resolved with realpath and treated as pointing at its target, so a
 * link inside a selected folder that leads elsewhere is outside the grant. The restriction is enforced by Afterhours,
 * not by the operating system.
 */
export function createLocalFolderProvider(rootDir: string, opts: { maxFileBytes?: number } = {}): FileProvider {
  const root = realpathSync(rootDir);
  const maxBytes = opts.maxFileBytes ?? 25 * 1024 * 1024;
  const rel = (abs: string) => path.relative(root, abs).split(path.sep).join("/");
  const inside = (abs: string) => abs === root || abs.startsWith(root + path.sep);
  const abs = (id: string) => path.resolve(root, id);
  const clean = (id: string): string | null => (id.includes("\0") || path.isAbsolute(id) || id.split("/").includes("..") ? null : id);
  const entryOf = (id: string, st: Stats, shortcutTarget: string | null): ProviderEntry => ({
    id, name: path.posix.basename(id) || "(root)", mimeType: st.isDirectory() ? "inode/directory" : MIME_BY_EXT[path.extname(id).toLowerCase()] ?? "application/octet-stream",
    parentId: id ? path.posix.dirname(id) === "." ? "" : path.posix.dirname(id) : null, isFolder: st.isDirectory(), shortcutTargetId: shortcutTarget,
    sizeBytes: st.isDirectory() ? null : st.size, modifiedAt: new Date(st.mtimeMs).toISOString(), versionKey: st.isDirectory() ? null : `${Math.round(st.mtimeMs)}:${Math.round(st.ctimeMs)}:${st.size}`, mutable: true,
  });
  const provider: FileProvider = {
    id: "folder", available: true, limitation: null,
    scopeNote: "The selected-folder restriction is enforced by Afterhours on this host. The operating system does not enforce it.",
    async stat(id) {
      const c = clean(id);
      if (c === null) return { missing: true, reason: "forbidden", message: "That path is not allowed." };
      try {
        const st = lstatSync(abs(c));
        if (st.isSymbolicLink()) {
          const real = realpathSync(abs(c));
          // A link leaving the root has no in-scope target at all; point at a sentinel that no grant can select.
          return entryOf(c, st, inside(real) ? rel(real) : "\0outside-root");
        }
        const real = realpathSync(abs(c));
        if (!inside(real)) return { missing: true, reason: "forbidden", message: "That path is outside the configured root." };
        return entryOf(c, st, null);
      } catch { return { missing: true, reason: "deleted", message: "The file no longer exists." }; }
    },
    async list(folderId, { pageToken, limit }) {
      const c = clean(folderId);
      if (c === null) return { missing: true, reason: "forbidden", message: "That path is not allowed." };
      try {
        const real = realpathSync(abs(c));
        if (!inside(real) || !statSync(real).isDirectory()) return { missing: true, reason: "forbidden", message: "Not a folder inside the configured root." };
        const names = readdirSync(real).sort();
        const from = pageToken ? Number(pageToken) : 0;
        const slice = names.slice(from, from + limit);
        const entries: ProviderEntry[] = [];
        for (const n of slice) {
          const id = path.posix.join(c, n);
          const e = await provider.stat(id);
          if (!("missing" in e)) entries.push(e);
        }
        return { entries, next: from + limit < names.length ? String(from + limit) : null };
      } catch { return { missing: true, reason: "deleted", message: "The folder no longer exists." }; }
    },
    async open(id) {
      const e = await provider.stat(id);
      if ("missing" in e) return { ok: false, reason: e.reason, message: e.message };
      if (e.isFolder) return { ok: false, reason: "forbidden", message: "That is a folder." };
      const target = clean(e.shortcutTargetId ?? e.id);
      if (target === null) return { ok: false, reason: "forbidden", message: "A link points outside the configured root." };
      const real = realpathSync(abs(target));
      if (!inside(real)) return { ok: false, reason: "forbidden", message: "Outside the configured root." };
      const st = statSync(real);
      if (!st.isFile()) return { ok: false, reason: "forbidden", message: "Not a regular file." };
      if (st.size > maxBytes) return { ok: false, reason: "forbidden", message: "The file is larger than the allowed size." };
      return { ok: true, bytes: new Uint8Array(readFileSync(real)), entry: e };
    },
    async ancestors(id) {
      const c = clean(id);
      if (c === null) return null;
      const out: string[] = [];
      let cur = c;
      while (cur !== "" && cur !== ".") { cur = path.posix.dirname(cur); out.push(cur === "." ? "" : cur); if (cur === "." || cur === "") break; }
      return out;
    },
  };
  return provider;
}

/** Google Drive needs OAuth scopes and an integration this release does not have. It reports that instead of pretending. */
export function createUnavailableDriveProvider(): FileProvider {
  const missing: ProviderMissing = { missing: true, reason: "unavailable", message: "Google Drive is not connected in this installation." };
  return {
    id: "drive", available: false,
    limitation: "Google Drive is not connected: this release has no Drive integration. Select a local project folder, or attach the file to your email.",
    scopeNote: "A Drive connection would be limited to selected files by the app (and by the drive.file scope for files picked through Google's picker); no Drive connection exists today.",
    stat: async () => missing, list: async () => missing, open: async () => ({ ok: false, reason: "unavailable", message: missing.message }), ancestors: async () => null,
  };
}

// ---- registry ----
export function registerFile(
  db: Db, f: { ownerId: string; accountId: string; provider: FileProviderId; providerFileId: string; kind: SourceFileRow["kind"]; name: string; mimeType: string; parentEmailId?: string | null; parentRef?: string | null; mutable?: boolean }, now: Date,
): SourceFileRow {
  const row = db.prepare("SELECT * FROM source_files WHERE owner_id=? AND account_id=? AND provider=? AND provider_file_id=?").get(f.ownerId, f.accountId, f.provider, f.providerFileId) as SourceFileRow | undefined;
  const t = iso(now);
  if (row) {
    if (row.name !== f.name || row.mime_type !== f.mimeType) db.prepare("UPDATE source_files SET name=?, mime_type=?, updated_at=? WHERE id=?").run(f.name, f.mimeType, t, row.id);
    return db.prepare("SELECT * FROM source_files WHERE id=?").get(row.id) as SourceFileRow;
  }
  const id = newId();
  db.prepare(`INSERT INTO source_files (id, owner_id, account_id, provider, provider_file_id, kind, name, mime_type, parent_email_id, parent_ref, mutable, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, f.ownerId, f.accountId, f.provider, f.providerFileId, f.kind, f.name, f.mimeType, f.parentEmailId ?? null, f.parentRef ?? null, f.mutable ? 1 : 0, t, t);
  return db.prepare("SELECT * FROM source_files WHERE id=?").get(id) as SourceFileRow;
}

export function registerVersion(
  db: Db, v: { ownerId: string; fileId: string; versionKey: string; snapshotKind: FileVersionRow["snapshot_kind"]; sha256?: string | null; sizeBytes: number; modifiedAt?: string | null; sentAt?: string | null }, now: Date,
): FileVersionRow {
  const row = db.prepare("SELECT * FROM file_versions WHERE file_id=? AND version_key=?").get(v.fileId, v.versionKey) as FileVersionRow | undefined;
  if (row) return row;
  const id = newId();
  db.prepare(`INSERT INTO file_versions (id, owner_id, file_id, version_key, snapshot_kind, checksum_sha256, size_bytes, modified_at, sent_at, discovered_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, v.ownerId, v.fileId, v.versionKey, v.snapshotKind, v.sha256 ?? null, v.sizeBytes, v.modifiedAt ?? null, v.sentAt ?? null, iso(now));
  return db.prepare("SELECT * FROM file_versions WHERE id=?").get(id) as FileVersionRow;
}

export const getVersion = (db: Db, ownerId: string, id: string): (FileVersionRow & { file: SourceFileRow }) | null => {
  const v = db.prepare("SELECT * FROM file_versions WHERE id=? AND owner_id=?").get(id, ownerId) as FileVersionRow | undefined;
  if (!v) return null;
  const file = db.prepare("SELECT * FROM source_files WHERE id=? AND owner_id=?").get(v.file_id, ownerId) as SourceFileRow | undefined;
  return file ? { ...v, file } : null;
};

/** Attach bytes to a version. For an attachment whose identity was unknown (metadata only) the checksum becomes its version key. */
export function storeVersionBytes(db: Db, artifactsDir: string, ownerId: string, versionId: string, bytes: Uint8Array): FileVersionRow {
  const v = getVersion(db, ownerId, versionId);
  if (!v) throw new Error("Unknown file version.");
  const blob = putBlob(artifactsDir, bytes);
  const pending = v.version_key.startsWith("pending:");
  db.prepare(
    `UPDATE file_versions SET blob_rel_path=?, checksum_sha256=?, size_bytes=?, acquire_state='stored', version_key=CASE WHEN ? THEN ? ELSE version_key END WHERE id=?`,
  ).run(blob.relPath, blob.sha256, bytes.byteLength, pending ? 1 : 0, blob.sha256, versionId);
  return db.prepare("SELECT * FROM file_versions WHERE id=?").get(versionId) as FileVersionRow;
}

export function loadVersionBytes(db: Db, artifactsDir: string, ownerId: string, versionId: string): Buffer | null {
  const v = getVersion(db, ownerId, versionId);
  if (!v?.blob_rel_path) return null;
  return readBlob(artifactsDir, v.blob_rel_path, v.checksum_sha256);
}

export function invalidateVersion(db: Db, versionId: string, reason: string, now: Date): void {
  db.prepare("UPDATE file_versions SET invalidated_at=COALESCE(invalidated_at, ?), invalidation_reason=COALESCE(invalidation_reason, ?) WHERE id=?").run(iso(now), reason, versionId);
}

export function markFileState(db: Db, fileId: string, state: SourceFileRow["state"], now: Date): void {
  db.prepare("UPDATE source_files SET state=?, updated_at=? WHERE id=?").run(state, iso(now), fileId);
}

// ---- extraction with a cache ----
export interface ChunkRow { id: string; ordinal: number; unit: number | null; unit_kind: string | null; locator: string; section: string | null; text: string }
export const chunksOf = (db: Db, versionId: string, parserVersion: string): ChunkRow[] =>
  db.prepare("SELECT id, ordinal, unit, unit_kind, locator, section, text FROM content_chunks WHERE file_version_id=? AND parser_version=? ORDER BY ordinal").all(versionId, parserVersion) as ChunkRow[];

function storeChunks(db: Db, v: FileVersionRow, accountId: string, outcome: Extract<ExtractOutcome, { status: "complete" }>): void {
  const old = db.prepare("SELECT id FROM content_chunks WHERE file_version_id=?").all(v.id) as Array<{ id: string }>;
  removeFromIndex(db, "chunk", old.map((c) => c.id));
  db.prepare("DELETE FROM content_chunks WHERE file_version_id=?").run(v.id);
  const ins = db.prepare(`INSERT INTO content_chunks (id, owner_id, account_id, file_version_id, ordinal, unit, unit_kind, locator, section, text, parser_version) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  outcome.units.forEach((u, i) => {
    const id = newId();
    ins.run(id, v.owner_id, accountId, v.id, i, u.unit, u.unitKind, u.locator, u.section, u.text, outcome.parserVersion);
    indexDoc(db, { ownerId: v.owner_id, accountId, refType: "chunk", refId: id, title: u.section ?? u.locator, body: u.text });
  });
}

export interface ExtractDeps { artifactsDir: string; extract: Extractor; parserVersion: string }

/**
 * Make sure a version's text is available, reading as little as possible: reuse this version's chunks, then chunks of any
 * version of the same owner with the same checksum and parser version, and only then parse the bytes. Never fetches bytes
 * here: callers supply them (already stored or just fetched under a grant check).
 */
export function ensureExtracted(db: Db, deps: ExtractDeps, versionId: string, ownerId: string, budget: Budget, bytes: Uint8Array | null): { status: ExtractionStatus; detail: string | null; cached: boolean } {
  const v = getVersion(db, ownerId, versionId);
  if (!v) return { status: "failed", detail: "Unknown file version.", cached: false };
  const account = v.file.account_id;
  if (v.extraction_status === "complete" && v.parser_version === deps.parserVersion) { budget.cacheHits += 1; return { status: "complete", detail: v.extraction_detail, cached: true }; }
  if (v.checksum_sha256) {
    const twin = db.prepare(
      `SELECT id, unit_count FROM file_versions WHERE owner_id=? AND checksum_sha256=? AND id<>? AND extraction_status='complete' AND parser_version=? AND invalidated_at IS NULL LIMIT 1`,
    ).get(ownerId, v.checksum_sha256, v.id, deps.parserVersion) as { id: string; unit_count: number | null } | undefined;
    if (twin) {
      const cs = chunksOf(db, twin.id, deps.parserVersion);
      if (cs.length) {
        storeChunks(db, v, account, { status: "complete", units: cs.map((c) => ({ unit: c.unit, unitKind: c.unit_kind as "slide" | "page" | "section" | null, locator: c.locator, section: c.section, text: c.text })), parserVersion: deps.parserVersion, truncated: false, detail: null });
        db.prepare("UPDATE file_versions SET extraction_status='complete', parser_version=?, unit_count=?, extraction_detail=NULL WHERE id=?").run(deps.parserVersion, cs.length, v.id);
        budget.cacheHits += 1;
        return { status: "complete", detail: null, cached: true };
      }
    }
  }
  if (!bytes) return { status: "pending", detail: null, cached: false };
  budget.filesParsed += 1;
  const outcome = deps.extract({ bytes, filename: v.file.name, mimeType: v.file.mime_type, maxBytes: budget.limits.maxBytes, maxUnits: Math.max(1, Math.min(budget.limits.maxUnits, budget.remaining("units") || 1)) });
  if (outcome.status === "complete") {
    budget.take("units", outcome.units.length);
    storeChunks(db, v, account, outcome);
    db.prepare("UPDATE file_versions SET extraction_status='complete', parser_version=?, unit_count=?, extraction_detail=? WHERE id=?").run(outcome.parserVersion, outcome.units.length, outcome.detail, v.id);
    return { status: "complete", detail: outcome.detail, cached: false };
  }
  db.prepare("UPDATE file_versions SET extraction_status=?, parser_version=?, extraction_detail=? WHERE id=?").run(outcome.status, outcome.parserVersion, outcome.detail.slice(0, 300), v.id);
  return { status: outcome.status, detail: outcome.detail, cached: false };
}

export { sha256 };
