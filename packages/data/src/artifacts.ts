import { createHash, randomUUID } from "node:crypto";
import { linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GeneratedFile } from "@afterhours/contracts";
import type { Db } from "./db";
import type { StoredFile } from "./queue";

const SAFE = /^[A-Za-z0-9._-]{1,200}$/;
const SIGNATURES = { docx: "word/document.xml", pptx: "ppt/presentation.xml" } as const;
const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;
export const MIME_BY_FORMAT = MIME;

export class ArtifactValidationError extends Error {}

/** Check a generated file is a real Office ZIP container for its declared format. */
export function validateOfficeBytes(f: Pick<GeneratedFile, "format" | "bytes" | "id" | "filename">): void {
  const b = f.bytes;
  if (!b || b.byteLength < 100) throw new ArtifactValidationError(`${f.filename}: file is empty or too small`);
  if (!(b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04)) {
    throw new ArtifactValidationError(`${f.filename}: not a ZIP/Office container`);
  }
  const text = Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");
  if (!text.includes("[Content_Types].xml") || !text.includes(SIGNATURES[f.format])) {
    throw new ArtifactValidationError(`${f.filename}: missing required ${f.format} parts`);
  }
}

export const sha256Bytes = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

export function sanitizeFilename(name: string, fallback: string): string {
  const base = path.basename(name).replace(/[^\w.\- ()]/g, "_").replace(/^\.+/, "").slice(0, 120).trim();
  return base || fallback;
}

/**
 * Platform artifact id, deterministic per task/revision/product/format. Engine file ids are opaque
 * (they may contain "/" or other characters), so they are never used as a path segment or a URL id.
 */
export function artifactIdFor(taskId: string, revision: number, productId: string, format: string): string {
  return `art_${createHash("sha256").update(`${taskId}\0${revision}\0${productId}\0${format}`).digest("hex").slice(0, 32)}`;
}

/** A complete, validated file set written to an attempt-private staging directory, not yet visible anywhere. */
export interface StagedSet {
  root: string;
  stagingDir: string;
  files: Array<{ id: string; productId: string; format: "docx" | "pptx"; filename: string; mimeType: string; sizeBytes: number; sha256: string; relPath: string; stagedPath: string }>;
}

/**
 * Stage 1 of publication. Validates every file and writes them into `.staging/<random>/` (private to this call).
 * Physical final paths are immutable and content-qualified: <task>/r<revision>/<artifactId>.<sha256[:16]>.<format>.
 * Public artifact ids stay deterministic per task/revision/product/format; only the physical file name carries the
 * content hash, so two attempts that produce different bytes can never write the same path.
 */
export function stageArtifactFiles(root: string, taskId: string, revision: number, files: GeneratedFile[]): StagedSet {
  if (!SAFE.test(taskId)) throw new ArtifactValidationError("Unsafe task id");
  const stagingDir = path.join(root, ".staging", randomUUID());
  mkdirSync(stagingDir, { recursive: true });
  try {
    const seen = new Set<string>();
    const staged: StagedSet["files"] = [];
    for (const f of files) {
      if (!f.id) throw new ArtifactValidationError(`${f.filename}: missing file id`);
      const key = `${f.productId}/${f.format}`;
      if (seen.has(key)) throw new ArtifactValidationError(`Duplicate file for product ${f.productId} (${f.format})`);
      seen.add(key);
      if (f.mimeType !== MIME[f.format]) throw new ArtifactValidationError(`${f.filename}: MIME type does not match ${f.format}`);
      validateOfficeBytes(f);
      const id = artifactIdFor(taskId, revision, f.productId, f.format);
      const sha = sha256Bytes(f.bytes);
      const stagedPath = path.join(stagingDir, `${id}.${f.format}`);
      writeFileSync(stagedPath, f.bytes, { mode: 0o640 });
      const size = statSync(stagedPath).size;
      if (size !== f.bytes.byteLength) throw new ArtifactValidationError(`${f.filename}: size mismatch after staging`);
      staged.push({
        id, productId: f.productId, format: f.format, filename: sanitizeFilename(f.filename, `${id}.${f.format}`),
        mimeType: f.mimeType, sizeBytes: size, sha256: sha,
        relPath: path.posix.join(taskId, `r${revision}`, `${id}.${sha.slice(0, 16)}.${f.format}`), stagedPath,
      });
    }
    return { root, stagingDir, files: staged };
  } catch (e) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw e;
  }
}

/** Place one staged file at its final path without ever replacing an existing file. Atomic via hard link. */
function promoteNoOverwrite(from: string, to: string, expected: { sha256: string; sizeBytes: number }): void {
  mkdirSync(path.dirname(to), { recursive: true });
  try {
    linkSync(from, to);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      // Same content-qualified name: only acceptable if it really holds the same bytes (idempotent retry).
      const have = readFileSync(to);
      if (have.byteLength !== expected.sizeBytes || sha256Bytes(have) !== expected.sha256) {
        throw new ArtifactValidationError("A different file already exists at an immutable artifact path");
      }
      return;
    }
    if (code === "EPERM" || code === "ENOTSUP" || code === "EXDEV" || code === "EOPNOTSUPP") {
      // Filesystem without hard links: exclusive create keeps the no-overwrite guarantee.
      writeFileSync(to, readFileSync(from), { flag: "wx", mode: 0o640 });
      return;
    }
    throw e;
  }
}

/**
 * Stage 2 of publication. Atomically (hard link) makes each staged file visible at its immutable final path, then
 * removes the staging directory. Existing files are never overwritten or deleted, including files another attempt
 * may already reference. Visibility on disk is not publication: the manifest row is the only thing that makes a file
 * part of a ready result.
 */
export function promoteStagedFiles(set: StagedSet): StoredFile[] {
  try {
    const out: StoredFile[] = [];
    for (const f of set.files) {
      promoteNoOverwrite(f.stagedPath, path.join(set.root, f.relPath), f);
      out.push({ id: f.id, productId: f.productId, format: f.format, filename: f.filename, mimeType: f.mimeType,
        sizeBytes: f.sizeBytes, sha256: f.sha256, relPath: f.relPath });
    }
    return out;
  } finally {
    rmSync(set.stagingDir, { recursive: true, force: true });
  }
}

export interface PublishHooks { afterStage?: () => void; afterPromote?: () => void }

/** Stage then promote. Paths are immutable and content-qualified, so a retry or a stale attempt cannot corrupt a winner. */
export function publishArtifactFiles(
  root: string, taskId: string, revision: number, files: GeneratedFile[], hooks?: PublishHooks,
): StoredFile[] {
  const set = stageArtifactFiles(root, taskId, revision, files);
  try {
    hooks?.afterStage?.();
    const stored = promoteStagedFiles(set);
    hooks?.afterPromote?.();
    return stored;
  } finally {
    rmSync(set.stagingDir, { recursive: true, force: true });
  }
}

/** Re-read every stored file and check it still matches the manifest about to be committed (size and SHA-256). */
export function verifyStoredFiles(root: string, files: StoredFile[]): void {
  for (const f of files) {
    const full = resolveArtifactPath(root, f.relPath);
    if (!full) throw new ArtifactValidationError(`${f.filename}: stored file is missing or unsafe`);
    const bytes = readFileSync(full);
    if (bytes.byteLength !== f.sizeBytes || sha256Bytes(bytes) !== f.sha256) {
      throw new ArtifactValidationError(`${f.filename}: stored file does not match its manifest`);
    }
  }
}

/** Resolve a stored relative path to an absolute path strictly inside root. Rejects symlinks/escapes. */
export function resolveArtifactPath(root: string, rel: string): string | null {
  if (rel.includes("\0") || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) return null;
  const full = path.resolve(root, rel);
  const rootReal = realpathSync(root);
  try {
    if (lstatSync(full).isSymbolicLink()) return null;
    const real = realpathSync(full);
    if (!real.startsWith(rootReal + path.sep)) return null;
    return real;
  } catch {
    return null;
  }
}

/** Remove leftover staging dirs older than `maxAgeMs`. Orphaned final files stay (unreferenced, harmless). */
export function cleanStaging(root: string, nowMs: number, maxAgeMs = 3600_000): number {
  const dir = path.join(root, ".staging");
  let n = 0;
  try {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (nowMs - statSync(p).mtimeMs > maxAgeMs) { rmSync(p, { recursive: true, force: true }); n++; }
    }
  } catch { /* none */ }
  return n;
}

export const ORPHAN_MIN_AGE_MS = 24 * 3600_000;

/**
 * Conservative orphan policy. An unreferenced final file (left by a crashed or losing attempt) is removed only when
 *  - it is a regular file, not a symlink, found at <root>/<task>/r<n>/<name> (nothing is followed or recursed into),
 *  - no manifest row references its path,
 *  - it is older than `minAgeMs` (default 24 h), and
 *  - no queued or running job exists for that task and revision, so a current or in-flight attempt is never touched.
 * Referenced files and `.staging` (handled by cleanStaging) are never deleted here.
 */
export function cleanOrphanArtifacts(
  db: Db, root: string, nowMs: number, minAgeMs = ORPHAN_MIN_AGE_MS,
): { removed: number; kept: number } {
  let removed = 0;
  let kept = 0;
  let tasks: string[];
  try { tasks = readdirSync(root); } catch { return { removed, kept }; }
  for (const taskDir of tasks) {
    if (taskDir === ".staging" || !SAFE.test(taskDir)) continue;
    const taskPath = path.join(root, taskDir);
    try { if (!lstatSync(taskPath).isDirectory()) continue; } catch { continue; }
    for (const revDir of readdirSync(taskPath)) {
      const m = /^r(\d+)$/.exec(revDir);
      if (!m) continue;
      const revPath = path.join(taskPath, revDir);
      try { if (!lstatSync(revPath).isDirectory()) continue; } catch { continue; }
      const revision = Number(m[1]);
      const active = db.prepare("SELECT 1 FROM jobs WHERE task_id=? AND revision=? AND status IN ('queued','running')").get(taskDir, revision);
      for (const name of readdirSync(revPath)) {
        const full = path.join(revPath, name);
        let st;
        try { st = lstatSync(full); } catch { continue; }
        if (!st.isFile() || st.isSymbolicLink()) continue;
        const rel = path.posix.join(taskDir, revDir, name);
        const referenced = db.prepare("SELECT 1 FROM artifacts WHERE rel_path=?").get(rel);
        if (referenced || active || nowMs - st.mtimeMs < minAgeMs) { kept++; continue; }
        rmSync(full, { force: true });
        removed++;
      }
    }
  }
  return { removed, kept };
}
