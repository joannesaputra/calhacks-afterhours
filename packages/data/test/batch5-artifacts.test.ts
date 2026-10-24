import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ArtifactValidationError, LeaseLostError, claimNextJob, cleanOrphanArtifacts, commitEngineResult, promoteStagedFiles,
  publishArtifactFiles, recoverExpiredJobs, stageArtifactFiles, verifyStoredFiles, type Db,
} from "../src";
import { injectTask, makeTestDb, officeBytes, readyResult } from "../src/testing";

const T0 = new Date("2026-10-24T20:00:00Z");
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

/** A ready result whose bytes are unique to `marker` (so two attempts produce different files). */
function resultWith(taskId: string, revision: number, marker: string) {
  const r = readyResult({ taskId, revision });
  return { ...r, files: r.files.map((f) => ({ ...f, bytes: officeBytes(f.format, marker) })) };
}
const listFiles = (root: string, taskId: string, rev = 1) => {
  const dir = path.join(root, taskId, `r${rev}`);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};
const manifest = (db: Db, taskId: string) => db.prepare("SELECT id, rel_path, sha256, size_bytes FROM artifacts WHERE task_id=? ORDER BY id").all(taskId) as Array<{ id: string; rel_path: string; sha256: string; size_bytes: number }>;

function ctx() {
  const { db, config } = makeTestDb();
  const taskId = injectTask(db, config, "k", T0);
  return { db, config, taskId, root: config.artifactsDir };
}

describe("publication boundaries: a partial set is never visible as ready", () => {
  it("crash AFTER staging: nothing visible at final paths, staging removed, no manifest, task not ready", () => {
    const { db, config, taskId, root } = ctx();
    const claimed = claimNextJob(db, "w1", T0)!;
    const r = resultWith(taskId, 1, "aaaa");
    expect(() => publishArtifactFiles(root, taskId, 1, r.files, { afterStage: () => { throw new Error("crash"); } })).toThrow("crash");
    expect(listFiles(root, taskId)).toEqual([]);
    expect(existsSync(path.join(root, ".staging")) ? readdirSync(path.join(root, ".staging")) : []).toEqual([]);
    expect(manifest(db, taskId)).toEqual([]);
    expect(db.prepare("SELECT status FROM tasks WHERE id=?").get(taskId)).toEqual({ status: "planning" });
    void claimed; void config;
  });

  it("an invalid or incomplete second file stages nothing: no final file appears for the valid first one", () => {
    const { taskId, root } = ctx();
    const r = resultWith(taskId, 1, "aaaa");
    const bad = [r.files[0]!, { ...r.files[1]!, bytes: new Uint8Array(500) }];
    expect(() => publishArtifactFiles(root, taskId, 1, bad)).toThrow(ArtifactValidationError);
    expect(listFiles(root, taskId)).toEqual([]);
  });

  it("crash AFTER promotion but BEFORE the DB commit: files exist, manifest does not, a restart's attempt wins cleanly", () => {
    const { db, config, taskId, root } = ctx();
    const a = claimNextJob(db, "w1", T0)!;
    const ra = resultWith(taskId, 1, "aaaa");
    expect(() => publishArtifactFiles(root, taskId, 1, ra.files, { afterPromote: () => { throw new Error("crash"); } })).toThrow("crash");
    const orphans = listFiles(root, taskId);
    expect(orphans).toHaveLength(2);
    expect(manifest(db, taskId)).toEqual([]); // the files are not part of any result
    expect(db.prepare("SELECT status FROM tasks WHERE id=?").get(taskId)).toEqual({ status: "planning" });

    // Lease expires; the next attempt publishes different bytes and commits.
    const later = new Date(T0.getTime() + 120_000);
    expect(recoverExpiredJobs(db, later)).toBe(1);
    const b = claimNextJob(db, "w2", later)!;
    expect(b.attempts).toBe(2);
    const rb = resultWith(taskId, 1, "bbbb");
    const stored = publishArtifactFiles(root, taskId, 1, rb.files);
    commitEngineResult(db, { taskId, revision: 1, ownerToken: b.ownerToken, now: later, outcome: "ready", plan: rb.plan, sources: rb.sources, products: rb.products, warnings: [], files: stored });
    expect(db.prepare("SELECT status FROM tasks WHERE id=?").get(taskId)).toEqual({ status: "ready" });
    const m = manifest(db, taskId);
    expect(m).toHaveLength(2);
    for (const row of m) expect(sha(readFileSync(path.join(root, row.rel_path)))).toBe(row.sha256);
    // The crashed attempt's files are still there, untouched, and not referenced.
    expect(listFiles(root, taskId)).toHaveLength(4);
    for (const o of orphans) expect(m.some((x) => x.rel_path.endsWith(o))).toBe(false);
    void a; void config;
  });

  it("a stale attempt that finishes late cannot overwrite the winner's bytes nor publish a manifest", () => {
    const { db, config, taskId, root } = ctx();
    const a = claimNextJob(db, "w1", T0)!;
    // Attempt A stalls after staging (frozen process).
    const setA = stageArtifactFiles(root, taskId, 1, resultWith(taskId, 1, "aaaa").files);
    // Lease expires, attempt B wins completely.
    const later = new Date(T0.getTime() + 120_000);
    recoverExpiredJobs(db, later);
    const b = claimNextJob(db, "w2", later)!;
    const rb = resultWith(taskId, 1, "bbbb");
    const storedB = publishArtifactFiles(root, taskId, 1, rb.files);
    commitEngineResult(db, { taskId, revision: 1, ownerToken: b.ownerToken, now: later, outcome: "ready", plan: rb.plan, sources: rb.sources, products: rb.products, warnings: [], files: storedB });
    const winnerBytes = storedB.map((f) => ({ f, bytes: readFileSync(path.join(root, f.relPath)), mtime: statSync(path.join(root, f.relPath)).mtimeMs }));
    const manifestBefore = manifest(db, taskId);

    // Attempt A wakes up: it promotes (its own content-qualified paths) and tries to commit.
    const storedA = promoteStagedFiles(setA);
    expect(storedA.map((f) => f.id)).toEqual(storedB.map((f) => f.id)); // same public ids...
    expect(storedA.map((f) => f.relPath)).not.toEqual(storedB.map((f) => f.relPath)); // ...different physical files
    const ra = resultWith(taskId, 1, "aaaa");
    expect(() => commitEngineResult(db, { taskId, revision: 1, ownerToken: a.ownerToken, now: new Date(later.getTime() + 5000), outcome: "ready", plan: ra.plan, sources: ra.sources, products: ra.products, warnings: [], files: storedA })).toThrow(LeaseLostError);

    // Independent comparison of winning physical bytes and manifest after the stale attempt.
    for (const w of winnerBytes) {
      const now = readFileSync(path.join(root, w.f.relPath));
      expect(Buffer.compare(now, w.bytes)).toBe(0);
      expect(sha(now)).toBe(w.f.sha256);
      expect(statSync(path.join(root, w.f.relPath)).mtimeMs).toBe(w.mtime);
    }
    expect(manifest(db, taskId)).toEqual(manifestBefore);
    verifyStoredFiles(root, storedB);
    expect(db.prepare("SELECT COUNT(*) n FROM notifications").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT status FROM jobs WHERE task_id=?").get(taskId)).toEqual({ status: "done" });
    void config;
  });

  it("identical bytes republished by a retry reuse the same immutable file (no rewrite)", () => {
    const { taskId, root } = ctx();
    const files = resultWith(taskId, 1, "same").files;
    const first = publishArtifactFiles(root, taskId, 1, files);
    const p = path.join(root, first[0]!.relPath);
    const before = statSync(p);
    const second = publishArtifactFiles(root, taskId, 1, files);
    expect(second.map((f) => f.relPath)).toEqual(first.map((f) => f.relPath));
    const after = statSync(p);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(listFiles(root, taskId)).toHaveLength(2);
  });

  it("refuses to adopt a file that already sits at an immutable path with different bytes", () => {
    const { taskId, root } = ctx();
    const files = resultWith(taskId, 1, "same").files;
    const [f] = publishArtifactFiles(root, taskId, 1, files);
    writeFileSync(path.join(root, f!.relPath), Buffer.from("tampered"));
    expect(() => publishArtifactFiles(root, taskId, 1, files)).toThrow(/different file already exists/);
    expect(readFileSync(path.join(root, f!.relPath)).toString()).toBe("tampered"); // left alone, not overwritten
  });

  it("verifyStoredFiles catches a missing, truncated or swapped file before the manifest can be committed", () => {
    const { taskId, root } = ctx();
    const stored = publishArtifactFiles(root, taskId, 1, resultWith(taskId, 1, "okok").files);
    verifyStoredFiles(root, stored);
    const p = path.join(root, stored[0]!.relPath);
    writeFileSync(p, readFileSync(p).subarray(0, 50));
    expect(() => verifyStoredFiles(root, stored)).toThrow(/does not match its manifest/);
    expect(() => verifyStoredFiles(root, [{ ...stored[1]!, relPath: `${taskId}/r1/missing.docx` }])).toThrow(/missing or unsafe/);
  });

  it("ready commit after promotion: the published manifest points at exactly the verified bytes", () => {
    const { db, taskId, root } = ctx();
    const a = claimNextJob(db, "w1", T0)!;
    const r = resultWith(taskId, 1, "good");
    const stored = publishArtifactFiles(root, taskId, 1, r.files);
    verifyStoredFiles(root, stored);
    commitEngineResult(db, { taskId, revision: 1, ownerToken: a.ownerToken, now: T0, outcome: "ready", plan: r.plan, sources: r.sources, products: r.products, warnings: [], files: stored });
    const m = manifest(db, taskId);
    const byPath = <T extends { rel_path: string }>(a: T, b: T) => a.rel_path.localeCompare(b.rel_path);
    expect(m.map((x) => ({ rel_path: x.rel_path, sha256: x.sha256, size_bytes: x.size_bytes })).sort(byPath)).toEqual(
      stored.map((s) => ({ rel_path: s.relPath, sha256: s.sha256, size_bytes: s.sizeBytes })).sort(byPath));
  });
});

describe("orphan cleanup is conservative and scoped", () => {
  const DAY = 24 * 3600_000;
  const old = (p: string, now: Date) => { const t = new Date(now.getTime() - 2 * DAY); utimesSync(p, t, t); };

  it("removes only old, unreferenced regular files with no queued/running job; keeps referenced, young, in-flight", () => {
    const { db, config, taskId, root } = ctx();
    const a = claimNextJob(db, "w1", T0)!;
    // Winning, referenced files for revision 1.
    const r = resultWith(taskId, 1, "win");
    const stored = publishArtifactFiles(root, taskId, 1, r.files);
    commitEngineResult(db, { taskId, revision: 1, ownerToken: a.ownerToken, now: T0, outcome: "ready", plan: r.plan, sources: r.sources, products: r.products, warnings: [], files: stored });
    // An old orphan and a young orphan in revision 1, plus an old orphan in a revision with a running job.
    const dir1 = path.join(root, taskId, "r1");
    const oldOrphan = path.join(dir1, "art_orphan_old.docx");
    const youngOrphan = path.join(dir1, "art_orphan_young.docx");
    writeFileSync(oldOrphan, "x"); old(oldOrphan, new Date());
    writeFileSync(youngOrphan, "y");
    mkdirSync(path.join(root, taskId, "r2"), { recursive: true });
    const inFlight = path.join(root, taskId, "r2", "art_inflight.docx");
    writeFileSync(inFlight, "z"); old(inFlight, new Date());
    const now = Date.now();
    db.prepare("INSERT INTO jobs (id, task_id, revision, status, attempts, available_at, created_at, updated_at) VALUES ('j2',?,2,'running',1,?,?,?)").run(taskId, T0.toISOString(), T0.toISOString(), T0.toISOString());

    const res = cleanOrphanArtifacts(db, root, now);
    expect(res.removed).toBe(1);
    expect(existsSync(oldOrphan)).toBe(false);
    expect(existsSync(youngOrphan)).toBe(true);
    expect(existsSync(inFlight)).toBe(true); // r2 job is running
    for (const s of stored) expect(existsSync(path.join(root, s.relPath))).toBe(true);
    verifyStoredFiles(root, stored);

    // Once the job is no longer active the old orphan in r2 can go; referenced files still never do.
    db.prepare("UPDATE jobs SET status='failed' WHERE id='j2'").run();
    expect(cleanOrphanArtifacts(db, root, now).removed).toBe(1);
    expect(existsSync(inFlight)).toBe(false);
    expect(cleanOrphanArtifacts(db, root, now + 30 * DAY).removed).toBe(1); // the young orphan, once it is old
    for (const s of stored) expect(existsSync(path.join(root, s.relPath))).toBe(true);
    void config;
  });

  it("does not follow symlinks, touch .staging, or leave the artifact root", () => {
    const { db, taskId, root } = ctx();
    mkdirSync(path.join(root, taskId, "r1"), { recursive: true });
    const outside = path.join(root, "..", `outside-${taskId}.txt`);
    writeFileSync(outside, "keep me"); old(outside, new Date());
    const link = path.join(root, taskId, "r1", "link.docx");
    symlinkSync(outside, link);
    const hard = path.join(root, "..", `hard-${taskId}.txt`);
    writeFileSync(hard, "keep too");
    // A symlinked revision directory pointing outside the root is skipped entirely.
    symlinkSync(path.dirname(root), path.join(root, taskId, "r9"));
    mkdirSync(path.join(root, ".staging", "active"), { recursive: true });
    const staged = path.join(root, ".staging", "active", "f.docx");
    writeFileSync(staged, "in flight"); old(staged, new Date());
    linkSync(hard, path.join(root, taskId, "r1", "hardlink.docx"));
    old(path.join(root, taskId, "r1", "hardlink.docx"), new Date());

    cleanOrphanArtifacts(db, root, Date.now());
    expect(readFileSync(outside, "utf8")).toBe("keep me");
    expect(readFileSync(staged, "utf8")).toBe("in flight");
    expect(existsSync(link)).toBe(true); // a symlink is never removed or followed
    expect(readFileSync(hard, "utf8")).toBe("keep too"); // removing a hard-linked copy does not touch its sibling
  });
});
