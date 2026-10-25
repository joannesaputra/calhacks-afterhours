// Scenarios D, E, F, L (+ J restart persistence) over real HTTP with a real worker process.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { record } from "./support/evidence.mjs";
import { startStack } from "./support/harness.mjs";
import { docxText, openZip, pptxSlides, sha256 } from "./support/office.mjs";

const norm = (t) => t.replace(/\s+/g, " ").trim();
const ANSWERS = [
  ["client_identity", "Juniper Bakery"],
  ["project_scope", "Brand refresh: audience research, messaging, a three-week content calendar"],
  ["authorized_fee", "USD 4,500"],
  ["project_schedule", "Start November 2, 2026 and run for three weeks"],
].map(([questionId, answer]) => ({ questionId, answer }));
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

describe("D. clarification (real HTTP, real worker)", () => {
  let s;
  const ctx = {};
  before(async () => { s = await startStack(); });
  after(async () => { await s?.stop(); });

  it("D1. ambiguous request -> needs_input with four stable required questions, no files, no notification", async () => {
    const inj = await s.inject("ambiguous");
    ctx.id = inj.body.data.taskId;
    const d = await s.waitStatus(ctx.id, ["needs_input", "ready", "failed"]);
    assert.equal(d.task.status, "needs_input");
    assert.equal(d.task.revision, 1);
    assert.deepEqual(d.questions.map((q) => q.id), ["client_identity", "project_scope", "authorized_fee", "project_schedule"]);
    assert.ok(d.questions.every((q) => q.required && q.question && q.reason));
    assert.equal(d.artifacts.length, 0);
    assert.equal(d.notifications.length, 0);
    ctx.detail1 = d;
  });

  it("D2. questions are stable across refresh", async () => {
    const again = (await s.get(`/v1/tasks/${ctx.id}`)).body.data;
    assert.deepEqual(again.questions, ctx.detail1.questions);
  });

  it("D3. invalid submissions fail safely (400/409) and create no revision, no job, no events", async () => {
    const before = (await s.get(`/v1/tasks/${ctx.id}`)).body.data;
    const bad = [
      ["empty list", { revision: 1, answers: [] }, 400],
      ["missing revision", { answers: ANSWERS }, 400],
      ["partial answers", { revision: 1, answers: [ANSWERS[0]] }, 400],
      ["unknown question id", { revision: 1, answers: [{ questionId: "nope", answer: "x" }] }, 400],
      ["duplicate answer", { revision: 1, answers: [...ANSWERS, ANSWERS[0]] }, 400],
      ["blank answer", { revision: 1, answers: ANSWERS.map((a, i) => (i === 0 ? { ...a, answer: "   " } : a)) }, 400],
      ["stale revision", { revision: 2, answers: ANSWERS }, 409],
      ["wrong types", { revision: "1", answers: "x" }, 400],
    ];
    for (const [label, body, want] of bad) {
      const r = await s.post(`/v1/tasks/${ctx.id}/answers`, body);
      assert.equal(r.status, want, `${label}: got ${r.status} ${JSON.stringify(r.body?.error)}`);
      assert.ok(r.body?.error?.requestId);
    }
    const after = (await s.get(`/v1/tasks/${ctx.id}`)).body.data;
    assert.equal(after.task.revision, before.task.revision);
    assert.equal(after.task.status, "needs_input");
    assert.equal(after.events.length, before.events.length, "rejected submissions must not append events");
    const missing = await s.post(`/v1/tasks/${ZERO_UUID}/answers`, { revision: 1, answers: ANSWERS });
    assert.equal(missing.status, 404);
  });

  it("D4. wrong-state actions on needs_input: approve and retry -> 409 (no approving unfinished work)", async () => {
    const a = await s.post(`/v1/tasks/${ctx.id}/review`, { revision: 1, action: "approve" });
    assert.equal(a.status, 409);
    const r = await s.post(`/v1/tasks/${ctx.id}/retry`, { revision: 1 });
    assert.equal(r.status, 409);
    const d = (await s.get(`/v1/tasks/${ctx.id}`)).body.data;
    assert.equal(d.task.status, "needs_input");
  });

  it("D5. valid answers create exactly one new revision and one new job; work completes reflecting the answers", async () => {
    const ok = await s.post(`/v1/tasks/${ctx.id}/answers`, { revision: 1, answers: ANSWERS });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.revision, 2);
    assert.equal(ok.body.data.status, "queued");
    const d = await s.waitStatus(ctx.id, ["ready", "failed", "needs_input"]);
    ctx.detail2 = d;
    assert.equal(d.task.status, "ready", `status=${d.task.status} error=${JSON.stringify(d.task.error)}`);
    assert.equal(d.task.revision, 2);
    const starts = d.events.filter((e) => /Started planning/.test(e.message));
    assert.equal(starts.length, 2, "one planning start per revision (r1 + r2), no duplicate job");
    assert.deepEqual(d.events.filter((e) => /Started planning/.test(e.message)).map((e) => e.revision), [1, 2]);
    assert.ok(d.events.some((e) => e.revision === 1 && /Needs your input/.test(e.message)), "revision-1 history stays traceable");
    assert.deepEqual(d.answers, ANSWERS, "answers persisted and returned");
    assert.equal(d.artifacts.length, 2);
    assert.ok(d.artifacts.every((a) => a.revision === 2), "current-revision artifacts only");
  });

  it("D6. resumed deliverables reflect answer content (client, fee, schedule)", async () => {
    const files = {};
    for (const a of ctx.detail2.artifacts) {
      const r = await s.get(s.backendPath(a.downloadPath));
      assert.equal(sha256(r.bytes), a.sha256);
      files[a.format] = openZip(r.bytes);
    }
    const doc = norm(docxText(files.docx));
    const deck = norm(pptxSlides(files.pptx).map((x) => x.text).join(" "));
    for (const needle of ["Juniper Bakery", "USD 4,500", "November 2, 2026"]) {
      assert.ok(doc.includes(needle), `DOCX missing ${needle}`);
      assert.ok(deck.includes(needle) || needle === "USD 4,500", `PPTX missing ${needle}`);
    }
    assert.ok(!doc.includes("USD 6,000") && !doc.includes("Maple"), "must not leak the other scenario's fee/client");
    ctx.files = { doc, deck };
    record("clarification", { taskId: ctx.id, revision: 2, artifacts: ctx.detail2.artifacts.map(({ filename, sizeBytes, sha256: h, format }) => ({ filename, sizeBytes, sha256: h, format })) });
  });

  it("D7. deliverables do not contradict the answers: 'three-week' scope must not be paired with hard-coded 'Four-week' labels (DEF-3)", () => {
    const { doc, deck } = ctx.files;
    assert.ok(/three-week/.test(doc), "answer text is present");
    assert.ok(!/Four-week/i.test(doc), "DOCX still contains a hard-coded 'Four-week' item after the client said three weeks");
    assert.ok(!/Four-week/i.test(deck), "PPTX still contains a hard-coded 'Four-week' label after the client said three weeks");
  });

  it("D8. after resume: answers again / retry / stale approve are rejected; correct approve works once", async () => {
    assert.equal((await s.post(`/v1/tasks/${ctx.id}/answers`, { revision: 2, answers: ANSWERS })).status, 409);
    assert.equal((await s.post(`/v1/tasks/${ctx.id}/retry`, { revision: 2 })).status, 409);
    const stale = await s.post(`/v1/tasks/${ctx.id}/review`, { revision: 1, action: "approve" });
    assert.equal(stale.status, 409, "revision-1 review must not apply to revision 2");
    assert.equal((await s.get(`/v1/tasks/${ctx.id}`)).body.data.task.status, "ready");
    const ok = await s.post(`/v1/tasks/${ctx.id}/review`, { revision: 2, action: "approve" });
    assert.equal(ok.status, 200);
  });
});

describe("E/F/L. no_action, dedupe, state guards, failure, restart (real HTTP, real worker)", () => {
  let s;
  before(async () => { s = await startStack(); });
  after(async () => { await s?.stop(); });

  it("E1. FYI newsletter -> skipped, zero files, zero notifications", async () => {
    const inj = await s.inject("no_action");
    const d = await s.waitStatus(inj.body.data.taskId, ["skipped", "ready", "failed", "needs_input"]);
    assert.equal(d.task.status, "skipped");
    assert.equal(d.artifacts.length, 0);
    assert.equal(d.products.length, 0);
    assert.equal(d.notifications.length, 0);
    const all = (await s.get("/v1/notifications")).body.data.items;
    assert.equal(all.filter((n) => n.taskId === d.task.id).length, 0);
    assert.equal((await s.post(`/v1/tasks/${d.task.id}/review`, { revision: 1, action: "approve" })).status, 409, "skipped work cannot be approved");
    assert.equal((await s.post(`/v1/tasks/${d.task.id}/retry`, { revision: 1 })).status, 409);
  });

  it("F1. duplicate intake: sequential and 12 simultaneous injections with one replayKey create one task", async () => {
    const key = `qa-dup-${Date.now()}`;
    const first = await s.inject("no_action", key);
    assert.equal(first.body.data.deduplicated, false);
    const second = await s.inject("no_action", key);
    assert.equal(second.body.data.taskId, first.body.data.taskId);
    assert.equal(second.body.data.deduplicated, true);
    const burstKey = `qa-burst-${Date.now()}`;
    const burst = await Promise.all(Array.from({ length: 12 }, () => s.inject("no_action", burstKey)));
    assert.ok(burst.every((r) => r.status === 200), burst.map((r) => r.status).join());
    assert.equal(new Set(burst.map((r) => r.body.data.taskId)).size, 1, "exactly one task");
    assert.equal(burst.filter((r) => r.body.data.deduplicated === false).length, 1, "exactly one creator");
    const d = await s.waitStatus(burst[0].body.data.taskId, ["skipped", "failed"]);
    assert.equal(d.events.filter((e) => /Started planning/.test(e.message)).length, 1, "one job run");
    const list = (await s.get("/v1/tasks?limit=100")).body.data.items;
    assert.equal(list.filter((t) => t.id === burst[0].body.data.taskId).length, 1);
    const other = await s.inject("no_action", `${burstKey}-other`);
    assert.notEqual(other.body.data.taskId, burst[0].body.data.taskId, "a new replay key is a new task");
  });

  it("F2. malformed review/retry/answers bodies and unknown ids are rejected safely", async () => {
    const inj = await s.inject("no_action");
    const id = inj.body.data.taskId;
    await s.waitStatus(id, ["skipped"]);
    for (const [route, body, want] of [
      [`/v1/tasks/${id}/review`, { revision: 1, action: "publish" }, 400],
      [`/v1/tasks/${id}/review`, { action: "approve" }, 400],
      [`/v1/tasks/${id}/retry`, {}, 400],
      [`/v1/tasks/${ZERO_UUID}/review`, { revision: 1, action: "approve" }, 404],
    ]) {
      const r = await s.post(route, body);
      assert.equal(r.status, want, `${route} ${JSON.stringify(body)} -> ${r.status}`);
    }
    assert.equal((await s.get("/v1/tasks?cursor=garbage")).status, 400, "invalid cursor must be 400, not a silent first page");
    assert.equal((await s.get(`/v1/tasks/${ZERO_UUID}`)).status, 404);
  });

  it("L1. a skipped task can be dismissed; terminal state then rejects further review", async () => {
    const inj = await s.inject("no_action");
    const id = inj.body.data.taskId;
    await s.waitStatus(id, ["skipped"]);
    const ok = await s.post(`/v1/tasks/${id}/review`, { revision: 1, action: "dismiss" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.status, "dismissed");
    assert.equal((await s.post(`/v1/tasks/${id}/review`, { revision: 1, action: "dismiss" })).status, 409);
  });

  it("J. restart persistence: tasks, approved state, artifacts and sessions survive an API+worker restart", async () => {
    const inj = await s.inject("proposal");
    const d = await s.waitStatus(inj.body.data.taskId, ["ready", "failed"]);
    assert.equal(d.task.status, "ready", `status=${d.task.status} error=${JSON.stringify(d.task.error)}`);
    assert.equal((await s.post(`/v1/tasks/${d.task.id}/review`, { revision: 1, action: "approve" })).status, 200);
    const art = d.artifacts[0];
    const beforeBytes = (await s.get(s.backendPath(art.downloadPath))).bytes;
    await s.restartAll();
    const sessionStillValid = await s.get("/v1/tasks");
    assert.equal(sessionStillValid.status, 200, "session cookie should survive a restart (sessions are persisted)");
    const after = (await s.get(`/v1/tasks/${d.task.id}`)).body.data;
    assert.equal(after.task.status, "approved");
    assert.equal(after.artifacts.length, 2);
    const afterBytes = (await s.get(s.backendPath(art.downloadPath))).bytes;
    assert.equal(sha256(afterBytes), sha256(beforeBytes));
    const jobs = after.events.filter((e) => /Started planning/.test(e.message));
    assert.equal(jobs.length, 1, "restart must not rerun finished work");
  });
});

describe("F. failure and retry with live mode and no credentials (explicit, honest failure; no fixture fallback)", () => {
  let s;
  before(async () => { s = await startStack({ env: { GENERATION_MODE: "live", MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "", MODEL_NAME: "" } }); });
  after(async () => { await s?.stop(); });

  it("integrations discloses live mode with configured=false", async () => {
    const m = (await s.get("/v1/integrations")).body.data.model;
    assert.equal(m.mode, "live");
    assert.equal(m.configured, false);
  });

  it("task fails with a safe nonretryable configuration code, zero files, no ready notification", async () => {
    const inj = await s.inject("proposal");
    const d = await s.waitStatus(inj.body.data.taskId, ["failed", "ready"]);
    assert.equal(d.task.status, "failed", "must not fall back to fixture output");
    assert.equal(d.task.generationMode, "live", "mode snapshotted at ingestion");
    assert.equal(d.task.error.retryable, false);
    assert.match(d.task.error.code, /MODEL|CONFIG/);
    assert.ok(!/sk-|key/i.test(d.task.error.message.replace(/API key/i, "")), "no key material in error");
    assert.equal(d.artifacts.length, 0);
    assert.equal(d.notifications.length, 0);
    assert.equal((await s.post(`/v1/tasks/${d.task.id}/review`, { revision: 1, action: "approve" })).status, 409, "failed work cannot be approved");
  });

  it("manual retry creates revision 2 (only failed tasks can retry) and fails honestly again while unconfigured", async () => {
    const list = (await s.get("/v1/tasks")).body.data.items;
    const failed = list.find((t) => t.status === "failed");
    const stale = await s.post(`/v1/tasks/${failed.id}/retry`, { revision: 7 });
    assert.equal(stale.status, 409);
    const r = await s.post(`/v1/tasks/${failed.id}/retry`, { revision: failed.revision });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.revision, failed.revision + 1);
    const d = await s.waitStatus(failed.id, ["failed", "ready"]);
    assert.equal(d.task.status, "failed");
    assert.equal(d.task.revision, failed.revision + 1);
    assert.equal(d.artifacts.length, 0);
  });
});
