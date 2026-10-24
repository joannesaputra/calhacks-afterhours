import { describe, expect, it } from "vitest";
import type { DeliveryInput, EngineDependencies, EngineInput, EngineResult } from "@afterhours/contracts";
import { getTaskDetail, getTaskSummary, injectDemo, loadDemoFixture, openDb, recoverExpiredJobs, type AppConfig, type Db } from "@afterhours/data";
import { injectTask, makeTestConfig, makeTestDb, readyResult, testPlan, testSources } from "@afterhours/data/testing";
import { runWork } from "@afterhours/engine";
import { sendNotification as stubSend } from "@afterhours/delivery";
import { createWorker, type WorkerDeps } from "../src/worker";

const silent = () => undefined;
type Engine = (i: EngineInput, d: EngineDependencies) => Promise<EngineResult>;

function make(engine: Engine, extra: Partial<WorkerDeps> & { config?: AppConfig } = {}) {
  const { db, config } = makeTestDb(extra.config ?? makeTestConfig());
  const sent: DeliveryInput[] = [];
  const worker = createWorker({
    db, config, workerId: "w-test", runWork: engine, log: silent,
    sendNotification: async (i) => { sent.push(i); return stubSend(i); },
    ...extra,
  });
  return { db, config, worker, sent };
}

const happy: Engine = async (input, deps) => {
  await deps.onProgress({ stage: "plan", message: "Planning", plan: testPlan() });
  await deps.onProgress({ stage: "generate", message: "Writing proposal" });
  await deps.onProgress({ stage: "export", message: "Exporting files" });
  return readyResult(input);
};

describe("worker job execution", () => {
  it("runs a demo task end to end: progress, real files, ready, one simulated outbox notification", async () => {
    const { db, config, worker, sent } = make(happy);
    const taskId = injectTask(db, config, "k", new Date());
    expect(await worker.processNextJob()).toBe(true);
    const d = getTaskDetail(db, taskId);
    expect(d.task.status).toBe("ready");
    expect(d.artifacts).toHaveLength(2);
    expect(d.events.map((e) => e.message)).toEqual(expect.arrayContaining(["Planning", "Writing proposal", "Exporting files"]));
    expect(await worker.processNextNotification()).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.tasks[0]).toMatchObject({ id: taskId, artifactCount: 2 });
    expect(sent[0]!.deliveryPolicy).toEqual({ eligible: false, customerServiceWindowOpen: false, approvedContentSid: null });
    const n = getTaskDetail(db, taskId).notifications[0]!;
    expect(n.state).toBe("simulated");
    expect(await worker.processNextNotification()).toBe(false); // no resend
  });

  it("hands the engine the fixture's original receivedAt, not the injection or run time", async () => {
    let seen: EngineInput | undefined;
    const { db, config, worker } = make(async (input, deps) => { seen = input; return happy(input, deps); });
    const fixtureReceivedAt = loadDemoFixture(config.repoRoot, "proposal").fixture.email.receivedAt;
    const injectedAt = new Date(Date.now() - 5000);
    const out = injectDemo(db, config, "proposal", "date-1", injectedAt);
    expect(out.kind).toBe("task");
    expect(await worker.processNextJob()).toBe(true);
    expect(seen?.email.receivedAt).toBe(fixtureReceivedAt);
    expect(seen?.email.receivedAt).not.toBe(injectedAt.toISOString());
    expect(seen?.now).not.toBe(fixtureReceivedAt);
  });

  it("passes the immutable snapshot (attachments, org, scenario, mode) to the engine", async () => {
    let seen: EngineInput | null = null;
    const { db, config, worker } = make(async (i) => { seen = i; return { outcome: "skipped", reason: "No request.", sources: [] }; });
    injectTask(db, config, "k", new Date(), "report");
    await worker.processNextJob();
    expect(seen!.fixtureScenario).toBe("report");
    expect(seen!.mode).toBe("fixture");
    expect(seen!.attachments[0]!.filename).toBe("sales.csv");
    expect(seen!.attachments[0]!.bytes).toBeInstanceOf(Uint8Array);
    expect(seen!.organization.timezone).toBe("America/Los_Angeles");
  });

  it("runs the real fixture engine through the worker and publishes both Office files", async () => {
    const { db, config, worker } = make(runWork);
    const taskId = injectTask(db, config, "k", new Date());
    await worker.processNextJob();
    expect(getTaskSummary(db, taskId)).toMatchObject({ status: "ready", artifactCount: 2, error: null });
    const detail = getTaskDetail(db, taskId);
    expect(detail.artifacts.map((artifact) => artifact.format).sort()).toEqual(["docx", "pptx"]);
    expect(detail.products.find((product) => product.kind === "presentation")?.slides).toHaveLength(5);
    expect(detail.plan?.dueAt).toBe("2026-10-26T16:00:00.000Z");
  }, 20_000);

  it("retries a transient provider error once, then reports an actionable failure", async () => {
    let calls = 0;
    const flaky: Engine = async () => { calls++; throw Object.assign(new Error("Provider returned 503."), { code: "PROVIDER_UNAVAILABLE", retryable: true }); };
    let clock = new Date("2026-03-02T20:00:00Z");
    const { db, config, worker } = make(flaky, { now: () => clock });
    const taskId = injectTask(db, config, "k", clock);
    await worker.processNextJob();
    expect(getTaskSummary(db, taskId).status).toBe("queued");
    expect(await worker.processNextJob()).toBe(false); // waits ~30 s
    clock = new Date(clock.getTime() + 31_000);
    await worker.processNextJob();
    expect(calls).toBe(2);
    expect(getTaskSummary(db, taskId)).toMatchObject({ status: "failed", error: { code: "PROVIDER_UNAVAILABLE", retryable: true } });
  });

  it("fails live mode without credentials with a typed configuration error, without calling the engine", async () => {
    let called = false;
    const config = makeTestConfig({ GENERATION_MODE: "live", MODEL_PROVIDER: "anthropic" });
    const { db, worker } = make(async () => { called = true; throw new Error("x"); }, { config });
    const taskId = injectTask(db, config, "k", new Date());
    await worker.processNextJob();
    expect(called).toBe(false);
    expect(getTaskSummary(db, taskId)).toMatchObject({ status: "failed", generationMode: "live", error: { code: "MODEL_NOT_CONFIGURED", retryable: false } });
  });

  it("rejects malformed engine output and invalid files instead of publishing broken downloads", async () => {
    const bad: Engine = async (input) => {
      const r = readyResult(input);
      r.files[0] = { ...r.files[0]!, bytes: new TextEncoder().encode("<html>not a docx</html>".repeat(10)) };
      return r;
    };
    const { db, config, worker } = make(bad);
    const t1 = injectTask(db, config, "a", new Date());
    await worker.processNextJob();
    expect(getTaskSummary(db, t1)).toMatchObject({ status: "failed", error: { code: "ARTIFACT_INVALID" } });

    const wrongRef: Engine = async (input) => {
      const r = readyResult(input);
      r.products[0]!.blocks[0]!.evidence = [{ sourceId: "invented", locator: "p. 7", quote: "fake" }];
      return r;
    };
    const w2 = make(wrongRef);
    const t2 = injectTask(w2.db, w2.config, "b", new Date());
    await w2.worker.processNextJob();
    expect(getTaskSummary(w2.db, t2)).toMatchObject({ status: "failed", error: { code: "ENGINE_INVALID_RESULT" } });
    expect(getTaskDetail(w2.db, t2).artifacts).toHaveLength(0);
  });

  it("enforces the hard deadline with an abort signal", async () => {
    const slow: Engine = (_i, d) => new Promise((_, reject) => d.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const { db, config, worker } = make(slow, { jobDeadlineMs: 50 });
    const taskId = injectTask(db, config, "k", new Date());
    await worker.processNextJob();
    const s = getTaskSummary(db, taskId);
    expect(s.status).toBe("queued"); // first timeout is retryable within the same revision
    expect(getTaskDetail(db, taskId).events.some((e) => /exceeded/.test(e.message))).toBe(true);
  });

  it("restart: a killed worker's job is recovered after lease expiry and completes once", async () => {
    let clock = new Date("2026-03-02T20:00:00Z");
    const config = makeTestConfig();
    // Worker A claims and "dies" mid-job (engine never resolves; we abandon it).
    const a = make(() => new Promise<never>(() => undefined), { config, now: () => clock, heartbeatIntervalMs: 3_600_000 });
    const taskId = injectTask(a.db, config, "k", clock);
    void a.worker.processNextJob();
    await new Promise((r) => setTimeout(r, 20));
    expect(getTaskSummary(a.db, taskId).status).toBe("planning");

    // Worker B starts on the same DB file after the lease expires.
    const dbB: Db = openDb(config.databasePath);
    clock = new Date(clock.getTime() + 120_000);
    expect(recoverExpiredJobs(dbB, clock)).toBe(1);
    const b = createWorker({ db: dbB, config, workerId: "w-b", runWork: happy, sendNotification: stubSend, log: silent, now: () => clock });
    await b.processNextJob();
    expect(getTaskSummary(dbB, taskId).status).toBe("ready");
    expect((dbB.prepare("SELECT COUNT(*) n FROM artifacts WHERE task_id=?").get(taskId) as { n: number }).n).toBe(2);
    expect((dbB.prepare("SELECT COUNT(*) n FROM notifications").get() as { n: number }).n).toBe(1);
  });

  it("graceful shutdown returns an in-flight job to the queue without consuming an attempt", async () => {
    const hang: Engine = (_i, d) => new Promise((_, reject) => d.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const { db, config, worker } = make(hang);
    const taskId = injectTask(db, config, "k", new Date());
    const p = worker.processNextJob();
    await new Promise((r) => setTimeout(r, 20));
    await worker.stop(10);
    await p;
    expect(getTaskSummary(db, taskId).status).toBe("queued");
    expect(db.prepare("SELECT attempts, status FROM jobs").get()).toEqual({ attempts: 0, status: "queued" });
  });

  it("needs_input then answers produces a new revision that completes", async () => {
    let rev = 0;
    const engine: Engine = async (input) => {
      rev = input.revision;
      if (input.answers.length === 0) {
        return { outcome: "needs_input", plan: testPlan(), sources: testSources(), questions: [{ id: "scope", question: "What scope?", reason: "Missing", required: true }], warnings: [] };
      }
      return readyResult(input);
    };
    const { db, config, worker } = make(engine);
    const { submitAnswers } = await import("@afterhours/data");
    const taskId = injectTask(db, config, "k", new Date(), "ambiguous");
    await worker.processNextJob();
    expect(getTaskSummary(db, taskId).status).toBe("needs_input");
    submitAnswers(db, taskId, 1, [{ questionId: "scope", answer: "Five-page website" }], new Date());
    await worker.processNextJob();
    expect(rev).toBe(2);
    const d = getTaskDetail(db, taskId);
    expect(d.task).toMatchObject({ status: "ready", revision: 2 });
    expect(d.artifacts.every((a) => a.revision === 2)).toBe(true);
  });

  it("records delivery errors: blocked is final, DELIVERY_UNCERTAIN is never retried", async () => {
    const { db, config, worker } = make(happy, {
      sendNotification: async () => { throw Object.assign(new Error("timed out after submit"), { code: "DELIVERY_UNCERTAIN", retryable: true }); },
    });
    const taskId = injectTask(db, config, "k", new Date());
    await worker.processNextJob();
    await worker.processNextNotification();
    const n = getTaskDetail(db, taskId).notifications[0]!;
    expect(n.state).toBe("failed");
    expect(n.lastError).toMatch(/DELIVERY_UNCERTAIN/);
  });
});
