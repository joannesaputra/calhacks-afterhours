import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { openDb } from "./db";
import { resolveArtifactPath, sha256Bytes } from "./artifacts";

/**
 * Consistent backup and restore of the single-host database plus its artifact files (Batch 5).
 *
 * Why not copy `afterhours.sqlite` while the app runs: in WAL mode committed data may still live in the `-wal`
 * file, so copying only the main file can silently drop recent work (https://www.sqlite.org/howtocorrupt.html).
 * The supported online method is SQLite's backup API (https://www.sqlite.org/backup.html), used here through
 * better-sqlite3's `db.backup()`, which yields one transactionally consistent snapshot while the app keeps running.
 *
 * Ordering matters and is part of the procedure:
 *  1. Snapshot the database first.
 *  2. Then copy every artifact file that the SNAPSHOT's manifest references. Published artifact files are immutable
 *     and are promoted to disk before their manifest row is committed, so every file a snapshot references already
 *     exists and cannot change. Unreferenced files (crash leftovers) are deliberately not copied.
 *  3. Verify: SQLite integrity, foreign keys, and size plus SHA-256 of every referenced file.
 * The backup directory never contains `.env`: secrets stay outside it, and a restore needs the same
 * TOKEN_ENCRYPTION_KEY or saved Gmail tokens cannot be decrypted (reconnect Gmail).
 */
export interface BackupSummary {
  database: string;
  artifactsDir: string;
  tasks: number;
  artifacts: number;
  artifactBytes: number;
  notifications: number;
  schemaVersion: number;
}

export interface BackupManifest {
  format: "afterhours-backup-v1";
  createdAt: string;
  summary: BackupSummary;
  files: Array<{ relPath: string; sizeBytes: number; sha256: string }>;
}

const DB_NAME = "afterhours.sqlite";
const ART_DIR = "artifacts";

interface ArtRow { rel_path: string; size_bytes: number; sha256: string }

function summarize(db: Database.Database, files: BackupManifest["files"]): BackupSummary {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    database: DB_NAME, artifactsDir: ART_DIR,
    tasks: n("SELECT COUNT(*) n FROM tasks"),
    artifacts: n("SELECT COUNT(*) n FROM artifacts"),
    artifactBytes: files.reduce((t, f) => t + f.sizeBytes, 0),
    notifications: n("SELECT COUNT(*) n FROM notifications"),
    schemaVersion: n("SELECT COALESCE(MAX(version), 0) n FROM schema_migrations"),
  };
}

function copyReferenced(snapshot: Database.Database, srcArtifacts: string, dstArtifacts: string): BackupManifest["files"] {
  const rows = snapshot.prepare("SELECT rel_path, size_bytes, sha256 FROM artifacts ORDER BY rel_path").all() as ArtRow[];
  const out: BackupManifest["files"] = [];
  for (const r of rows) {
    const src = resolveArtifactPath(srcArtifacts, r.rel_path);
    if (!src) throw new Error(`Referenced artifact is missing or unsafe: ${r.rel_path}`);
    const bytes = readFileSync(src);
    if (bytes.byteLength !== r.size_bytes || sha256Bytes(bytes) !== r.sha256) {
      throw new Error(`Referenced artifact does not match its manifest: ${r.rel_path}`);
    }
    const dst = path.join(dstArtifacts, r.rel_path);
    mkdirSync(path.dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    out.push({ relPath: r.rel_path, sizeBytes: r.size_bytes, sha256: r.sha256 });
  }
  // Retained source files (email attachments, shared-folder files). They can be fetched again from their source, so a
  // blob that is already missing or altered is skipped rather than failing the backup.
  const hasVersions = snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_versions'").get();
  const blobs = hasVersions ? (snapshot.prepare("SELECT DISTINCT blob_rel_path p, checksum_sha256 s FROM file_versions WHERE blob_rel_path IS NOT NULL").all() as Array<{ p: string; s: string | null }>) : [];
  for (const b of blobs) {
    const src = resolveArtifactPath(srcArtifacts, b.p);
    if (!src) continue;
    const bytes = readFileSync(src);
    if (b.s && sha256Bytes(bytes) !== b.s) continue;
    const dst = path.join(dstArtifacts, b.p);
    mkdirSync(path.dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }
  return out;
}

/** Create a backup directory. `outDir` must not exist or must be empty. Safe to run while the app is running. */
export async function createBackup(db: Database.Database, artifactsDir: string, outDir: string, now: Date = new Date()): Promise<BackupManifest> {
  if (existsSync(outDir) && readdirSync(outDir).length > 0) throw new Error("Backup destination is not empty; refusing to overwrite.");
  mkdirSync(outDir, { recursive: true });
  const dbOut = path.join(outDir, DB_NAME);
  await db.backup(dbOut);
  const snap = new Database(dbOut, { readonly: true, fileMustExist: true });
  try {
    const files = copyReferenced(snap, artifactsDir, path.join(outDir, ART_DIR));
    const manifest: BackupManifest = { format: "afterhours-backup-v1", createdAt: now.toISOString(), summary: summarize(snap, files), files };
    writeFileSync(path.join(outDir, "backup-manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  } finally {
    snap.close();
  }
}

export interface VerifyResult { ok: boolean; problems: string[]; summary: BackupSummary | null }

/** Check a backup (or a restored data directory laid out the same way) without modifying it. */
export function verifyBackup(dir: string): VerifyResult {
  const problems: string[] = [];
  const dbFile = path.join(dir, DB_NAME);
  if (!existsSync(dbFile)) return { ok: false, problems: ["afterhours.sqlite is missing"], summary: null };
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") problems.push(`SQLite integrity_check: ${String(integrity)}`);
    const fk = db.pragma("foreign_key_check") as unknown[];
    if (fk.length) problems.push(`${fk.length} foreign key violation(s)`);
    const rows = db.prepare("SELECT rel_path, size_bytes, sha256 FROM artifacts ORDER BY rel_path").all() as ArtRow[];
    const artRoot = path.join(dir, ART_DIR);
    const files: BackupManifest["files"] = [];
    for (const r of rows) {
      const p = existsSync(artRoot) ? resolveArtifactPath(artRoot, r.rel_path) : null;
      if (!p) { problems.push(`missing artifact file: ${r.rel_path}`); continue; }
      const bytes = readFileSync(p);
      if (bytes.byteLength !== r.size_bytes || sha256Bytes(bytes) !== r.sha256) problems.push(`artifact does not match manifest: ${r.rel_path}`);
      files.push({ relPath: r.rel_path, sizeBytes: r.size_bytes, sha256: r.sha256 });
    }
    // Retained source files that are present must match their checksum; absent ones are re-fetched on demand.
    const hasVersions = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_versions'").get();
    for (const b of hasVersions ? (db.prepare("SELECT DISTINCT blob_rel_path p, checksum_sha256 s FROM file_versions WHERE blob_rel_path IS NOT NULL").all() as Array<{ p: string; s: string | null }>) : []) {
      const p = existsSync(artRoot) ? resolveArtifactPath(artRoot, b.p) : null;
      if (p && b.s && sha256Bytes(readFileSync(p)) !== b.s) problems.push(`retained source file does not match its checksum: ${b.p}`);
    }
    const stuck = (db.prepare("SELECT COUNT(*) n FROM tasks t WHERE t.status IN ('ready','approved') AND NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.task_id=t.id AND a.revision=t.revision)").get() as { n: number }).n;
    if (stuck) problems.push(`${stuck} ready/approved task(s) have no artifacts for their current revision`);
    return { ok: problems.length === 0, problems, summary: summarize(db, files) };
  } finally {
    db.close();
  }
}

/** Restore a verified backup into a NEW, empty directory (never over live data). Returns the verification of the result. */
export function restoreBackup(backupDir: string, destDir: string): VerifyResult {
  const before = verifyBackup(backupDir);
  if (!before.ok) throw new Error(`Backup failed verification: ${before.problems.join("; ")}`);
  if (existsSync(destDir) && readdirSync(destDir).length > 0) throw new Error("Restore destination is not empty; refusing to overwrite.");
  mkdirSync(path.join(destDir, ART_DIR), { recursive: true });
  copyFileSync(path.join(backupDir, DB_NAME), path.join(destDir, DB_NAME));
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(backupDir, ART_DIR, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) { mkdirSync(path.join(destDir, ART_DIR, r), { recursive: true }); walk(r); }
      else if (e.isFile()) copyFileSync(path.join(backupDir, ART_DIR, r), path.join(destDir, ART_DIR, r));
    }
  };
  if (existsSync(path.join(backupDir, ART_DIR))) walk("");
  // Open once through the normal path so WAL mode and pending migrations apply, then close cleanly (checkpoint).
  const db = openDb(path.join(destDir, DB_NAME));
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  const after = verifyBackup(destDir);
  if (!after.ok) throw new Error(`Restored copy failed verification: ${after.problems.join("; ")}`);
  return after;
}
