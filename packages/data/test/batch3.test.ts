import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TaskStatus } from "@afterhours/contracts";
import {
  DomainError, LeaseLostError, canTransition, claimNextJob, commitEngineResult, createReadyNotification, getTaskDetail,
  getTaskSummary, ingestMessage, LIMITS, markReviewed, publishArtifactFiles, recordExecutionFailure, recoverExpiredJobs,
  resolveFixturePath, retryFailedTask, submitAnswers, type AppConfig, type Db,
} from "../src";
import { injectTask, makeTestConfig, makeTestDb, readyResult, testPlan, testSources } from "../src/testing";

const T = (s: number) => new Date(Date.UTC(2026, 2, 1, 10, 0, s));
const count = (db: Db, sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;
const domain = (fn: () => unknown): DomainError => {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(DomainError); return e as DomainError; }
  throw new Error("expected DomainError");
};

const QUESTIONS = [
  { id: "q1", question: "What is the scope?", reason: "No scope in the email", required: true },
  { id: "q2", question: "Preferred start date?", reason: "Optional", required: false },
];

function toNeedsInput(db: Db, config: AppConfig, key: string, at = 0): string {
  const taskId = injectTask(db, config, key, T(at), "ambiguous");
  const c = claimNextJob(db, "w", T(at))!;
  commitEngineResult(db, {
    taskId, revision: c.revision, ownerToken: c.ownerToken, now: T(at + 1), outcome: "needs_input",
    plan: testPlan(), sources: testSources(), questions: QUESTIONS, warnings: [],
  });
  return taskId;
}

function finishReady(db: Db, config: AppConfig, taskId: string, at: number): number {
  const c = claimNextJob(db, "w2", T(at))!;
  const r = readyResult({ taskId, revision: c.revision });
  const files = publishArtifactFiles(config.artifactsDir, taskId, c.revision, r.files);
  commitEngineResult(db, {
    taskId, revision: c.revision, ownerToken: c.ownerToken, now: T(at + 1), outcome: "ready",
    plan: r.plan, sources: r.sources, products: r.products, warnings: [], files,
  });
  return c.revision;
}

describe("state machine matches the specification table exactly", () => {
  const SPEC: Record<TaskStatus, TaskStatus[]> = {
    queued: ["planning"], planning: ["running", "needs_input", "skipped", "failed"], running: ["ready", "needs_input", "failed"],
    needs_input: ["queued", "dismissed"], failed: ["queued", "dismissed"], ready: ["approved", "dismissed"],
    skipped: ["dismissed"], approved: [], dismissed: [],
  };
  const all = Object.keys(SPEC) as TaskStatus[];

  it("allows exactly the listed transitions (81 pairs) and the recovery exception only for planning/running -> queued", () => {
    for (const from of all) for (const to of all) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(SPEC[from].includes(to));
    }
    for (const from of all) for (const to of all) {
      const recovery = (from === "planning" || from === "running") && to === "queued";
      expect(canTransition(from, to, { recovery: true }), `recovery ${from} -> ${to}`).toBe(SPEC[from].includes(to) || recovery);
    }
  });
});

describe("clarification answers", () => {
  it("a valid answer creates exactly one new revision and one job and preserves history", () => {
    const { db, config } = makeTestDb();
    const id = toNeedsInput(db, config, "a1");
    const jobsBefore = count(db, "SELECT COUNT(*) n FROM jobs WHERE task_id=?", id);
    const out = submitAnswers(db, id, 1, [{ questionId: "q1", answer: "  A five-page brand site.  " }, { questionId: "q2", answer: "   " }], T(10));
    expect(out).toMatchObject({ status: "queued", revision: 2 });
    expect(count(db, "SELECT COUNT(*) n FROM jobs WHERE task_id=?", id)).toBe(jobsBefore + 1);
    expect(db.prepare("SELECT revision, status FROM jobs WHERE task_id=? ORDER BY revision").all(id)).toEqual([
      { revision: 1, status: "done" }, { revision: 2, status: "queued" },
    ]);
    const hist = db.prepare("SELECT revision, question_id, question, answer FROM answer_history WHERE task_id=?").all(id);
    expect(hist).toEqual([{ revision: 1, question_id: "q1", question: "What is the scope?", answer: "A five-page brand site." }]);
    const rev2 = finishReady(db, config, id, 20);
    expect(rev2).toBe(2);
    const detail = getTaskDetail(db, id);
    expect(detail.answers).toEqual([{ questionId: "q1", answer: "A five-page brand site." }]);
    expect(detail.artifacts.every((a) => a.revision === 2)).toBe(true);
    expect(detail.events.filter((e) => e.revision === 1).length).toBeGreaterThan(0);
    expect(detail.events.some((e) => e.revision === 2)).toBe(true);
    expect(detail.task.status).toBe("ready");
  });

  it("rejects unknown, duplicate, missing, blank, and oversized answers with VALIDATION_ERROR and writes nothing", () => {
    const { db, config } = makeTestDb();
    const id = toNeedsInput(db, config, "a2");
    const bad: Array<[string, Array<{ questionId: string; answer: string }>]> = [
      ["unknown id", [{ questionId: "nope", answer: "x" }, { questionId: "q1", answer: "y" }]],
      ["duplicate id", [{ questionId: "q1", answer: "x" }, { questionId: "q1", answer: "y" }]],
      ["required missing", [{ questionId: "q2", answer: "later" }]],
      ["required blank", [{ questionId: "q1", answer: "   " }]],
      ["too long", [{ questionId: "q1", answer: "x".repeat(5001) }]],
    ];
    for (const [label, answers] of bad) {
      const e = domain(() => submitAnswers(db, id, 1, answers, T(10)));
      expect(e.code, label).toBe("VALIDATION_ERROR");
      expect(e.httpStatus, label).toBe(400);
    }
    const s = getTaskSummary(db, id);
    expect(s).toMatchObject({ status: "needs_input", revision: 1 });
    expect(count(db, "SELECT COUNT(*) n FROM answer_history")).toBe(0);
    expect(count(db, "SELECT COUNT(*) n FROM jobs WHERE task_id=?", id)).toBe(1);
  });

  it("stale revision is STALE_REVISION 409 carrying the current revision; a duplicate submit after success is also 409", () => {
    const { db, config } = makeTestDb();
    const id = toNeedsInput(db, config, "a3");
    const stale = domain(() => submitAnswers(db, id, 7, [{ questionId: "q1", answer: "x" }], T(10)));
    expect([stale.code, stale.httpStatus, stale.details]).toEqual(["STALE_REVISION", 409, { currentRevision: 1 }]);
    submitAnswers(db, id, 1, [{ questionId: "q1", answer: "x" }], T(11));
    const dup = domain(() => submitAnswers(db, id, 1, [{ questionId: "q1", answer: "x" }], T(12)));
    expect([dup.code, dup.httpStatus]).toEqual(["STALE_REVISION", 409]);
    // Right revision, wrong state (queued): INVALID_TRANSITION.
    const wrongState = domain(() => submitAnswers(db, id, 2, [{ questionId: "q1", answer: "x" }], T(13)));
    expect([wrongState.code, wrongState.httpStatus]).toEqual(["INVALID_TRANSITION", 409]);
    expect(count(db, "SELECT COUNT(*) n FROM jobs WHERE task_id=?", id)).toBe(2);
    expect(count(db, "SELECT COUNT(*) n FROM answer_history")).toBe(1);
  });

  it("retained answers carry into a later round and a re-asked question must be answered again", () => {
    const { db, config } = makeTestDb();
    const id = injectTask(db, config, "a4", T(0), "ambiguous");
    const c1 = claimNextJob(db, "w", T(0))!;
    commitEngineResult(db, { taskId: id, revision: 1, ownerToken: c1.ownerToken, now: T(1), outcome: "needs_input", plan: testPlan(), sources: testSources(), questions: QUESTIONS, warnings: [] });
    submitAnswers(db, id, 1, [{ questionId: "q1", answer: "Scope A" }], T(2));
    const c2 = claimNextJob(db, "w", T(3))!;
    commitEngineResult(db, {
      taskId: id, revision: 2, ownerToken: c2.ownerToken, now: T(4), outcome: "needs_input", plan: testPlan(), sources: testSources(),
      questions: [{ id: "q3", question: "Budget?", reason: "Needed for fees", required: true }], warnings: [],
    });
    expect(domain(() => submitAnswers(db, id, 2, [{ questionId: "q1", answer: "again" }], T(5))).code).toBe("VALIDATION_ERROR");
    submitAnswers(db, id, 2, [{ questionId: "q3", answer: "USD 6,000" }], T(6));
    expect(getTaskDetail(db, id).answers).toEqual([{ questionId: "q1", answer: "Scope A" }, { questionId: "q3", answer: "USD 6,000" }]);
    expect(count(db, "SELECT COUNT(*) n FROM answer_history WHERE task_id=?", id)).toBe(2);
  });
});

function race(config: AppConfig, op: "answer" | "approve" | "dismiss", taskId: string, revision: number) {
  return new Promise<{ ok: boolean; code?: string; status?: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", `${import.meta.dirname}/support/race-child.ts`, config.databasePath, op, taskId, String(revision)], {
      cwd: config.repoRoot, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = ""; let err = "";
    child.stdout.on("data", (d: Buffer) => { out += d; });
    child.stderr.on("data", (d: Buffer) => { err += d; });
    child.on("exit", (code) => (code === 0 ? resolve(JSON.parse(out.trim().split("\n").pop()!)) : reject(new Error(`child ${code}: ${err.slice(0, 300)}`))));
  });
}

describe("races across separate processes sharing one SQLite file", () => {
  it("six simultaneous answer submits: exactly one wins, five get a 409 code, one new job", async () => {
    const { db, config } = makeTestDb();
    const id = toNeedsInput(db, config, "r1");
    const results = await Promise.all(Array.from({ length: 6 }, () => race(config, "answer", id, 1)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => r.code === "STALE_REVISION" || r.code === "INVALID_TRANSITION")).toBe(true);
    expect(getTaskSummary(db, id)).toMatchObject({ status: "queued", revision: 2 });
    expect(count(db, "SELECT COUNT(*) n FROM jobs WHERE task_id=? AND revision=2", id)).toBe(1);
    expect(count(db, "SELECT COUNT(*) n FROM answer_history")).toBe(1);
  }, 60_000);

  it("approve racing dismiss on a ready task: exactly one decision is recorded", async () => {
    const { db, config } = makeTestDb();
    const id = injectTask(db, config, "r2", T(0));
    claimNextJob(db, "w", T(0));
    // Use the real ready path so the task is genuinely ready.
    const c = db.prepare("SELECT lease_owner FROM jobs WHERE task_id=?").get(id) as { lease_owner: string };
    const r = readyResult({ taskId: id, revision: 1 });
    const files = publishArtifactFiles(config.artifactsDir, id, 1, r.files);
    commitEngineResult(db, { taskId: id, revision: 1, ownerToken: c.lease_owner, now: T(1), outcome: "ready", plan: r.plan, sources: r.sources, products: r.products, warnings: [], files });
    const results = await Promise.all([race(config, "approve", id, 1), race(config, "dismiss", id, 1), race(config, "approve", id, 1), race(config, "dismiss", id, 1)]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.filter((x) => !x.ok).every((x) => x.code === "INVALID_TRANSITION")).toBe(true);
    const final = getTaskSummary(db, id).status;
    expect(["approved", "dismissed"]).toContain(final);
    expect(count(db, "SELECT COUNT(*) n FROM task_events WHERE task_id=? AND type='review'", id)).toBe(1);
  }, 60_000);
});

describe("stale workers and old reviews cannot touch a newer revision", () => {
  it("a worker that finishes revision 1 after the user retried into revision 2 is rejected and changes nothing", () => {
    const { db, config } = makeTestDb();
    const id = injectTask(db, config, "s1", T(0));
    const a = claimNextJob(db, "wA", T(0))!;
    expect(recoverExpiredJobs(db, T(100))).toBe(1);
    const b = claimNextJob(db, "wB", T(101))!;
    expect(recoverExpiredJobs(db, T(300))).toBe(1);
    expect(getTaskSummary(db, id)).toMatchObject({ status: "failed", revision: 1 });
    retryFailedTask(db, id, 1, T(301));
    expect(getTaskSummary(db, id)).toMatchObject({ status: "queued", revision: 2 });

    const r = readyResult({ taskId: id, revision: 1 });
    const files = publishArtifactFiles(config.artifactsDir, id, 1, r.files); // a stalled worker may have written files already
    for (const owner of [a.ownerToken, b.ownerToken]) {
      expect(() => commitEngineResult(db, {
        taskId: id, revision: 1, ownerToken: owner, now: T(302), outcome: "ready",
        plan: r.plan, sources: r.sources, products: r.products, warnings: [], files,
      })).toThrow(LeaseLostError);
    }
    expect(getTaskSummary(db, id)).toMatchObject({ status: "queued", revision: 2 });
    expect(count(db, "SELECT COUNT(*) n FROM artifacts")).toBe(0);
    expect(count(db, "SELECT COUNT(*) n FROM notifications")).toBe(0);
    expect(count(db, "SELECT COUNT(*) n FROM jobs WHERE task_id=? AND revision=2 AND status='queued'", id)).toBe(1);

    // Old review is rejected; the new revision completes normally.
    expect(domain(() => markReviewed(db, id, 1, "approve", T(303))).code).toBe("STALE_REVISION");
    expect(finishReady(db, config, id, 310)).toBe(2);
    expect(getTaskDetail(db, id).artifacts.every((x) => x.revision === 2)).toBe(true);
  });

  it("a failure report from a stale owner does not fail the newer revision", () => {
    const { db, config } = makeTestDb();
    const id = injectTask(db, config, "s2", T(0));
    const a = claimNextJob(db, "wA", T(0))!;
    recoverExpiredJobs(db, T(100));
    claimNextJob(db, "wB", T(101));
    recoverExpiredJobs(db, T(300));
    retryFailedTask(db, id, 1, T(301));
    const out = recordExecutionFailure(db, { taskId: id, revision: 1, ownerToken: a.ownerToken }, { code: "X", message: "late", retryable: false }, T(302));
    expect(out).toEqual({ lost: true });
    expect(getTaskSummary(db, id)).toMatchObject({ status: "queued", revision: 2, error: null });
  });
});

describe("notification dedupe across revisions", () => {
  it("one intent per task revision; repeating a commit or the intent itself does not duplicate", () => {
    const { db, config } = makeTestDb();
    const id = toNeedsInput(db, config, "n1");
    submitAnswers(db, id, 1, [{ questionId: "q1", answer: "x" }], T(10));
    finishReady(db, config, id, 20);
    expect(db.prepare("SELECT dedupe_key FROM notifications").all()).toEqual([{ dedupe_key: `${id}/2/outbox` }]);
    createReadyNotification(db, id, 2, T(30));
    createReadyNotification(db, id, 2, T(31));
    expect(count(db, "SELECT COUNT(*) n FROM notifications")).toBe(1);

    // A second task that fails then succeeds via manual retry gets a revision-2 key, never a revision-1 key.
    const other = injectTask(db, config, "n2", T(40));
    const c = claimNextJob(db, "w", T(40))!;
    recordExecutionFailure(db, { taskId: other, revision: 1, ownerToken: c.ownerToken }, { code: "BAD", message: "x", retryable: false }, T(41));
    retryFailedTask(db, other, 1, T(42));
    finishReady(db, config, other, 50);
    const keys = (db.prepare("SELECT dedupe_key k FROM notifications ORDER BY dedupe_key").all() as { k: string }[]).map((r) => r.k);
    expect(keys).toEqual([`${id}/2/outbox`, `${other}/2/outbox`].sort());
  });
});

describe("intake file boundaries", () => {
  const env = (attachments: Array<{ id: string; filename: string; sizeBytes?: number }>) => ({
    providerMessageId: "x", providerThreadId: null, from: { name: null, email: "a@client.example" }, to: [], subject: "files",
    receivedAt: T(0).toISOString(), bodyText: "see files",
    attachments: attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: "text/plain", sizeBytes: a.sizeBytes ?? 1 })),
  });
  const att = (id: string, size: number) => ({ id, filename: `${id}.txt`, mimeType: "text/plain", bytes: new Uint8Array(size) });
  const ingest = (db: Db, key: string, files: ReturnType<typeof att>[]) =>
    ingestMessage(db, {
      sourceKey: `demo:x:${key}`, mode: "demo", integrationId: null, generationMode: "fixture", fixtureScenario: "proposal",
      envelope: env(files.map((f) => ({ id: f.id, filename: f.filename }))), attachments: files,
    }, T(0));

  it("stores at most five files, drops oversized/over-aggregate/duplicate ones, and records a visible warning per dropped file", () => {
    const { db } = makeTestDb();
    const out = ingest(db, "many", ["a", "b", "c", "d", "e", "f"].map((id) => att(id, 10)));
    if (out.kind !== "task") throw new Error("expected task");
    expect(count(db, "SELECT COUNT(*) n FROM task_attachments WHERE task_id=?", out.taskId)).toBe(LIMITS.maxFiles);
    const warn = getTaskDetail(db, out.taskId).events.filter((e) => e.type === "warning").map((e) => e.message);
    expect(warn).toEqual(['Attachment "f.txt" was not read: only the first 5 files per email are read.']);

    const big = ingest(db, "big", [att("ok", 10), att("huge", LIMITS.maxFileBytes + 1)]);
    if (big.kind !== "task") throw new Error("expected task");
    expect(db.prepare("SELECT attachment_id FROM task_attachments WHERE task_id=?").all(big.taskId)).toEqual([{ attachment_id: "ok" }]);
    expect(getTaskDetail(db, big.taskId).events.some((e) => e.type === "warning" && /huge\.txt.*larger than 10 MB/.test(e.message))).toBe(true);

    const agg = ingest(db, "agg", [att("p", 9 * 1024 * 1024), att("q", 9 * 1024 * 1024), att("r", 9 * 1024 * 1024)]);
    if (agg.kind !== "task") throw new Error("expected task");
    expect(count(db, "SELECT COUNT(*) n FROM task_attachments WHERE task_id=?", agg.taskId)).toBe(2);
    expect(getTaskDetail(db, agg.taskId).events.some((e) => e.type === "warning" && /r\.txt.*20 MB/.test(e.message))).toBe(true);

    const dupId = ingest(db, "dup", [att("same", 5), att("same", 6)]);
    if (dupId.kind !== "task") throw new Error("expected task");
    expect(count(db, "SELECT COUNT(*) n FROM task_attachments WHERE task_id=?", dupId.taskId)).toBe(1);
    expect(getTaskDetail(db, dupId.taskId).events.some((e) => e.type === "warning" && /repeats an earlier attachment/.test(e.message))).toBe(true);
  });

  it("an attachment the source skipped (e.g. Gmail polling) is still reported when its declared size is over the limit", () => {
    const { db } = makeTestDb();
    const out = ingestMessage(db, {
      sourceKey: "demo:x:skipped", mode: "demo", integrationId: null, generationMode: "fixture", fixtureScenario: "proposal",
      envelope: env([{ id: "big", filename: "deck.pptx", sizeBytes: LIMITS.maxFileBytes + 5 }, { id: "gone", filename: "notes.txt" }]), attachments: [],
    }, T(0));
    if (out.kind !== "task") throw new Error("expected task");
    const warn = getTaskDetail(db, out.taskId).events.filter((e) => e.type === "warning").map((e) => e.message);
    expect(warn).toHaveLength(2);
    expect(warn[0]).toMatch(/deck\.pptx.*larger than 10 MB/);
    expect(warn[1]).toMatch(/notes\.txt.*could not be fetched/);
  });

  it("a dropped attachment stays listed in the envelope but is not stored (the worker test covers the refusal that relies on this)", () => {
    const { db } = makeTestDb();
    const out = ingest(db, "missing", [att("huge", LIMITS.maxFileBytes + 1)]);
    if (out.kind !== "task") throw new Error("expected task");
    const d = getTaskDetail(db, out.taskId);
    expect(d.email.attachments.map((a) => a.id)).toEqual(["huge"]);
    expect(count(db, "SELECT COUNT(*) n FROM task_attachments WHERE task_id=?", out.taskId)).toBe(0);
  });

  it("trusted fixture paths reject traversal, absolute paths, NULs, and symlink escapes", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ah-fx-"));
    mkdirSync(path.join(root, "fixtures", "attachments"), { recursive: true });
    writeFileSync(path.join(root, "fixtures", "attachments", "ok.txt"), "ok");
    writeFileSync(path.join(root, "secret.txt"), "secret");
    symlinkSync(path.join(root, "secret.txt"), path.join(root, "fixtures", "attachments", "link.txt"));
    expect(resolveFixturePath(root, "attachments/ok.txt")).toMatch(/ok\.txt$/);
    for (const bad of ["../secret.txt", "attachments/../../secret.txt", "/etc/passwd", "attachments/link.txt", "attachments/ok.txt\0.png"]) {
      expect(() => resolveFixturePath(root, bad), bad).toThrow();
    }
  });
});

describe("makeTestConfig sanity", () => {
  it("test configs get isolated database files", () => {
    expect(makeTestConfig().databasePath).not.toBe(makeTestConfig().databasePath);
  });
});
