// Batch 4 worker wiring. The engine, the delivery adapter and Gmail are MOCKS here (spies / in-memory).
// These tests prove platform behaviour around them; they do not prove a live model, live Google or a
// live WhatsApp send.
import { describe, expect, it } from "vitest";
import type { DeliveryInput, DeliveryResult, EngineDependencies, EngineInput, EngineResult } from "@afterhours/contracts";
import {
  getTaskDetail, getTaskSummary, listNotifications, patchSettings, saveGmailConnection, type AppConfig, type GmailApi,
} from "@afterhours/data";
import { injectTask, makeTestConfig, makeTestDb, readyResult, testPlan } from "@afterhours/data/testing";
import { createWorker, redact } from "../src/worker";

type Engine = (i: EngineInput, d: EngineDependencies) => Promise<EngineResult>;
const silent = () => undefined;
const T0 = new Date("2026-10-20T17:00:00Z");

function make(opts: { config?: AppConfig; engine?: Engine; send?: (i: DeliveryInput) => Promise<DeliveryResult>; gmail?: GmailApi; now?: () => Date } = {}) {
  const { db, config } = makeTestDb(opts.config ?? makeTestConfig());
  const engineCalls: EngineInput[] = [];
  const sendCalls: DeliveryInput[] = [];
  const engine: Engine = opts.engine ?? (async (i) => readyResult(i));
  const worker = createWorker({
    db, config, workerId: "w-b4", log: silent, now: opts.now,
    runWork: async (i, d) => { engineCalls.push(i); return engine(i, d); },
    sendNotification: async (i) => { sendCalls.push(i); return opts.send ? opts.send(i) : { state: "simulated", message: "m", providerMessageId: null, reason: null }; },
    makeGmailApi: opts.gmail ? () => opts.gmail! : undefined,
  });
  return { db, config, worker, engineCalls, sendCalls };
}

const LIVE_WA = {
  NOTIFICATION_CHANNEL: "whatsapp",
  TWILIO_ACCOUNT_SID: "AC-test", TWILIO_AUTH_TOKEN: "tok-test", TWILIO_WHATSAPP_FROM: "whatsapp:+15550000000",
  TWILIO_WHATSAPP_TO: "+15551234567", WHATSAPP_USE_CASE_ELIGIBLE: "true",
};

async function readyWithNotification(m: ReturnType<typeof make>, channel: "outbox" | "whatsapp" = "whatsapp") {
  patchSettings(m.db, { notifications: { channel } }, new Date());
  const taskId = injectTask(m.db, m.config, `k-${Math.random()}`, new Date(Date.now() - 5000));
  await m.worker.processNextJob();
  expect(getTaskSummary(m.db, taskId).status).toBe("ready");
  return taskId;
}
const notif = (m: ReturnType<typeof make>, taskId: string) => listNotifications(m.db, null, 30).items.find((n) => n.taskId === taskId)!;

describe("WhatsApp operator policy is enforced before the adapter runs", () => {
  const cases: Array<[string, Record<string, string>, RegExp]> = [
    ["no Twilio credentials", { NOTIFICATION_CHANNEL: "whatsapp" }, /not configured on the server/],
    ["not eligible", { ...LIVE_WA, WHATSAPP_USE_CASE_ELIGIBLE: "false" }, /eligible/],
    ["no designated recipient", { ...LIVE_WA, TWILIO_WHATSAPP_TO: "" }, /designated/],
    ["window closed, no template", LIVE_WA, /window is closed/],
  ];
  for (const [label, env, reason] of cases) {
    it(`${label}: blocked, adapter not called, not retried, result still reviewable`, async () => {
      const m = make({ config: makeTestConfig(env) });
      const taskId = await readyWithNotification(m);
      expect(await m.worker.processNextNotification()).toBe(true);
      expect(m.sendCalls).toHaveLength(0);
      const n = notif(m, taskId);
      expect(n.state).toBe("blocked");
      expect(n.lastError).toMatch(reason);
      expect(await m.worker.processNextNotification()).toBe(false); // terminal: no retry loop
      expect(getTaskSummary(m.db, taskId).status).toBe("ready");
      expect(getTaskDetail(m.db, taskId).artifacts).toHaveLength(2);
    });
  }

  it("a browser-edited recipient that is not the designated test recipient is refused", async () => {
    const m = make({ config: makeTestConfig({ ...LIVE_WA, TWILIO_CONTENT_SID: "HX-test" }) });
    patchSettings(m.db, { notifications: { recipient: "+15559999999" } }, new Date());
    const taskId = await readyWithNotification(m);
    await m.worker.processNextNotification();
    expect(m.sendCalls).toHaveLength(0);
    expect(notif(m, taskId)).toMatchObject({ state: "blocked", lastError: expect.stringMatching(/not the operator-designated/) });
  });

  it("eligible + template: adapter gets designated recipient and operator policy; accepted is recorded as accepted, not delivered", async () => {
    const m = make({
      config: makeTestConfig({ ...LIVE_WA, TWILIO_CONTENT_SID: "HX-test" }),
      send: async () => ({ state: "accepted", message: "sent", providerMessageId: "SM-test-1", reason: null }),
    });
    const taskId = await readyWithNotification(m);
    await m.worker.processNextNotification();
    expect(m.sendCalls).toHaveLength(1);
    expect(m.sendCalls[0]).toMatchObject({
      channel: "whatsapp", recipient: "+15551234567",
      deliveryPolicy: { eligible: true, customerServiceWindowOpen: false, approvedContentSid: "HX-test" },
    });
    expect(notif(m, taskId)).toMatchObject({ state: "accepted", providerMessageId: "SM-test-1" });
  });

  it("open customer-service window is computed from operator config", async () => {
    const until = new Date(Date.now() + 3600_000).toISOString();
    const m = make({
      config: makeTestConfig({ ...LIVE_WA, WHATSAPP_CUSTOMER_SERVICE_WINDOW_UNTIL: until }),
      send: async () => ({ state: "accepted", message: "sent", providerMessageId: "SM-2", reason: null }),
    });
    await readyWithNotification(m);
    await m.worker.processNextNotification();
    expect(m.sendCalls[0]!.deliveryPolicy).toMatchObject({ customerServiceWindowOpen: true, approvedContentSid: null });
  });

  it("accepted without a provider id, and DELIVERY_UNCERTAIN, both end failed and are never resent", async () => {
    const noId = make({ config: makeTestConfig({ ...LIVE_WA, TWILIO_CONTENT_SID: "HX" }), send: async () => ({ state: "accepted", message: "?", providerMessageId: null, reason: null }) });
    const t1 = await readyWithNotification(noId);
    await noId.worker.processNextNotification();
    expect(notif(noId, t1)).toMatchObject({ state: "failed", lastError: expect.stringMatching(/DELIVERY_UNCERTAIN/) });
    expect(await noId.worker.processNextNotification()).toBe(false);

    const uncertain = make({
      config: makeTestConfig({ ...LIVE_WA, TWILIO_CONTENT_SID: "HX" }),
      send: async () => { throw Object.assign(new Error("timeout after submit"), { code: "DELIVERY_UNCERTAIN", retryable: true }); },
    });
    const t2 = await readyWithNotification(uncertain);
    await uncertain.worker.processNextNotification();
    expect(notif(uncertain, t2)).toMatchObject({ state: "failed", lastError: expect.stringMatching(/DELIVERY_UNCERTAIN/) });
    expect(uncertain.sendCalls).toHaveLength(1);
    expect(await uncertain.worker.processNextNotification()).toBe(false);
    expect(getTaskSummary(uncertain.db, t2).status).toBe("ready"); // the result is never regenerated
  });

  it("outbox stays simulated and makes no provider call even when WhatsApp credentials exist", async () => {
    const m = make({ config: makeTestConfig(LIVE_WA) });
    const taskId = await readyWithNotification(m, "outbox");
    await m.worker.processNextNotification();
    expect(notif(m, taskId).state).toBe("simulated");
  });
});

describe("live model wiring: no fixture fallback", () => {
  const liveTask = async (env: Record<string, string>, engine?: Engine) => {
    const m = make({ config: makeTestConfig({ GENERATION_MODE: "live", ...env }), engine });
    const taskId = injectTask(m.db, m.config, `live-${Math.random()}`, new Date(Date.now() - 5000));
    await m.worker.processNextJob();
    return { ...m, taskId };
  };

  it("Claude without key or model, or any other provider -> MODEL_NOT_CONFIGURED; engine never called", async () => {
    for (const [env, code] of [
      [{ MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }, "MODEL_NOT_CONFIGURED"],
      [{ MODEL_PROVIDER: "anthropic", MODEL_NAME: "m" }, "MODEL_NOT_CONFIGURED"],
      [{ MODEL_PROVIDER: "fixture", ANTHROPIC_API_KEY: "k", MODEL_NAME: "m" }, "MODEL_NOT_CONFIGURED"],
    ] as const) {
      const m = await liveTask(env);
      expect(m.engineCalls).toHaveLength(0);
      expect(getTaskSummary(m.db, m.taskId)).toMatchObject({ status: "failed", generationMode: "live", error: { code, retryable: false } });
      expect(getTaskDetail(m.db, m.taskId).artifacts).toHaveLength(0);
      expect(getTaskDetail(m.db, m.taskId).notifications).toHaveLength(0);
    }
  });

  it("configured Claude (anthropic) live task reaches the engine with mode=live (engine mocked)", async () => {
    const m = await liveTask({ MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", MODEL_NAME: "claude-x" });
    expect(m.engineCalls).toHaveLength(1);
    expect(m.engineCalls[0]!.mode).toBe("live");
    expect(getTaskSummary(m.db, m.taskId).status).toBe("ready");
  });

  it("engine/provider error text is redacted before it is stored", async () => {
    const m = await liveTask({ MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", MODEL_NAME: "x" }, async () => {
      throw Object.assign(new Error("Anthropic said: invalid key sk-proj-ABCDEFGHIJKL1234 with Bearer abc.def.ghi"), { code: "MODEL_AUTHENTICATION", retryable: false });
    });
    const err = getTaskSummary(m.db, m.taskId).error!;
    expect(err.code).toBe("MODEL_AUTHENTICATION");
    expect(err.message).not.toMatch(/sk-proj-ABC|abc\.def\.ghi/);
    expect(redact("token ya29.a0AfH6SMBxyz and 1//0gAbCdEfGhIjKlMn")).toBe("token [redacted] and [redacted]");
  });

  it("retryable provider failure retries once within the revision, then fails honestly (no fake ready)", async () => {
    let calls = 0;
    const clock = { t: Date.now() };
    const m = make({
      config: makeTestConfig({ GENERATION_MODE: "live", MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", MODEL_NAME: "x" }),
      now: () => new Date(clock.t),
      engine: async () => { calls++; throw Object.assign(new Error("Anthropic returned HTTP 503."), { code: "MODEL_PROVIDER", retryable: true }); },
    });
    const taskId = injectTask(m.db, m.config, "outage", new Date(clock.t - 5000));
    await m.worker.processNextJob();
    expect(getTaskSummary(m.db, taskId).status).toBe("queued");
    clock.t += 31_000;
    await m.worker.processNextJob();
    expect(calls).toBe(2);
    expect(getTaskSummary(m.db, taskId)).toMatchObject({ status: "failed", revision: 1, error: { code: "MODEL_PROVIDER", retryable: true } });
    expect(getTaskDetail(m.db, taskId).artifacts).toHaveLength(0);
  });
});

describe("organization snapshot reaches the engine", () => {
  it("a settings edit after ingestion does not change a queued task's organization; new tasks get the edit", async () => {
    const m = make();
    const first = injectTask(m.db, m.config, "snap-1", new Date(Date.now() - 5000));
    patchSettings(m.db, { organization: { name: "Renamed Studio" } }, new Date());
    const second = injectTask(m.db, m.config, "snap-2", new Date(Date.now() - 4000));
    await m.worker.processNextJob();
    await m.worker.processNextJob();
    const byTask = new Map(m.engineCalls.map((c) => [c.taskId, c.organization.name]));
    expect(byTask.get(first)).not.toBe("Renamed Studio");
    expect(byTask.get(second)).toBe("Renamed Studio");
  });
});

describe("mocked Gmail -> worker chain (platform wiring only)", () => {
  it("allowed sender mail becomes a gmail/live task, reaches the engine once, ready with files; spam reaches nothing", async () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    const mk = (id: string, from: string, ms: number) => ({
      id, threadId: id, internalDate: String(ms), labelIds: ["INBOX"],
      payload: { mimeType: "multipart/mixed", headers: [{ name: "From", value: from }, { name: "Subject", value: `Proposal ${id}` }],
        parts: [{ partId: "0", mimeType: "text/plain", body: { data: b64("Please prepare a proposal and deck.") } }] },
    });
    const now = Date.now();
    const msgs = [mk("g1", "Boss <boss@client.test>", now + 1000), mk("g2", "spam@else.test", now + 2000)];
    const gmail: GmailApi = {
      getProfileEmail: async () => "inbox@test.dev",
      listInbox: async () => ({ ids: msgs.map((x) => x.id).reverse(), nextPageToken: null }),
      getMessage: async (id) => msgs.find((x) => x.id === id)!,
      getAttachment: async () => Buffer.alloc(0),
    };
    const m = make({
      config: makeTestConfig({ GENERATION_MODE: "live", MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", MODEL_NAME: "x" }),
      gmail,
      now: () => new Date(now + 10_000),
      engine: async (i, d) => { await d.onProgress({ stage: "plan", message: "Planned", plan: testPlan() }); return readyResult(i); },
    });
    saveGmailConnection(m.db, m.config.tokenEncryptionKey, { account: "inbox@test.dev", tokens: { refresh_token: "r" } }, new Date(now));
    patchSettings(m.db, { allowedSenders: ["boss@client.test"] }, new Date(now));
    expect(await m.worker.pollInbox()).toMatchObject({ status: "ok", ingested: 1, ignored: 1 });
    await m.worker.processNextJob();
    expect(await m.worker.processNextJob()).toBe(false);
    expect(m.engineCalls).toHaveLength(1);
    expect(m.engineCalls[0]!.email.from.email).toBe("boss@client.test");
    expect(m.engineCalls[0]!.fixtureScenario).toBeNull();
    const id = m.engineCalls[0]!.taskId;
    expect(getTaskSummary(m.db, id)).toMatchObject({ status: "ready", ingestionMode: "gmail", generationMode: "live", artifactCount: 2 });
    void T0;
  });
});
