// The one-shot control used for bounded live checks: it must run one job at most, and must not change the normal retry policy.
import { describe, expect, it } from "vitest";
import type { EngineDependencies, EngineInput, EngineResult } from "@afterhours/contracts";
import { getTaskSummary } from "@afterhours/data";
import { injectTask, makeTestConfig, makeTestDb, readyResult } from "@afterhours/data/testing";
import { runOnce } from "../src/once";
import { createWorker } from "../src/worker";

type Engine = (i: EngineInput, d: EngineDependencies) => Promise<EngineResult>;

function make(engine: Engine, clock: { now: Date }) {
  const { db, config } = makeTestDb(makeTestConfig());
  const calls: EngineInput[] = [];
  const sends: unknown[] = [];
  const worker = createWorker({
    db, config, workerId: "w-once", log: () => undefined, now: () => clock.now,
    runWork: async (i, d) => { calls.push(i); return engine(i, d); },
    sendNotification: async (i) => { sends.push(i); return { state: "simulated", message: "m", providerMessageId: null, reason: null }; },
  });
  return { db, config, worker, calls, sends };
}
const retryable: Engine = async () => { throw Object.assign(new Error("provider overloaded"), { code: "MODEL_PROVIDER", retryable: true }); };

describe("worker:once control", () => {
  it("runs a retryable failure exactly once and leaves the retry queued instead of executing it", async () => {
    const clock = { now: new Date("2026-10-20T17:00:00Z") };
    const m = make(retryable, clock);
    const taskId = injectTask(m.db, m.config, "once-1", new Date(clock.now.getTime() - 5000));
    expect(await runOnce(m.worker)).toEqual({ job: true, notification: false });
    expect(m.calls).toHaveLength(1);
    expect(getTaskSummary(m.db, taskId).status).toBe("queued");
    const job = m.db.prepare("SELECT status, attempts FROM jobs WHERE task_id=?").get(taskId) as { status: string; attempts: number };
    expect(job).toEqual({ status: "queued", attempts: 1 });
    // The control is a process-level limit: with nothing else running, no further attempt happens.
    expect(m.calls).toHaveLength(1);
  });

  it("does not change the default policy: the ordinary worker takes the queued retry once its delay has passed", async () => {
    const clock = { now: new Date("2026-10-20T17:00:00Z") };
    const m = make(retryable, clock);
    const taskId = injectTask(m.db, m.config, "once-2", new Date(clock.now.getTime() - 5000));
    await runOnce(m.worker);
    clock.now = new Date(clock.now.getTime() + 10 * 60_000);
    expect(await m.worker.processNextJob()).toBe(true);
    expect(m.calls).toHaveLength(2);
    expect(getTaskSummary(m.db, taskId).status).toBe("failed");
  });

  it("with no queued job it claims nothing and sends nothing", async () => {
    const m = make(async (i) => readyResult(i), { now: new Date("2026-10-20T17:00:00Z") });
    expect(await runOnce(m.worker)).toEqual({ job: false, notification: false });
    expect(m.calls).toHaveLength(0);
    expect(m.sends).toHaveLength(0);
  });

  it("a successful job is committed through the real lease and its simulated notification is delivered once", async () => {
    const clock = { now: new Date() };
    const m = make(async (i) => readyResult(i), clock);
    const taskId = injectTask(m.db, m.config, "once-3", new Date(Date.now() - 5000));
    expect(await runOnce(m.worker)).toEqual({ job: true, notification: true });
    expect(getTaskSummary(m.db, taskId).status).toBe("ready");
    expect(m.calls).toHaveLength(1);
    expect(m.sends).toHaveLength(1);
  });
});
