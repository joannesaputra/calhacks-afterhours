// Batch 5 platform durability drills. The engine and the delivery adapter are fakes (spies); child processes are real
// worker processes with real signals. Nothing here proves a live model, a live provider, or an elapsed overnight run:
// time is a controlled clock (`now`) except where a test says it waits for real elapsed time.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DeliveryInput, DeliveryResult, EngineDependencies, EngineInput, EngineResult } from "@afterhours/contracts";
import {
  LeaseLostError, bootstrapDb, getTaskDetail, getTaskSummary, openDb, patchSettings, recoverExpiredJobs, recoverNotificationLeases,
  type AppConfig, type Db,
} from "@afterhours/data";
import { injectTask, makeTestConfig, makeTestDb, officeBytes, readyResult, testPlan } from "@afterhours/data/testing";
import { createWorker, type WorkerDeps } from "../src/worker";

type Engine = (i: EngineInput, d: EngineDependencies) => Promise<EngineResult>;
const silent = () => undefined;
const T0 = new Date("2026-10-24T20:00:00Z");
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

const withMarker = (input: EngineInput, marker: string): EngineResult => {
  const r = readyResult(input);
  return { ...r, files: r.files.map((f) => ({ ...f, bytes: officeBytes(f.format, marker) })) };
};
const marked = (marker: string): Engine => async (input, deps) => {
  await deps.onProgress({ stage: "plan", message: `${marker}: planning`, plan: testPlan() });
  await deps.onProgress({ stage: "generate", message: `${marker}: generating` });
  return withMarker(input, marker);
};

interface Ctx { db: Db; config: AppConfig; clock: { now: Date } }
function ctx(config: AppConfig = makeTestConfig()): Ctx {
  const { db } = makeTestDb(config);
  return { db, config, clock: { now: T0 } };
}
function build(c: Ctx, id: string, engine: Engine, extra: Partial<WorkerDeps> & { sent?: DeliveryInput[]; send?: (i: DeliveryInput) => Promise<DeliveryResult> } = {}) {
  const sent = extra.sent ?? [];
  const engineCalls: EngineInput[] = [];
  const worker = createWorker({
    db: c.db, config: c.config, workerId: id, log: silent, now: () => c.clock.now,
    // Frozen attempts must not renew their lease: a dead process does not heartbeat.
    heartbeatIntervalMs: 3_600_000,
    runWork: async (i, d) => { engineCalls.push(i); return engine(i, d); },
    sendNotification: async (i) => {
      sent.push(i);
      return extra.send ? extra.send(i) : { state: "simulated", message: "m", providerMessageId: null, reason: null };
    },
    ...extra,
  });
  return { worker, sent, engineCalls };
}
const until = async (cond: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error("timed out waiting for condition"); await new Promise((r) => setTimeout(r, 15)); }
};
function frozen() {
  let release!: () => void;
  let reached = false;
  const gate = new Promise<void>((r) => { release = r; });
  return { hook: async () => { reached = true; await gate; }, release, get reached() { return reached; } };
}
const manifest = (db: Db, taskId: string) =>
  db.prepare("SELECT id, rel_path, sha256, size_bytes FROM artifacts WHERE task_id=? ORDER BY id").all(taskId) as Array<{ id: string; rel_path: string; sha256: string; size_bytes: number }>;
const filesOnDisk = (config: AppConfig, taskId: string) => {
  const dir = path.join(config.artifactsDir, taskId, "r1");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};
const count = (db: Db, sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;

describe("a stale attempt cannot corrupt the winner, at either publication boundary", () => {
  for (const boundary of ["afterStage", "afterPromote"] as const) {
    it(`attempt 1 freezes ${boundary}; lease expires; attempt 2 wins; attempt 1 resumes late`, async () => {
      const c = ctx();
      const taskId = injectTask(c.db, c.config, "k", c.clock.now);
      const gate = frozen();
      const w1 = build(c, "w1", marked("attempt-1"), { testHooks: { [boundary]: gate.hook } });
      const p1 = w1.worker.processNextJob();
      await until(() => gate.reached);
      expect(getTaskSummary(c.db, taskId).status).toBe("running");
      if (boundary === "afterPromote") expect(filesOnDisk(c.config, taskId)).toHaveLength(2);
      else expect(filesOnDisk(c.config, taskId)).toHaveLength(0);
      expect(manifest(c.db, taskId)).toEqual([]); // nothing is published until the DB commit

      // The lease is still valid: a second worker cannot take the job.
      c.clock.now = new Date(T0.getTime() + 60_000);
      expect(recoverExpiredJobs(c.db, c.clock.now)).toBe(0);
      const w2 = build(c, "w2", marked("attempt-2"));
      expect(await w2.worker.processNextJob()).toBe(false);

      // Lease expires (frozen process, no heartbeat) -> recovery -> attempt 2 completes.
      c.clock.now = new Date(T0.getTime() + 100_000);
      expect(recoverExpiredJobs(c.db, c.clock.now)).toBe(1);
      expect(await w2.worker.processNextJob()).toBe(true);
      expect(getTaskSummary(c.db, taskId).status).toBe("ready");
      const winner = manifest(c.db, taskId);
      expect(winner).toHaveLength(2);
      const winnerBytes = winner.map((m) => readFileSync(path.join(c.config.artifactsDir, m.rel_path)));
      winner.forEach((m, i) => expect(sha(winnerBytes[i]!)).toBe(m.sha256));

      // Attempt 1 wakes up late.
      gate.release();
      await p1;
      expect(manifest(c.db, taskId)).toEqual(winner);
      winner.forEach((m, i) => expect(Buffer.compare(readFileSync(path.join(c.config.artifactsDir, m.rel_path)), winnerBytes[i]!)).toBe(0));
      // afterStage: the stale attempt never promoted anything. afterPromote: its files exist but are unreferenced.
      expect(filesOnDisk(c.config, taskId)).toHaveLength(boundary === "afterStage" ? 2 : 4);
      expect(existsSync(path.join(c.config.artifactsDir, ".staging")) ? readdirSync(path.join(c.config.artifactsDir, ".staging")) : []).toEqual([]);
      // Exactly one ready event and notification intent; job done after two attempts.
      const detail = getTaskDetail(c.db, taskId);
      expect(detail.events.filter((e) => /^Ready for review/.test(e.message))).toHaveLength(1);
      expect(count(c.db, "SELECT COUNT(*) n FROM notifications")).toBe(1);
      expect(c.db.prepare("SELECT status, attempts FROM jobs WHERE task_id=?").get(taskId)).toEqual({ status: "done", attempts: 2 });
      expect(detail.events.some((e) => /Retrying automatically \(attempt 2 of 2\)/.test(e.message))).toBe(true);
    });
  }

  it("a crash after the ready commit leaves a valid ready result; nothing reruns, notification intent exists once", async () => {
    const c = ctx();
    const taskId = injectTask(c.db, c.config, "k", c.clock.now);
    const w = build(c, "w1", marked("only"), { testHooks: { afterReadyCommit: () => { throw new Error("process died after commit"); } } });
    await w.worker.processNextJob();
    expect(getTaskSummary(c.db, taskId).status).toBe("ready");
    expect(manifest(c.db, taskId)).toHaveLength(2);
    expect(count(c.db, "SELECT COUNT(*) n FROM notifications")).toBe(1);
    expect(recoverExpiredJobs(c.db, new Date(T0.getTime() + 3600_000))).toBe(0);
    expect(w.engineCalls).toHaveLength(1);
    // A restarted worker has nothing to redo and delivers the intent once.
    const w2 = build(c, "w2", marked("never"));
    expect(await w2.worker.processNextJob()).toBe(false);
    expect(w2.engineCalls).toHaveLength(0);
    expect(await w2.worker.processNextNotification()).toBe(true);
    expect(await w2.worker.processNextNotification()).toBe(false);
    expect(w2.sent).toHaveLength(1);
  });
});

describe("owner loss while the engine is running", () => {
  it("an engine that honours the signal is aborted; the stale worker writes nothing", async () => {
    const c = ctx();
    const taskId = injectTask(c.db, c.config, "k", c.clock.now);
    let aborted = false;
    let emit!: EngineDependencies["onProgress"];
    const engine: Engine = async (_i, deps) => {
      emit = deps.onProgress;
      await deps.onProgress({ stage: "plan", message: "started", plan: testPlan() });
      await new Promise<void>((_, rej) => deps.signal.addEventListener("abort", () => { aborted = true; rej(new Error("aborted")); }));
      throw new Error("unreachable");
    };
    const w = build(c, "w1", engine, { heartbeatIntervalMs: 20 });
    const p = w.worker.processNextJob();
    await until(() => count(c.db, "SELECT COUNT(*) n FROM task_events WHERE task_id=? AND message='started'", taskId) === 1);
    // Another worker takes the lease.
    c.db.prepare("UPDATE jobs SET lease_owner='intruder:tok' WHERE task_id=?").run(taskId);
    await p;
    expect(aborted).toBe(true);
    expect(c.db.prepare("SELECT status, lease_owner FROM jobs WHERE task_id=?").get(taskId)).toEqual({ status: "running", lease_owner: "intruder:tok" });
    expect(getTaskSummary(c.db, taskId).status).not.toBe("failed");
    const events = count(c.db, "SELECT COUNT(*) n FROM task_events WHERE task_id=?", taskId);
    await expect(emit({ stage: "generate", message: "late progress" })).rejects.toBeInstanceOf(LeaseLostError);
    expect(count(c.db, "SELECT COUNT(*) n FROM task_events WHERE task_id=?", taskId)).toBe(events);
    expect(manifest(c.db, taskId)).toEqual([]);
  });

  it("an engine that ignores the signal cannot hold the worker or publish after losing ownership", async () => {
    const c = ctx();
    const taskId = injectTask(c.db, c.config, "k", c.clock.now);
    let finishEngine!: (r: EngineResult) => void;
    const engine: Engine = (input, deps) => new Promise<EngineResult>((resolve) => {
      void deps.onProgress({ stage: "plan", message: "started", plan: testPlan() });
      finishEngine = () => resolve(withMarker(input, "late"));
    });
    const w = build(c, "w1", engine, { heartbeatIntervalMs: 20 });
    const p = w.worker.processNextJob();
    await until(() => count(c.db, "SELECT COUNT(*) n FROM task_events WHERE task_id=? AND message='started'", taskId) === 1);
    c.db.prepare("UPDATE jobs SET lease_owner='intruder:tok' WHERE task_id=?").run(taskId);
    await p; // the worker is free even though the engine is still "running"
    finishEngine(withMarker({ taskId, revision: 1 } as EngineInput, "late"));
    await new Promise((r) => setTimeout(r, 50));
    expect(manifest(c.db, taskId)).toEqual([]);
    expect(filesOnDisk(c.config, taskId)).toEqual([]);
    expect(getTaskSummary(c.db, taskId).status).not.toBe("ready");
  });

  it("the deadline frees the worker even if the engine ignores the abort signal (backstop; the engine's own work may continue)", async () => {
    const c = ctx();
    const taskId = injectTask(c.db, c.config, "k", c.clock.now);
    const w = build(c, "w1", () => new Promise<EngineResult>(() => undefined), { jobDeadlineMs: 30 });
    await w.worker.processNextJob();
    expect(getTaskSummary(c.db, taskId).status).toBe("queued"); // retryable timeout, attempt 1 of 2
    expect(c.db.prepare("SELECT status, attempts, last_error FROM jobs WHERE task_id=?").get(taskId)).toEqual({ status: "queued", attempts: 1, last_error: "ENGINE_TIMEOUT" });
    c.clock.now = new Date(T0.getTime() + 31_000);
    await w.worker.processNextJob();
    expect(getTaskSummary(c.db, taskId)).toMatchObject({ status: "failed", error: { code: "ENGINE_TIMEOUT" } });
    expect(manifest(c.db, taskId)).toEqual([]);
  });
});

describe("shutdown", () => {
  it("stop() stops claiming, aborts the running job after the grace period and returns it without consuming an attempt", async () => {
    const c = ctx();
    const taskId = injectTask(c.db, c.config, "k", c.clock.now);
    const second = injectTask(c.db, c.config, "k2", c.clock.now);
    const engine: Engine = async (_i, deps) => {
      await deps.onProgress({ stage: "plan", message: "started", plan: testPlan() });
      await new Promise<void>((_, rej) => deps.signal.addEventListener("abort", () => rej(new Error("aborted"))));
      throw new Error("unreachable");
    };
    const w = build(c, "w1", engine);
    const p = w.worker.processNextJob();
    await until(() => count(c.db, "SELECT COUNT(*) n FROM task_events WHERE task_id=? AND message='started'", taskId) === 1);
    await w.worker.stop(50);
    await p;
    expect(await w.worker.processNextJob()).toBe(false); // a stopping worker accepts no new work
    expect(c.db.prepare("SELECT status, attempts, lease_owner FROM jobs WHERE task_id=?").get(taskId)).toEqual({ status: "queued", attempts: 0, lease_owner: null });
    expect(getTaskSummary(c.db, taskId).status).toBe("queued");
    expect(getTaskSummary(c.db, second).status).toBe("queued");
    expect(c.db.prepare("SELECT status FROM jobs WHERE task_id=?").get(second)).toEqual({ status: "queued" });
    // Another worker completes it normally, on attempt 1.
    const w2 = build(c, "w2", marked("again"));
    await w2.worker.processNextJob();
    expect(c.db.prepare("SELECT status, attempts FROM jobs WHERE task_id=?").get(taskId)).toEqual({ status: "done", attempts: 1 });
  });
});

describe("hard process death and real signals (child processes, isolated DB and artifact root)", () => {
  const childEnv = (config: AppConfig): NodeJS.ProcessEnv => ({
    PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test",
    SESSION_SECRET: "s".repeat(40), APP_PASSWORD: "correct-horse-battery", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    DATABASE_PATH: config.databasePath, ARTIFACTS_DIR: config.artifactsDir, DEMO_ENABLED: "true", PUBLIC_APP_URL: "http://localhost:3000",
  });
  function startChild(config: AppConfig, mode: string) {
    const child = spawn(process.execPath, ["--import", "tsx", `${import.meta.dirname}/support/worker-child.ts`, mode, "300"], {
      cwd: config.repoRoot, env: childEnv(config), stdio: ["ignore", "pipe", "pipe"],
    });
    let out = ""; let err = "";
    child.stdout!.on("data", (d: Buffer) => { out += d; });
    child.stderr!.on("data", (d: Buffer) => { err += d; });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
    return { child, exited, out: () => out, err: () => err };
  }
  const killIfAlive = (child: ChildProcess) => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };

  it("SIGKILL during generation: lease stays valid, nobody steals it; after expiry another worker completes once", async () => {
    const c = ctx();
    const taskId = injectTask(c.db, c.config, "k", new Date());
    const h = startChild(c.config, "block");
    try {
      await until(() => count(c.db, "SELECT COUNT(*) n FROM task_events WHERE task_id=? AND message='child: engine started'", taskId) === 1, 30_000);
      const owner = (c.db.prepare("SELECT lease_owner FROM jobs WHERE task_id=?").get(taskId) as { lease_owner: string }).lease_owner;
      expect(owner).toMatch(/^child-\d+:/);
      h.child.kill("SIGKILL");
      expect((await h.exited).signal).toBe("SIGKILL");

      // Unexpired lease: not reclaimed.
      expect(recoverExpiredJobs(c.db, new Date())).toBe(0);
      const rival = build(c, "rival", marked("rival"));
      c.clock.now = new Date();
      expect(await rival.worker.processNextJob()).toBe(false);
      expect(c.db.prepare("SELECT status, lease_owner, attempts FROM jobs WHERE task_id=?").get(taskId)).toEqual({ status: "running", lease_owner: owner, attempts: 1 });

      // After the 90 s lease the job is recovered and completes on attempt 2.
      c.clock.now = new Date(Date.now() + 95_000);
      expect(recoverExpiredJobs(c.db, c.clock.now)).toBe(1);
      expect(await rival.worker.processNextJob()).toBe(true);
      expect(getTaskSummary(c.db, taskId).status).toBe("ready");
      expect(c.db.prepare("SELECT status, attempts FROM jobs WHERE task_id=?").get(taskId)).toEqual({ status: "done", attempts: 2 });
      expect(manifest(c.db, taskId)).toHaveLength(2);
      expect(count(c.db, "SELECT COUNT(*) n FROM notifications")).toBe(1);
    } finally { killIfAlive(h.child); }
  }, 60_000);

  it("SIGKILL after files were promoted but before the DB commit: orphans stay unreferenced and unchanged; the retry wins", async () => {
    const c = ctx();
    const taskId = injectTask(c.db, c.config, "k", new Date());
    const h = startChild(c.config, "freeze-after-promote");
    try {
      await until(() => filesOnDisk(c.config, taskId).length === 2, 30_000);
      h.child.kill("SIGKILL");
      await h.exited;
      const orphanNames = filesOnDisk(c.config, taskId);
      const orphanHashes = orphanNames.map((n) => sha(readFileSync(path.join(c.config.artifactsDir, taskId, "r1", n))));
      expect(manifest(c.db, taskId)).toEqual([]);
      expect(getTaskSummary(c.db, taskId).status).toBe("running"); // never ready

      c.clock.now = new Date(Date.now() + 95_000);
      expect(recoverExpiredJobs(c.db, c.clock.now)).toBe(1);
      const retry = build(c, "retry", marked("retry-attempt"));
      expect(await retry.worker.processNextJob()).toBe(true);
      const m = manifest(c.db, taskId);
      expect(m).toHaveLength(2);
      for (const row of m) {
        expect(orphanNames.includes(path.basename(row.rel_path))).toBe(false); // the manifest never adopts a dead attempt's file
        expect(sha(readFileSync(path.join(c.config.artifactsDir, row.rel_path)))).toBe(row.sha256);
      }
      orphanNames.forEach((n, i) => expect(sha(readFileSync(path.join(c.config.artifactsDir, taskId, "r1", n)))).toBe(orphanHashes[i]));
      expect(filesOnDisk(c.config, taskId)).toHaveLength(4);
    } finally { killIfAlive(h.child); }
  }, 60_000);

  it("SIGTERM: the real handler stops claiming, aborts after the grace period, releases the job (attempt not consumed), exits 0", async () => {
    const c = ctx();
    const taskId = injectTask(c.db, c.config, "k", new Date());
    const h = startChild(c.config, "block");
    try {
      await until(() => count(c.db, "SELECT COUNT(*) n FROM task_events WHERE task_id=? AND message='child: engine started'", taskId) === 1, 30_000);
      h.child.kill("SIGTERM");
      const r = await h.exited;
      expect(r).toEqual({ code: 0, signal: null });
      expect(h.out()).toMatch(/job\.released_on_shutdown/);
      const db2 = openDb(c.config.databasePath);
      expect(db2.prepare("SELECT status, attempts, lease_owner FROM jobs WHERE task_id=?").get(taskId)).toEqual({ status: "queued", attempts: 0, lease_owner: null });
      expect(getTaskDetail(db2, taskId).events.some((e) => /returned to the queue/.test(e.message))).toBe(true);
      db2.close();
      // The next worker completes it as attempt 1.
      const w = build(c, "next", marked("after-sigterm"));
      c.clock.now = new Date();
      await w.worker.processNextJob();
      expect(c.db.prepare("SELECT status, attempts FROM jobs WHERE task_id=?").get(taskId)).toEqual({ status: "done", attempts: 1 });
    } finally { killIfAlive(h.child); }
  }, 60_000);
});

describe("work finishes during quiet hours; only the notification waits (controlled clock, fake provider)", () => {
  const quiet = { enabled: true, start: "22:00", end: "08:00", timezone: "America/Los_Angeles" };

  it("23:30 America/Los_Angeles: ready immediately, notification scheduled 2026-10-24T15:00:00Z, delivered once after a restart", async () => {
    const c = ctx();
    c.clock.now = new Date("2026-10-24T06:30:00Z");
    patchSettings(c.db, { notifications: { quietHours: quiet, digestTime: "08:00" } }, c.clock.now);
    const a = injectTask(c.db, c.config, "a", c.clock.now);
    const b = injectTask(c.db, c.config, "b", c.clock.now);
    const w = build(c, "w1", marked("quiet"));
    await w.worker.processNextJob();
    c.clock.now = new Date("2026-10-24T09:10:00Z"); // 02:10 local
    await w.worker.processNextJob();
    expect(getTaskSummary(c.db, a).status).toBe("ready");
    expect(getTaskSummary(c.db, b).status).toBe("ready");
    expect(manifest(c.db, a)).toHaveLength(2);
    const rows = c.db.prepare("SELECT kind, state, scheduled_for, local_date FROM notifications").all();
    expect(rows).toEqual([{ kind: "digest", state: "queued", scheduled_for: "2026-10-24T15:00:00.000Z", local_date: "2026-10-24" }]);
    expect(await w.worker.processNextNotification()).toBe(false);
    expect(w.sent).toHaveLength(0);

    // Restart: new process state, same database file. Nothing is delivered early.
    c.db.close();
    const db2 = bootstrapDb(c.config);
    const c2: Ctx = { db: db2, config: c.config, clock: { now: new Date("2026-10-24T14:59:00Z") } };
    const w2 = build(c2, "w2", marked("never"));
    expect(await w2.worker.processNextNotification()).toBe(false);
    c2.clock.now = new Date("2026-10-24T15:00:00Z");
    expect(await w2.worker.processNextNotification()).toBe(true);
    expect(w2.sent).toHaveLength(1);
    expect(w2.sent[0]!.tasks.map((t) => t.id).sort()).toEqual([a, b].sort());
    expect(await w2.worker.processNextNotification()).toBe(false);
    expect(w2.engineCalls).toHaveLength(0);
    expect(db2.prepare("SELECT state FROM notifications").get()).toEqual({ state: "simulated" });
  });
});

describe("notification failures never touch generation (fake provider)", () => {
  const snapshot = (db: Db) => ({
    tasks: db.prepare("SELECT id, status, revision FROM tasks ORDER BY id").all(),
    jobs: db.prepare("SELECT task_id, revision, status, attempts FROM jobs ORDER BY task_id").all(),
    artifacts: db.prepare("SELECT id, sha256 FROM artifacts ORDER BY id").all(),
  });
  const LIVE = {
    NOTIFICATION_CHANNEL: "whatsapp", TWILIO_ACCOUNT_SID: "AC-test", TWILIO_AUTH_TOKEN: "tok-test",
    TWILIO_WHATSAPP_FROM: "whatsapp:+15550000000", TWILIO_WHATSAPP_TO: "+15551234567", WHATSAPP_USE_CASE_ELIGIBLE: "true",
    TWILIO_CONTENT_SID: "HX-template",
  };

  it("transient failures retry with backoff, then stop; engine called once; ready files stay downloadable", async () => {
    const c = ctx(makeTestConfig(LIVE));
    patchSettings(c.db, { notifications: { channel: "whatsapp" } }, T0);
    const taskId = injectTask(c.db, c.config, "k", c.clock.now);
    const w = build(c, "w1", marked("n"), { send: async () => { throw Object.assign(new Error("rate limited"), { code: "RATE_LIMITED", retryable: true }); } });
    await w.worker.processNextJob();
    const before = snapshot(c.db);
    for (let i = 0; i < 6; i++) {
      await w.worker.processNextNotification();
      c.clock.now = new Date(c.clock.now.getTime() + 200_000);
    }
    expect(w.sent).toHaveLength(3); // NOTIFY_MAX_ATTEMPTS, then terminal
    expect(c.db.prepare("SELECT state, attempts FROM notifications").get()).toEqual({ state: "failed", attempts: 3 });
    expect(snapshot(c.db)).toEqual(before);
    expect(w.engineCalls).toHaveLength(1);
    expect(getTaskSummary(c.db, taskId).status).toBe("ready");
    expect(getTaskDetail(c.db, taskId).artifacts).toHaveLength(2);
  });

  it("a provider timeout (DELIVERY_UNCERTAIN) is submitted once and never retried", async () => {
    const c = ctx(makeTestConfig(LIVE));
    patchSettings(c.db, { notifications: { channel: "whatsapp" } }, T0);
    injectTask(c.db, c.config, "k", c.clock.now);
    const w = build(c, "w1", marked("n"), { send: async () => { throw Object.assign(new Error("timed out after the request was sent"), { code: "DELIVERY_UNCERTAIN", retryable: false }); } });
    await w.worker.processNextJob();
    const before = snapshot(c.db);
    await w.worker.processNextNotification();
    c.clock.now = new Date(c.clock.now.getTime() + 3600_000);
    expect(await w.worker.processNextNotification()).toBe(false);
    expect(w.sent).toHaveLength(1);
    expect(c.db.prepare("SELECT state, last_error FROM notifications").get()).toMatchObject({ state: "failed", last_error: expect.stringMatching(/^DELIVERY_UNCERTAIN/) });
    expect(snapshot(c.db)).toEqual(before);
  });

  it("worker dies after the submission marker, before the provider answers: the provider is not called again", async () => {
    const c = ctx(makeTestConfig(LIVE));
    patchSettings(c.db, { notifications: { channel: "whatsapp" } }, T0);
    const taskId = injectTask(c.db, c.config, "k", c.clock.now);
    const w1 = build(c, "w1", marked("n"));
    await w1.worker.processNextJob();
    const before = snapshot(c.db);
    const gate = frozen();
    const dying = build(c, "dying", marked("x"), { testHooks: { afterSubmitStarted: gate.hook } });
    const p = dying.worker.processNextNotification();
    await until(() => gate.reached);
    expect(c.db.prepare("SELECT submit_started_at IS NOT NULL AS s FROM notifications").get()).toEqual({ s: 1 });
    expect(dying.sent).toHaveLength(0); // the process "died" before the provider call
    c.clock.now = new Date(T0.getTime() + 120_000);
    const survivor = build(c, "survivor", marked("y"));
    // The survivor's loop recovers expired notification leases; it must not resubmit.
    expect(await survivor.worker.processNextNotification()).toBe(false);
    expect(recoverNotificationLeases(c.db, c.clock.now)).toBe(1);
    expect(await survivor.worker.processNextNotification()).toBe(false);
    expect(survivor.sent).toHaveLength(0);
    expect(c.db.prepare("SELECT state, last_error FROM notifications").get()).toMatchObject({ state: "failed", last_error: expect.stringMatching(/^DELIVERY_UNCERTAIN/) });
    expect(snapshot(c.db)).toEqual(before);
    expect(getTaskSummary(c.db, taskId).status).toBe("ready");
    gate.release();
    await p.catch(() => undefined);
  });

  it("a recipient edited after queueing blocks the stale live message with POLICY_CHANGED; the provider is never called", async () => {
    const c = ctx(makeTestConfig(LIVE));
    patchSettings(c.db, { notifications: { channel: "whatsapp", recipient: "+15551234567" } }, T0);
    const taskId = injectTask(c.db, c.config, "k", c.clock.now);
    const w = build(c, "w1", marked("n"));
    await w.worker.processNextJob();
    patchSettings(c.db, { notifications: { recipient: "+15559999999" } }, T0);
    expect(await w.worker.processNextNotification()).toBe(true);
    expect(w.sent).toHaveLength(0);
    expect(c.db.prepare("SELECT state, last_error FROM notifications").get()).toMatchObject({ state: "blocked", last_error: expect.stringMatching(/^POLICY_CHANGED/) });
    expect(getTaskSummary(c.db, taskId).status).toBe("ready");
    expect(getTaskDetail(c.db, taskId).artifacts).toHaveLength(2);
    expect(JSON.stringify(getTaskDetail(c.db, taskId).notifications)).not.toContain("+1555");
  });
});
