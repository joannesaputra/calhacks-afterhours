import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { TaskStatus } from "@afterhours/contracts";
import {
  appendProgress, claimNextJob, commitEngineResult, markReviewed, publishArtifactFiles, recordExecutionFailure,
  type AppConfig, type Db,
} from "@afterhours/data";
import { injectTask, makeTestConfig, makeTestDb, readyResult, runToReady, testPlan, testSources } from "@afterhours/data/testing";
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
  return { app, db, config, cookie, h: { cookie, origin: ORIGIN } };
}

const T = (s: number) => new Date(Date.UTC(2026, 2, 1, 10, 0, s));
const QUESTIONS = [
  { id: "q1", question: "What is the scope?", reason: "No scope in the email", required: true },
  { id: "q2", question: "Preferred start date?", reason: "Optional", required: false },
];

/** Drive a task into each status through the real data functions (no direct status writes). */
function makeInStatus(db: Db, config: AppConfig, status: TaskStatus, n: number): string {
  // The queued task is injected far in the future so claimNextJob() for other tasks can never pick its job.
  const now = status === "queued" ? T(5_000_000) : T(n * 10);
  if (status === "ready") return runToReady(db, config, `m-${status}-${n}`, now).taskId;
  if (status === "approved" || status === "dismissed") {
    const { taskId } = runToReady(db, config, `m-${status}-${n}`, now);
    markReviewed(db, taskId, 1, status === "approved" ? "approve" : "dismiss", T(n * 10 + 5));
    return taskId;
  }
  const scenario = status === "needs_input" ? "ambiguous" : status === "skipped" ? "no_action" : "proposal";
  const id = injectTask(db, config, `m-${status}-${n}`, now, scenario);
  if (status === "queued") return id;
  const c = claimNextJob(db, "w", now)!;
  const ref = { taskId: id, revision: 1, ownerToken: c.ownerToken };
  if (status === "planning") return id;
  if (status === "running") { appendProgress(db, ref, { stage: "generate", message: "Writing" }, now); return id; }
  if (status === "failed") { recordExecutionFailure(db, ref, { code: "BAD", message: "no", retryable: false }, now); return id; }
  if (status === "needs_input") {
    commitEngineResult(db, { ...ref, now, outcome: "needs_input", plan: testPlan(), sources: testSources(), questions: QUESTIONS, warnings: [] });
  } else {
    commitEngineResult(db, { ...ref, now, outcome: "skipped", reason: "No request.", sources: testSources() });
  }
  return id;
}

describe("task status x browser action matrix (HTTP)", () => {
  const statuses: TaskStatus[] = ["queued", "planning", "running", "needs_input", "ready", "approved", "dismissed", "failed", "skipped"];
  const ALLOWED: Record<string, TaskStatus[]> = {
    approve: ["ready"],
    dismiss: ["ready", "needs_input", "failed", "skipped"],
    retry: ["failed"],
    answers: ["needs_input"],
  };

  it("every action is accepted from exactly its allowed statuses; rejections are 409 INVALID_TRANSITION and change nothing", async () => {
    const { app: a, db, config, cookie, h } = await boot();
    const ids = new Map<TaskStatus, string>();
    statuses.forEach((s, i) => ids.set(s, makeInStatus(db, config, s, i + 1)));
    for (const s of statuses) {
      expect((await a.inject({ method: "GET", url: `/v1/tasks/${ids.get(s)}`, headers: { cookie } })).json().data.task.status, `setup ${s}`).toBe(s);
    }
    const call = (action: string, id: string) => {
      const url = `/v1/tasks/${id}`;
      if (action === "approve") return a.inject({ method: "POST", url: `${url}/review`, headers: h, payload: { revision: 1, action: "approve" } });
      if (action === "dismiss") return a.inject({ method: "POST", url: `${url}/review`, headers: h, payload: { revision: 1, action: "dismiss" } });
      if (action === "retry") return a.inject({ method: "POST", url: `${url}/retry`, headers: h, payload: { revision: 1 } });
      return a.inject({ method: "POST", url: `${url}/answers`, headers: h, payload: { revision: 1, answers: [{ questionId: "q1", answer: "Scope" }] } });
    };
    // Reject checks first (they must not mutate), then accept checks.
    for (const action of Object.keys(ALLOWED)) {
      for (const s of statuses.filter((x) => !ALLOWED[action]!.includes(x))) {
        const id = ids.get(s)!;
        const r = await call(action, id);
        expect(r.statusCode, `${action} from ${s}`).toBe(409);
        expect(r.json().error.code, `${action} from ${s}`).toBe("INVALID_TRANSITION");
        expect((await a.inject({ method: "GET", url: `/v1/tasks/${id}`, headers: { cookie } })).json().data.task.status, `${action} from ${s} mutated`).toBe(s);
      }
    }
    for (const action of Object.keys(ALLOWED)) {
      for (const s of ALLOWED[action]!) {
        // Fresh task per accepted action so earlier accepts do not consume the state.
        const id = makeInStatus(db, config, s, 100 + statuses.length * (action.length) + statuses.indexOf(s) + (action === "dismiss" ? 50 : 0));
        const r = await call(action, id);
        expect(r.statusCode, `${action} from ${s}`).toBe(200);
        const expected = action === "approve" ? "approved" : action === "dismiss" ? "dismissed" : "queued";
        expect(r.json().data.status, `${action} from ${s}`).toBe(expected);
      }
    }
  });
});

describe("clarification over HTTP", () => {
  it("returns the documented codes for malformed, unknown, duplicate, missing, and stale answers", async () => {
    const { app: a, db, config, cookie, h } = await boot();
    const id = makeInStatus(db, config, "needs_input", 1);
    const post = (payload: unknown) => a.inject({ method: "POST", url: `/v1/tasks/${id}/answers`, headers: h, payload: payload as object });
    const cases: Array<[string, unknown, number, string]> = [
      ["no body fields", {}, 400, "VALIDATION_ERROR"],
      ["empty list", { revision: 1, answers: [] }, 400, "VALIDATION_ERROR"],
      ["non-integer revision", { revision: 1.5, answers: [{ questionId: "q1", answer: "x" }] }, 400, "VALIDATION_ERROR"],
      ["unknown question", { revision: 1, answers: [{ questionId: "zzz", answer: "x" }] }, 400, "VALIDATION_ERROR"],
      ["duplicate", { revision: 1, answers: [{ questionId: "q1", answer: "x" }, { questionId: "q1", answer: "y" }] }, 400, "VALIDATION_ERROR"],
      ["required missing", { revision: 1, answers: [{ questionId: "q2", answer: "x" }] }, 400, "VALIDATION_ERROR"],
      ["stale revision", { revision: 3, answers: [{ questionId: "q1", answer: "x" }] }, 409, "STALE_REVISION"],
    ];
    for (const [label, payload, status, code] of cases) {
      const r = await post(payload);
      expect(r.statusCode, label).toBe(status);
      expect(r.json().error.code, label).toBe(code);
      expect(JSON.stringify(r.json()), label).not.toMatch(/at .*\.ts|node_modules|stack/i);
    }
    expect((await a.inject({ method: "GET", url: `/v1/tasks/${id}`, headers: { cookie } })).json().data.task).toMatchObject({ status: "needs_input", revision: 1 });
    expect((await a.inject({ method: "POST", url: "/v1/tasks/does-not-exist/answers", headers: h, payload: { revision: 1, answers: [{ questionId: "q1", answer: "x" }] } })).statusCode).toBe(404);
  });

  it("ten simultaneous identical submits: one 200 (revision 2), nine 409, exactly one new job", async () => {
    const { app: a, db, config, h } = await boot();
    const id = makeInStatus(db, config, "needs_input", 1);
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      a.inject({ method: "POST", url: `/v1/tasks/${id}/answers`, headers: h, payload: { revision: 1, answers: [{ questionId: "q1", answer: "Scope" }] } })));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409).every((r) => ["STALE_REVISION", "INVALID_TRANSITION"].includes(r.json().error.code))).toBe(true);
    expect(results.filter((r) => r.statusCode === 200)[0]!.json().data).toMatchObject({ status: "queued", revision: 2 });
    expect((db.prepare("SELECT COUNT(*) n FROM jobs WHERE task_id=? AND revision=2").get(id) as { n: number }).n).toBe(1);
  });

  it("task detail after a resumed clarification: current-revision artifacts only, historical events keep their revision, answers retained", async () => {
    const { app: a, db, config, cookie, h } = await boot();
    const id = makeInStatus(db, config, "needs_input", 1);
    await a.inject({ method: "POST", url: `/v1/tasks/${id}/answers`, headers: h, payload: { revision: 1, answers: [{ questionId: "q1", answer: "A brand site" }] } });
    const c = claimNextJob(db, "w", new Date(Date.now() + 5000))!;
    const r = readyResult({ taskId: id, revision: 2 });
    const files = publishArtifactFiles(config.artifactsDir, id, 2, r.files);
    commitEngineResult(db, { taskId: id, revision: 2, ownerToken: c.ownerToken, now: T(101), outcome: "ready", plan: r.plan, sources: r.sources, products: r.products, warnings: [], files });
    const d = (await a.inject({ method: "GET", url: `/v1/tasks/${id}`, headers: { cookie } })).json().data;
    expect(d.task).toMatchObject({ status: "ready", revision: 2, artifactCount: 2 });
    expect(d.artifacts).toHaveLength(2);
    expect(d.artifacts.every((x: { revision: number }) => x.revision === 2)).toBe(true);
    expect(d.answers).toEqual([{ questionId: "q1", answer: "A brand site" }]);
    expect(d.questions).toEqual([]);
    expect(d.sources.length).toBeGreaterThan(0);
    expect(d.products).toHaveLength(2);
    const revs = new Set(d.events.map((e: { revision: number }) => e.revision));
    expect([...revs].sort()).toEqual([1, 2]);
    // Old review of the superseded revision is rejected, the current one works.
    const stale = await a.inject({ method: "POST", url: `/v1/tasks/${id}/review`, headers: h, payload: { revision: 1, action: "approve" } });
    expect([stale.statusCode, stale.json().error.code]).toEqual([409, "STALE_REVISION"]);
    expect((await a.inject({ method: "POST", url: `/v1/tasks/${id}/review`, headers: h, payload: { revision: 2, action: "approve" } })).json().data.status).toBe("approved");
  });
});

describe("malformed and oversized requests stay safe", () => {
  it("returns bounded 4xx envelopes, never a 500 or a stack trace", async () => {
    const { app: a, h } = await boot();
    const big = await a.inject({ method: "POST", url: "/v1/demo/inject", headers: { ...h, "content-type": "application/json" }, payload: JSON.stringify({ scenario: "proposal", replayKey: "x".repeat(300_000) }) });
    expect([big.statusCode, big.json().error.code]).toEqual([413, "PAYLOAD_TOO_LARGE"]);
    const badJson = await a.inject({ method: "POST", url: "/v1/demo/inject", headers: { ...h, "content-type": "application/json" }, payload: "{not json" });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json().error.requestId).toEqual(expect.any(String));
    const wrongType = await a.inject({ method: "POST", url: "/v1/demo/inject", headers: { ...h, "content-type": "text/plain" }, payload: "scenario=proposal" });
    expect(wrongType.statusCode).toBeGreaterThanOrEqual(400);
    expect(wrongType.statusCode).toBeLessThan(500);
    const longKey = await a.inject({ method: "POST", url: "/v1/demo/inject", headers: h, payload: { scenario: "proposal", replayKey: "k".repeat(500) } });
    expect(longKey.statusCode).toBe(400);
    const badQuery = await a.inject({ method: "GET", url: "/v1/tasks?status=bogus", headers: { cookie: h.cookie } });
    expect(badQuery.statusCode).toBe(400);
    const badCursor = await a.inject({ method: "GET", url: "/v1/tasks?cursor=%00%00", headers: { cookie: h.cookie } });
    expect(badCursor.statusCode).toBeGreaterThanOrEqual(400);
    expect(badCursor.statusCode).toBeLessThan(500);
    for (const r of [big, badJson, wrongType, longKey, badQuery, badCursor]) {
      expect(r.body).not.toMatch(/node_modules|\.ts:\d+|SqliteError|stack/i);
    }
  });
});
