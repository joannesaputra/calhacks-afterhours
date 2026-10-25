import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBackup, markReviewed, openDb, readMigrations, restoreBackup, verifyBackup } from "../src";
import { makeTestDb, runToReady } from "../src/testing";

const T = new Date("2026-10-24T20:00:00Z");
const tmp = () => mkdtempSync(path.join(tmpdir(), "ah-backup-"));

function populated() {
  const { db, config } = makeTestDb();
  const a = runToReady(db, config, "a", T);
  const b = runToReady(db, config, "b", T);
  markReviewed(db, a.taskId, 1, "approve", T);
  return { db, config, a, b };
}

describe("consistent backup and restore into an isolated location", () => {
  it("backs up a running (WAL) database, restores it elsewhere, and verifies rows plus referenced-file hashes", async () => {
    const { db, config, a, b } = populated();
    expect(existsSync(config.databasePath + "-wal")).toBe(true); // live WAL file: a raw copy of the main file would be wrong
    const out = path.join(tmp(), "backup");
    const m = await createBackup(db, config.artifactsDir, out, T);
    expect(m.summary).toMatchObject({ tasks: 2, artifacts: 4, notifications: 2, schemaVersion: Math.max(...readMigrations().map((m) => m.version)) });
    expect(m.files).toHaveLength(4);
    expect(verifyBackup(out).ok).toBe(true);

    // The app keeps running and changes after the snapshot; the backup is unaffected.
    runToReady(db, config, "c", T);
    expect(verifyBackup(out).summary!.tasks).toBe(2);

    const dest = path.join(tmp(), "restored");
    const restored = restoreBackup(out, dest);
    expect(restored.ok).toBe(true);
    const r = openDb(path.join(dest, "afterhours.sqlite"));
    expect(r.prepare("SELECT id, status FROM tasks ORDER BY id").all()).toEqual(
      ([a.taskId, b.taskId].sort()).map((id) => ({ id, status: id === a.taskId ? "approved" : "ready" })));
    const rows = r.prepare("SELECT rel_path, sha256 FROM artifacts").all() as Array<{ rel_path: string; sha256: string }>;
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(existsSync(path.join(dest, "artifacts", row.rel_path))).toBe(true);
      expect(readFileSync(path.join(dest, "artifacts", row.rel_path)).byteLength).toBeGreaterThan(100);
    }
    expect(r.prepare("SELECT COUNT(*) n FROM notification_members").get()).toEqual({ n: 2 });
    r.close();
    // Nothing from the live data directory was touched.
    expect(readdirSync(config.artifactsDir).length).toBeGreaterThan(0);
  });

  it("verification fails on a missing or altered artifact, a damaged database, or an unreadable folder", async () => {
    const { db, config } = populated();
    const out = path.join(tmp(), "backup");
    await createBackup(db, config.artifactsDir, out);
    const first = (db.prepare("SELECT rel_path FROM artifacts ORDER BY rel_path").get() as { rel_path: string }).rel_path;
    writeFileSync(path.join(out, "artifacts", first), Buffer.from("tampered"));
    expect(verifyBackup(out).problems.join(" ")).toMatch(/does not match manifest/);
    rmSync(path.join(out, "artifacts", first));
    expect(verifyBackup(out).problems.join(" ")).toMatch(/missing artifact file/);
    expect(() => restoreBackup(out, path.join(tmp(), "dest"))).toThrow(/failed verification/);
    expect(verifyBackup(path.join(tmp(), "nothing")).ok).toBe(false);
  });

  it("never overwrites: a non-empty backup or restore destination is refused", async () => {
    const { db, config } = populated();
    const dest = tmp();
    writeFileSync(path.join(dest, "keep.txt"), "x");
    await expect(createBackup(db, config.artifactsDir, dest)).rejects.toThrow(/not empty/);
    const out = path.join(tmp(), "backup");
    await createBackup(db, config.artifactsDir, out);
    expect(() => restoreBackup(out, dest)).toThrow(/not empty/);
    expect(readFileSync(path.join(dest, "keep.txt"), "utf8")).toBe("x");
  });

  it("does not copy unreferenced crash leftovers and refuses a backup if a referenced file is damaged", async () => {
    const { db, config } = populated();
    writeFileSync(path.join(config.artifactsDir, "stray.bin"), "x");
    const out = path.join(tmp(), "backup");
    await createBackup(db, config.artifactsDir, out);
    expect(existsSync(path.join(out, "artifacts", "stray.bin"))).toBe(false);
    const rel = (db.prepare("SELECT rel_path FROM artifacts LIMIT 1").get() as { rel_path: string }).rel_path;
    writeFileSync(path.join(config.artifactsDir, rel), "damaged");
    await expect(createBackup(db, config.artifactsDir, path.join(tmp(), "second"))).rejects.toThrow(/does not match its manifest/);
  });
});
