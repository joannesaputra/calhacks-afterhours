import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { getSettings, type AppConfig } from "@afterhours/data";
import { makeTestConfig, makeTestDb, runToReady } from "@afterhours/data/testing";
import { buildApp } from "../src/app";

const ORIGIN = "http://localhost:3000";
let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function boot() {
  const config: AppConfig = makeTestConfig();
  const { db } = makeTestDb(config);
  app = await buildApp({ config, db, rateLimit: false });
  const r = await app.inject({ method: "POST", url: "/v1/session", headers: { origin: ORIGIN }, payload: { password: "correct-horse-battery" } });
  const cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
  return { app, db, config, h: { cookie, origin: ORIGIN } };
}

describe("quiet-hours settings validation over HTTP", () => {
  it("rejects an invalid zone, a bad time, and an enabled equal start/end with 400 and leaves settings unchanged", async () => {
    const { app, db, h } = await boot();
    const before = JSON.stringify(getSettings(db));
    const patch = (notifications: unknown) => app.inject({ method: "PATCH", url: "/v1/settings", headers: h, payload: { notifications } });
    const cases: Array<[unknown, RegExp]> = [
      [{ quietHours: { timezone: "Not/AZone" } }, /Unknown IANA timezone/],
      [{ quietHours: { timezone: "UTC+3" } }, /Unknown IANA timezone/],
      [{ quietHours: { enabled: true, start: "08:00", end: "08:00" } }, /ambiguous/i],
      [{ quietHours: { start: "9:00" } }, /./],
      [{ digestTime: "24:00" }, /./],
    ];
    for (const [body, re] of cases) {
      const r = await patch(body);
      expect(r.statusCode).toBe(400);
      const err = r.json().error as { code: string; message: string; requestId: string };
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(r.json())).toMatch(re);
      expect(JSON.stringify(r.json())).not.toMatch(/stack|at \w+ \(/);
    }
    expect(JSON.stringify(getSettings(db))).toBe(before);
    const ok = await patch({ quietHours: { enabled: true, start: "22:00", end: "08:00", timezone: "America/Los_Angeles" }, digestTime: "08:00" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.notifications.quietHours).toEqual({ enabled: true, start: "22:00", end: "08:00", timezone: "America/Los_Angeles" });
  });
});

describe("immutable artifact paths over HTTP", () => {
  it("the download route serves the manifest's exact bytes; other files in the directory are unreachable", async () => {
    const { app, db, config, h } = await boot();
    const { taskId } = runToReady(db, config, "k", new Date("2026-10-24T20:00:00Z"));
    const rows = db.prepare("SELECT id, rel_path, sha256, size_bytes FROM artifacts WHERE task_id=?").all(taskId) as Array<{ id: string; rel_path: string; sha256: string; size_bytes: number }>;
    expect(rows).toHaveLength(2);
    // A crash leftover next to the real files is never served, and a path-shaped id is not accepted.
    writeFileSync(path.join(config.artifactsDir, taskId, "r1", "leftover.docx"), "stale attempt bytes");
    for (const r of rows) {
      const res = await app.inject({ method: "GET", url: `/v1/artifacts/${r.id}/download`, headers: h });
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.byteLength).toBe(r.size_bytes);
      expect(createHash("sha256").update(res.rawPayload).digest("hex")).toBe(r.sha256);
      expect(readFileSync(path.join(config.artifactsDir, r.rel_path)).byteLength).toBe(r.size_bytes);
    }
    const bad = await app.inject({ method: "GET", url: `/v1/artifacts/${encodeURIComponent(`${taskId}/r1/leftover.docx`)}/download`, headers: h });
    expect(bad.statusCode).toBe(404);
  });
});
