import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EngineDependencies, EngineInput, EngineResult } from "@afterhours/contracts";
import {
  OWNER_ID, ProviderRegistry, activeGrants, createEmailGrant, createFilesGrant, getContextView, getTaskDetail, ingestMessage, markReviewed, patchSettings,
  recoverExpiredJobs, resolveArtifactPath, revokeGrant, saveGmailConnection, submitAnswers, upsertAccount, type AppConfig, type Db,
} from "@afterhours/data";
import { makeTestDb, MemoryFileProvider, MemoryMailProvider, type FixtureMessage } from "@afterhours/data/testing";
import { PARSER_VERSION, extractDocument, readDeckBytes, runWork } from "@afterhours/engine";
import { buildDeckFixture } from "@afterhours/engine/testing";
import { sendNotification as stubSend } from "@afterhours/delivery";
import { createWorker } from "../src/worker";

const MAILBOX = "me@harbor.example";
const BOSS = "jordan@harbor.example";
const NOW = new Date("2026-10-26T16:05:00.000Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const VAGUE = "Can you revise the presentation from last week based on what we discussed?";
const SLIDES = [
  { title: "Maple and Moss kickoff", bullets: ["Harbor Creative proposal"], notes: "Open warmly" },
  { title: "Pricing", bullets: ["Fee is $50,000", "Payment in two instalments"] },
  { title: "Timeline", bullets: ["Six weeks from kickoff", "Review in week four"] },
];
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

interface Rig { db: Db; config: AppConfig; mail: MemoryMailProvider; engineCalls: EngineInput[]; sent: unknown[]; clock: { t: number }; worker: ReturnType<typeof createWorker>; files: MemoryFileProvider | null }

async function rig(messages: FixtureMessage[], o: { engine?: (i: EngineInput, d: EngineDependencies) => Promise<EngineResult>; files?: MemoryFileProvider; lookback?: number | null } = {}): Promise<Rig> {
  const { db, config } = makeTestDb();
  patchSettings(db, { allowedSenders: [BOSS] }, NOW);
  saveGmailConnection(db, config.tokenEncryptionKey, { account: MAILBOX, tokens: { access_token: "x", refresh_token: "y" } }, new Date(NOW.getTime() - 86_400_000 * 100));
  const mail = new MemoryMailProvider(MAILBOX, messages);
  const engineCalls: EngineInput[] = [];
  const sent: unknown[] = [];
  const clock = { t: NOW.getTime() };
  const providers = new ProviderRegistry(o.files ? { folder: o.files } : {}, () => mail);
  const worker = createWorker({
    db, config, workerId: "w-ctx", log: () => undefined, now: () => new Date(clock.t),
    runWork: async (i, d) => { engineCalls.push(i); return (o.engine ?? runWork)(i, d); },
    sendNotification: async (i) => { sent.push(i); return stubSend(i); },
    context: { extract: extractDocument, parserVersion: PARSER_VERSION, providers, mail: () => mail },
  });
  await worker.syncContext(); // reflects the integration into a connected account
  const acct = db.prepare("SELECT id FROM connected_accounts WHERE provider='gmail'").get() as { id: string };
  if (o.lookback !== null) createEmailGrant(db, OWNER_ID, acct.id, { lookbackDays: o.lookback ?? 90 }, NOW);
  if (o.files) {
    const fa = upsertAccount(db, OWNER_ID, "folder", "project-files", { state: "connected" }, NOW);
    createFilesGrant(db, OWNER_ID, fa.id, [{ providerId: "proj", kind: "folder", label: "proj" }], {}, NOW);
  }
  await worker.syncContext(); await worker.syncContext(); await worker.syncContext();
  return { db, config, mail, engineCalls, sent, clock, worker, files: o.files ?? null };
}

function request(r: Rig, o: { subject?: string; body?: string; threadId?: string | null; messageId?: string } = {}): string {
  const envelope = {
    providerMessageId: o.messageId ?? "req-1", providerThreadId: o.threadId ?? "T1", from: { name: null, email: BOSS }, to: [MAILBOX], subject: o.subject ?? "Re: Maple & Moss kickoff deck",
    receivedAt: "2026-10-26T16:00:00.000Z", bodyText: o.body ?? VAGUE, attachments: [],
  };
  const out = ingestMessage(r.db, { sourceKey: `gmail:test:${envelope.providerMessageId}`, mode: "gmail", integrationId: null, envelope, attachments: [], generationMode: "fixture", fixtureScenario: null }, NOW);
  if (out.kind !== "task") throw new Error("ingest failed");
  return out.taskId;
}

async function thread() {
  const deck = await buildDeckFixture(SLIDES);
  const messages: FixtureMessage[] = [
    { id: "m1", threadId: "T1", from: { email: MAILBOX }, to: [BOSS], subject: "Maple & Moss kickoff deck", body: "Deck attached.", date: day(6), labels: ["SENT"], attachments: [{ filename: "Kickoff Deck.pptx", bytes: deck }] },
    { id: "m2", threadId: "T1", from: { email: BOSS }, to: [MAILBOX], subject: "Re: Maple & Moss kickoff deck", date: day(4),
      body: "From the call:\nChange the fee from $50,000 to $45,000 on slide 2.\nOn slide 3 add the bullet \"Launch review on Friday\".\nMake the whole thing warmer.\n\nOn Tue, Oct 20, 2026 at 10:00 AM Me <me@harbor.example> wrote:\n> Deck attached." },
    { id: "req-1", threadId: "T1", from: { email: BOSS }, to: [MAILBOX], subject: "Re: Maple & Moss kickoff deck", body: VAGUE, date: "2026-10-26T16:00:00.000Z" },
  ];
  return { deck, messages };
}

describe("synthetic end to end: vague email to revised artifact", () => {
  it("resolves the deck and feedback from history, edits the original in place, and reaches review with every requirement accounted for", async () => {
    const { deck, messages } = await thread();
    const r = await rig(messages);
    const taskId = request(r);
    expect(await r.worker.processNextJob()).toBe(true);
    const d = getTaskDetail(r.db, taskId);
    expect(d.task.status).toBe("ready");
    expect(d.artifacts).toHaveLength(1);
    const art = d.artifacts[0]!;
    expect(art).toMatchObject({ format: "pptx", filename: "Kickoff-Deck-revised-r1.pptx" });
    // the artifact is a real revised deck, edited in place from the original
    const out = readFileSync(resolveArtifactPath(r.config.artifactsDir, (r.db.prepare("SELECT rel_path FROM artifacts WHERE id=?").get(art.id) as { rel_path: string }).rel_path)!);
    const text = readDeckBytes(new Uint8Array(out));
    expect(text[1]!.paragraphs[0]).toBe("Fee is $45,000");
    expect(text[2]!.paragraphs.at(-1)).toBe("Launch review on Friday");
    expect(text[0]!.paragraphs).toEqual(readDeckBytes(deck)[0]!.paragraphs);
    // the original is untouched
    const base = r.db.prepare("SELECT blob_rel_path, checksum_sha256 FROM file_versions WHERE blob_rel_path IS NOT NULL").get() as { blob_rel_path: string; checksum_sha256: string };
    expect(sha(readFileSync(resolveArtifactPath(r.config.artifactsDir, base.blob_rel_path)!))).toBe(base.checksum_sha256);
    expect(base.checksum_sha256).toBe(sha(deck));
    // engine saw the resolved context, and no model was needed
    expect(r.engineCalls).toHaveLength(1);
    expect(r.engineCalls[0]!.context?.resolvedTarget.filename).toBe("Kickoff Deck.pptx");
    // requirement accounting
    const reqs = r.db.prepare("SELECT text, status FROM task_requirements WHERE task_id=? ORDER BY ordinal").all(taskId) as Array<{ text: string; status: string }>;
    expect(reqs.map((x) => x.status)).toEqual(["applied", "applied", "unsupported"]);
    expect(r.db.prepare("SELECT fidelity, base_sha256 FROM output_revisions WHERE task_id=?").get(taskId)).toMatchObject({ fidelity: "in_place_edit", base_sha256: sha(deck) });
    // dashboard view
    const view = getContextView(r.db, taskId, NOW)!;
    expect(view.phase).toBe("ready");
    expect(view.phaseLabel).toBe("Ready for review");
    expect(view.target).toMatchObject({ name: "Kickoff Deck.pptx", openable: true });
    expect(view.requirements.map((x) => x.status)).toEqual(["applied", "applied", "unsupported"]);
    expect(view.report?.slides).toEqual({ unchanged: 1, changed: 2, removed: 0, total: 3 });
    expect(view.messages.map((m) => m.role)).toEqual(expect.arrayContaining(["request", "feedback", "deck_message"]));
    expect(d.task.warningCount).toBeGreaterThan(0);
    // delivery: one simulated outbox notification, nothing else
    expect(await r.worker.processNextNotification()).toBe(true);
    expect(getTaskDetail(r.db, taskId).notifications[0]!.state).toBe("simulated");
  });

  it("17. Mark reviewed records the review only: nothing is sent, fetched or overwritten", async () => {
    const { messages } = await thread();
    const r = await rig(messages);
    const taskId = request(r);
    await r.worker.processNextJob(); await r.worker.processNextNotification();
    const before = { notes: r.db.prepare("SELECT COUNT(*) n FROM notifications").get(), sent: r.sent.length, mail: { ...r.mail.calls }, art: r.db.prepare("SELECT sha256 FROM artifacts").all(), tasks: r.db.prepare("SELECT COUNT(*) n FROM tasks").get(), versions: r.db.prepare("SELECT COUNT(*) n FROM file_versions").get() };
    const rev = getTaskDetail(r.db, taskId).task.revision;
    markReviewed(r.db, taskId, rev, "approve", NOW);
    expect(r.db.prepare("SELECT status FROM tasks WHERE id=?").get(taskId)).toMatchObject({ status: "approved" });
    expect(getTaskDetail(r.db, taskId).events.at(-1)!.message).toBe("Marked reviewed. Nothing was sent.");
    expect({ notes: r.db.prepare("SELECT COUNT(*) n FROM notifications").get(), sent: r.sent.length, mail: { ...r.mail.calls }, art: r.db.prepare("SELECT sha256 FROM artifacts").all(), tasks: r.db.prepare("SELECT COUNT(*) n FROM tasks").get(), versions: r.db.prepare("SELECT COUNT(*) n FROM file_versions").get() }).toEqual(before);
    expect(getContextView(r.db, taskId, NOW)!.phaseLabel).toBe("Reviewed. Nothing was sent.");
  });
});

describe("clarification through the worker", () => {
  it("asks which deck without calling the engine, then resolves on the answer reusing the stored search", async () => {
    const a = await buildDeckFixture(SLIDES);
    const b = await buildDeckFixture([{ title: "Results", bullets: ["x"] }, { title: "Pricing", bullets: ["Fee is $50,000"] }]);
    const r = await rig([
      { id: "d1", threadId: "TA", from: { email: BOSS }, to: [MAILBOX], subject: "Proposal deck", body: "Deck", date: "2026-10-19T17:00:00.000Z", attachments: [{ filename: "Proposal Deck.pptx", bytes: a }] },
      { id: "d2", threadId: "TB", from: { email: BOSS }, to: [MAILBOX], subject: "Results deck", body: "Deck", date: "2026-10-22T17:00:00.000Z", attachments: [{ filename: "Results Deck.pptx", bytes: b }] },
    ]);
    const taskId = request(r, { subject: "Revision", threadId: "TX", body: `${VAGUE}\nChange the fee from $50,000 to $45,000 on slide 2.` });
    await r.worker.processNextJob();
    expect(r.engineCalls).toHaveLength(0);
    const d = getTaskDetail(r.db, taskId);
    expect(d.task.status).toBe("needs_input");
    expect(d.questions[0]!.options).toHaveLength(2);
    expect(getContextView(r.db, taskId, NOW)!).toMatchObject({ phase: "needs_input", phaseLabel: "Needs your input", failure: "ambiguous_match" });
    const fetched = r.mail.calls.attachment;
    const choice = d.questions[0]!.options!.find((o) => o.label.startsWith("Proposal"))!;
    submitAnswers(r.db, taskId, 1, [{ questionId: "context_target", answer: choice.id }], NOW);
    await r.worker.processNextJob();
    expect(getTaskDetail(r.db, taskId).task.status).toBe("ready");
    expect(r.mail.calls.attachment).toBe(fetched);
    expect(r.engineCalls).toHaveLength(1);
    expect(r.engineCalls[0]!.context?.resolvedTarget.filename).toBe("Proposal Deck.pptx");
  });
});

describe("15 and 11. restart, retries, revocation and live changes", () => {
  it("a retry after an interrupted attempt resumes the stored context, and a finished job is never replayed", async () => {
    const { messages } = await thread();
    let attempts = 0;
    const r = await rig(messages, { engine: async (i, d) => { attempts += 1; if (attempts === 1) throw Object.assign(new Error("flaky"), { code: "TEMP", retryable: true }); return runWork(i, d); } });
    const taskId = request(r);
    await r.worker.processNextJob();
    expect(getTaskDetail(r.db, taskId).task.status).toBe("queued");
    const mailBefore = { ...r.mail.calls };
    r.clock.t += 60_000;
    await r.worker.processNextJob();
    expect(getTaskDetail(r.db, taskId).task.status).toBe("ready");
    expect(r.mail.calls).toEqual(mailBefore); // second attempt used the stored retrieval, no provider traffic
    expect(attempts).toBe(2);
    expect(r.db.prepare("SELECT COUNT(*) n FROM artifacts").get()).toMatchObject({ n: 1 });
    expect(await r.worker.processNextJob()).toBe(false);
    recoverExpiredJobs(r.db, new Date(r.clock.t + 3_600_000));
    expect(await r.worker.processNextJob()).toBe(false);
    expect(attempts).toBe(2);
    expect(r.db.prepare("SELECT COUNT(*) n FROM output_revisions").get()).toMatchObject({ n: 1 });
  });

  it("a provider timeout while reading history is retried, not reported as 'no presentation found'", async () => {
    const { messages } = await thread();
    const r = await rig(messages);
    const { ProviderError } = await import("@afterhours/data");
    r.mail.failures.push(new ProviderError("temporary", "The mailbox could not be reached."));
    const taskId = request(r);
    await r.worker.processNextJob();
    const d = getTaskDetail(r.db, taskId);
    expect(d.task.status).toBe("queued");
    expect(d.events.some((e) => /Retrying automatically/.test(e.message))).toBe(true);
    expect(d.questions).toEqual([]);
    r.clock.t += 60_000;
    await r.worker.processNextJob();
    expect(getTaskDetail(r.db, taskId).task.status).toBe("ready");
  });

  it("a grant revoked while the revision is being prepared stops the task: nothing is published or announced", async () => {
    const { messages } = await thread();
    let rr: Rig | null = null;
    const r = await rig(messages, { engine: async (i, d) => { const g = activeGrants(rr!.db, OWNER_ID, (rr!.db.prepare("SELECT id FROM connected_accounts WHERE provider='gmail'").get() as { id: string }).id, "email", NOW)[0]!; revokeGrant(rr!.db, OWNER_ID, g.id, "user", NOW); return runWork(i, d); } });
    rr = r;
    const taskId = request(r);
    await r.worker.processNextJob();
    const d = getTaskDetail(r.db, taskId);
    expect(d.task.status).toBe("failed");
    expect(d.task.error).toMatchObject({ code: "CONTEXT_ACCESS_REVOKED", retryable: false });
    expect(d.artifacts).toEqual([]);
    expect(d.notifications).toEqual([]);
    expect(getContextView(r.db, taskId, NOW)).toMatchObject({ phase: "error" });
  });

  it("a live file that changes before generation is revalidated: the version actually used is recorded and shown", async () => {
    const deck = await buildDeckFixture(SLIDES);
    const files = new MemoryFileProvider("folder", [
      { id: "proj", name: "proj", parent: null, folder: true },
      { id: "proj/Kickoff Deck.pptx", name: "Kickoff Deck.pptx", parent: "proj", content: deck },
    ]);
    const newer = await buildDeckFixture([SLIDES[0]!, { title: "Pricing", bullets: ["Fee is $50,000", "Added line"] }, SLIDES[2]!]);
    const r = await rig([], { files, lookback: null });
    const open = files.open.bind(files);
    let opened = 0;
    files.open = async (id) => { const res = await open(id); opened += 1; if (opened === 1) files.setContent(id, newer); return res; }; // moves on right after it is read
    const taskId = request(r, { subject: "Kickoff Deck", threadId: null, body: "Please revise the Kickoff Deck presentation. Change the fee from $50,000 to $45,000 on slide 2." });
    await r.worker.processNextJob();
    const d = getTaskDetail(r.db, taskId);
    expect(d.task.status).toBe("ready");
    expect(r.engineCalls[0]!.context!.resolvedTarget.versionKey).toBe("r2");
    expect(r.engineCalls[0]!.context!.resolvedTarget.sha256).toBe(sha(newer));
    expect(d.events.some((e) => /changed after it was selected/.test(e.message))).toBe(true);
    const view = getContextView(r.db, taskId, NOW)!;
    expect(view.target).toMatchObject({ versionKey: "r2", changedSinceSelection: true });
    expect(view.report!.baseSha256).toBe(sha(newer));
    expect(r.db.prepare("SELECT COUNT(*) n FROM file_versions WHERE version_key IN ('r1','r2')").get()).toMatchObject({ n: 2 });
  });

  it("requests that are not revisions run exactly as before, with no context lookup", async () => {
    const r = await rig([]);
    const { injectTask } = await import("@afterhours/data/testing");
    const taskId = injectTask(r.db, r.config, "plain", NOW);
    await r.worker.processNextJob();
    expect(getTaskDetail(r.db, taskId).task.status).toBe("ready");
    expect(r.engineCalls[0]!.context).toBeUndefined();
    expect(r.db.prepare("SELECT COUNT(*) n FROM retrieval_runs").get()).toMatchObject({ n: 0 });
  });
});
