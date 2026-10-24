// FAKE ENGINE: these tests prove the platform path for all four scenarios. They do NOT prove that the real
// engine produces correct documents, calculations, questions or skip decisions (that is Joanne's engine).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DeliveryInput, EngineDependencies, EngineInput, EngineResult } from "@afterhours/contracts";
import { getTaskDetail, injectDemo, LIMITS, submitAnswers, type AppConfig } from "@afterhours/data";
import { makeTestConfig, makeTestDb, readyResult, testPlan, testSources } from "@afterhours/data/testing";
import { sendNotification as stubSend } from "@afterhours/delivery";
import { createWorker } from "../src/worker";

const silent = () => undefined;
type Scenario = "proposal" | "report" | "ambiguous" | "no_action";

function make(extra: { config?: AppConfig; engine?: (i: EngineInput, d: EngineDependencies) => Promise<EngineResult> } = {}) {
  const { db, config } = makeTestDb(extra.config ?? makeTestConfig());
  const inputs: EngineInput[] = [];
  const sent: DeliveryInput[] = [];
  const routed = async (input: EngineInput, deps: EngineDependencies): Promise<EngineResult> => {
    inputs.push(input);
    if (extra.engine) return extra.engine(input, deps);
    await deps.onProgress({ stage: "plan", message: "Planning", plan: testPlan() });
    switch (input.fixtureScenario) {
      case "proposal":
      case "report":
        await deps.onProgress({ stage: "generate", message: "Generating" });
        await deps.onProgress({ stage: "export", message: "Exporting" });
        return readyResult(input);
      case "ambiguous":
        if (input.answers.length > 0) return readyResult(input);
        return {
          outcome: "needs_input", plan: testPlan(), sources: testSources(), warnings: [],
          questions: [{ id: "scope", question: "What is the scope?", reason: "The email has no scope.", required: true }],
        };
      default:
        return { outcome: "skipped", reason: "No actionable request.", sources: testSources() };
    }
  };
  const worker = createWorker({
    db, config, workerId: "w-b3", runWork: routed, log: silent,
    sendNotification: async (i) => { sent.push(i); return stubSend(i); },
  });
  return { db, config, worker, inputs, sent };
}

const count = (db: ReturnType<typeof make>["db"], sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;

describe("all four fixture scenarios use the same injection service and worker path (fake engine)", () => {
  it("produce the right outcome, artifact count, and notification count; real fixture bytes reach the engine", async () => {
    const { db, config, worker, inputs } = make();
    const ids = {} as Record<Scenario, string>;
    for (const s of ["proposal", "report", "ambiguous", "no_action"] as const) {
      const out = injectDemo(db, config, s, `b3-${s}`, new Date());
      if (out.kind !== "task") throw new Error("expected task");
      ids[s] = out.taskId;
    }
    while (await worker.processNextJob()) { /* drain */ }
    while (await worker.processNextNotification()) { /* drain */ }

    const d = Object.fromEntries((Object.keys(ids) as Scenario[]).map((s) => [s, getTaskDetail(db, ids[s])])) as Record<Scenario, ReturnType<typeof getTaskDetail>>;
    expect(d.proposal.task.status).toBe("ready");
    expect(d.report.task.status).toBe("ready");
    expect(d.ambiguous.task.status).toBe("needs_input");
    expect(d.no_action.task.status).toBe("skipped");
    expect([d.proposal, d.report].map((x) => x.artifacts.length)).toEqual([2, 2]);
    expect([d.ambiguous, d.no_action].map((x) => x.artifacts.length)).toEqual([0, 0]);
    for (const s of ["proposal", "report"] as const) {
      expect(d[s].notifications).toHaveLength(1);
      expect(d[s].notifications[0]).toMatchObject({ channel: "outbox", state: "simulated" });
    }
    for (const s of ["ambiguous", "no_action"] as const) expect(d[s].notifications).toHaveLength(0);
    expect(count(db, "SELECT COUNT(*) n FROM notifications")).toBe(2);

    // needs_input persists plan, sources and questions without any output file.
    expect(d.ambiguous.questions.map((q) => q.id)).toEqual(["scope"]);
    expect(d.ambiguous.plan).not.toBeNull();
    expect(d.ambiguous.sources.length).toBeGreaterThan(0);
    expect(d.no_action.sources.length).toBeGreaterThan(0);

    // The engine received the actual fixture attachment bytes and the scenario tag, via the snapshot.
    const report = inputs.find((i) => i.fixtureScenario === "report")!;
    const csv = report.attachments.find((a) => a.filename === "sales.csv")!;
    expect(Buffer.from(csv.bytes).equals(readFileSync(path.join(config.repoRoot, "fixtures", "attachments", "sales.csv")))).toBe(true);
    const brief = inputs.find((i) => i.fixtureScenario === "proposal")!.attachments.find((a) => a.filename === "maple-and-moss-brief.md")!;
    expect(Buffer.from(brief.bytes).equals(readFileSync(path.join(config.repoRoot, "fixtures", "attachments", "maple-and-moss-brief.md")))).toBe(true);
    expect(new Set(inputs.map((i) => i.mode))).toEqual(new Set(["fixture"]));
  });

  it("ambiguous: validated answers resume the same task as revision 2 with the answers in the engine input", async () => {
    const { db, config, worker, inputs } = make();
    const out = injectDemo(db, config, "ambiguous", "b3-resume", new Date());
    if (out.kind !== "task") throw new Error("expected task");
    await worker.processNextJob();
    submitAnswers(db, out.taskId, 1, [{ questionId: "scope", answer: "A five-page brand site" }], new Date());
    await worker.processNextJob();
    const d = getTaskDetail(db, out.taskId);
    expect(d.task).toMatchObject({ status: "ready", revision: 2 });
    expect(inputs.map((i) => [i.revision, i.answers.length])).toEqual([[1, 0], [2, 1]]);
    expect(inputs[1]!.answers).toEqual([{ questionId: "scope", answer: "A five-page brand site" }]);
    expect(d.artifacts.every((a) => a.revision === 2)).toBe(true);
    expect(d.notifications.map((n) => n.revision)).toEqual([2]);
  });
});

describe("bounded failures stay visible (no fake ready work)", () => {
  it("an attachment dropped at intake makes the task fail non-retryably before the engine is called", async () => {
    const { db, config, worker, inputs } = make();
    const { ingestMessage } = await import("@afterhours/data");
    const detail = (() => {
      const o = injectDemo(db, config, "proposal", "base", new Date());
      if (o.kind !== "task") throw new Error("expected task");
      return getTaskDetail(db, o.taskId);
    })();
    await worker.processNextJob(); // finish the baseline task so it does not interfere
    inputs.length = 0;
    const out = ingestMessage(db, {
      sourceKey: "demo:proposal:big", mode: "demo", integrationId: null, generationMode: "fixture", fixtureScenario: "proposal",
      envelope: { ...detail.email, providerMessageId: "demo:proposal:big", attachments: [{ id: "huge", filename: "huge.csv", mimeType: "text/csv", sizeBytes: LIMITS.maxFileBytes + 1 }] },
      attachments: [{ id: "huge", filename: "huge.csv", mimeType: "text/csv", bytes: new Uint8Array(LIMITS.maxFileBytes + 1) }],
    }, new Date());
    if (out.kind !== "task") throw new Error("expected task");
    await worker.processNextJob();
    const d = getTaskDetail(db, out.taskId);
    expect(d.task.status).toBe("failed");
    expect(d.task.error).toMatchObject({ code: "ATTACHMENT_UNAVAILABLE", retryable: false });
    expect(d.task.error!.message).toMatch(/huge\.csv/);
    expect(d.artifacts).toHaveLength(0);
    expect(inputs).toHaveLength(0);
    expect(d.events.some((e) => e.type === "warning" && /huge\.csv.*larger than 10 MB/.test(e.message))).toBe(true);
    expect(count(db, "SELECT COUNT(*) n FROM notifications WHERE task_id=?", out.taskId)).toBe(0);
  });

  it("a failing notification never reruns generation and never removes the ready files", async () => {
    let engineCalls = 0;
    const { db, config } = make();
    const worker = createWorker({
      db, config, workerId: "w-n", log: silent,
      runWork: async (input) => { engineCalls++; return readyResult(input); },
      sendNotification: async () => { throw Object.assign(new Error("provider down"), { code: "PROVIDER_DOWN", retryable: true }); },
    });
    const out = injectDemo(db, config, "proposal", "b3-notif", new Date());
    if (out.kind !== "task") throw new Error("expected task");
    await worker.processNextJob();
    for (let i = 0; i < 4; i++) await worker.processNextNotification();
    expect(engineCalls).toBe(1);
    expect(count(db, "SELECT COUNT(*) n FROM jobs WHERE task_id=?", out.taskId)).toBe(1);
    const d = getTaskDetail(db, out.taskId);
    expect(d.task.status).toBe("ready");
    expect(d.artifacts).toHaveLength(2);
  });
});
