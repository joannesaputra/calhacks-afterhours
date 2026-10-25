import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  OWNER_ID, ProviderRegistry, createEmailGrant, getTaskDetail, ingestMessage, patchSettings, resolveContext, runSyncUntilIdle, saveGmailConnection, DEFAULT_LIMITS, upsertAccount,
  type AppConfig, type Db,
} from "@afterhours/data";
import { makeTestConfig, makeTestDb, MemoryMailProvider } from "@afterhours/data/testing";
import { PARSER_VERSION, extractDocument } from "@afterhours/engine";
import { buildDeckFixture } from "@afterhours/engine/testing";
import { buildApp } from "../src/app";

const ORIGIN = "http://localhost:3000";
const NOW = new Date("2026-10-26T16:05:00.000Z");
let app: FastifyInstance;
afterEach(async () => { await app?.close(); });

async function setup(env: Record<string, string> = {}) {
  const config: AppConfig = makeTestConfig(env);
  const { db } = makeTestDb(config);
  app = await buildApp({ config, db, rateLimit: false });
  const r = await app.inject({ method: "POST", url: "/v1/session", headers: { origin: ORIGIN }, payload: { password: "correct-horse-battery" } });
  const cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
  const call = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie, origin: ORIGIN }, payload: payload as never });
  return { db, config, call, cookie };
}

function connectGmail(db: Db, config: AppConfig) {
  saveGmailConnection(db, config.tokenEncryptionKey, { account: "me@harbor.example", tokens: { access_token: "a", refresh_token: "b" } }, new Date(NOW.getTime() - 100 * 86_400_000));
}

describe("context API: grants, consent and honest limits", () => {
  it("requires a session for every context route", async () => {
    await setup();
    for (const [m, u] of [["GET", "/v1/context"], ["POST", "/v1/context/grants"], ["DELETE", "/v1/context/grants/x"], ["POST", "/v1/context/grants/x/purge"], ["GET", "/v1/context/folders"], ["GET", "/v1/tasks/x/context"], ["POST", "/v1/tasks/x/context/corrections"], ["GET", "/v1/context/emails/x"], ["GET", "/v1/context/files/x/download"]] as const) {
      const r = await app.inject({ method: m, url: u, headers: { origin: ORIGIN }, payload: m === "GET" ? undefined : {} });
      expect(r.statusCode, `${m} ${u}`).toBe(401);
    }
  });

  it("will not grant email history before Gmail is connected, and offers the upload route instead", async () => {
    const { call } = await setup();
    const r = await call("POST", "/v1/context/grants", { kind: "email", lookbackDays: 90 });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: "GMAIL_NOT_CONNECTED" });
    expect(r.json().error.message).toMatch(/attach files to emails/);
    const s = (await call("GET", "/v1/context")).json().data;
    expect(s.suggestedLookbackDays).toBe(90);
    expect(s.uploadFallback).toMatch(/attach the presentation/);
    expect(s.providers.find((p: { provider: string }) => p.provider === "drive")).toMatchObject({ available: false, limitation: expect.stringMatching(/not connected/) });
    expect(s.providers.find((p: { provider: string }) => p.provider === "gmail").scopeNote).toMatch(/whole mailbox/);
  });

  it("grants a bounded email lookback, reports coverage honestly, revokes at once, and purges only after revocation", async () => {
    const { db, config, call } = await setup();
    connectGmail(db, config);
    const created = await call("POST", "/v1/context/grants", { kind: "email", lookbackDays: 60 });
    expect(created.statusCode).toBe(200);
    const s1 = (await call("GET", "/v1/context")).json().data;
    expect(s1.accounts[0]).toMatchObject({ provider: "gmail", account: "me@harbor.example", coverage: { complete: false } });
    expect(s1.accounts[0].coverage.note).toMatch(/not authorized|still running|Results may be missing/i);
    expect(s1.grants[0]).toMatchObject({ kind: "email", lookbackDays: 60, active: true });
    expect((await call("POST", `/v1/context/grants/${created.json().data.id}/purge`)).statusCode).toBe(409);
    expect((await call("DELETE", `/v1/context/grants/${created.json().data.id}`)).statusCode).toBe(200);
    expect((await call("GET", "/v1/context")).json().data.grants[0]).toMatchObject({ active: false });
    expect((await call("POST", `/v1/context/grants/${created.json().data.id}/purge`)).statusCode).toBe(200);
    expect((await call("DELETE", "/v1/context/grants/nope")).statusCode).toBe(404);
    expect((await call("POST", "/v1/context/grants", { kind: "email", lookbackDays: 0 })).statusCode).toBe(400);
  });

  it("disconnecting Gmail revokes the history grant", async () => {
    const { db, config, call } = await setup();
    connectGmail(db, config);
    await call("POST", "/v1/context/grants", { kind: "email", lookbackDays: 30 });
    await call("DELETE", "/v1/integrations/gmail");
    expect((await call("GET", "/v1/context")).json().data.grants[0]).toMatchObject({ active: false });
  });

  it("offers local folders only inside the configured root, refuses links and Drive, and names who enforces the restriction", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ah-api-root-"));
    mkdirSync(path.join(root, "proj")); mkdirSync(path.join(root, "other"));
    writeFileSync(path.join(root, "proj", "a.pptx"), "x");
    symlinkSync(path.join(root, "other"), path.join(root, "proj", "link"));
    const { call } = await setup({ CONTEXT_FILES_ROOT: root });
    const list = (await call("GET", "/v1/context/folders")).json().data;
    expect(list).toMatchObject({ available: true });
    expect(list.entries.map((e: { name: string }) => e.name).sort()).toEqual(["other", "proj"]);
    expect((await call("GET", "/v1/context/folders?parent=../")).statusCode).toBe(400);
    const sub = (await call("GET", "/v1/context/folders?parent=proj")).json().data;
    expect(sub.entries.map((e: { name: string }) => e.name)).toEqual(["a.pptx"]); // the symbolic link is not offered
    expect((await call("POST", "/v1/context/grants", { kind: "files", provider: "folder", selected: [{ providerId: "proj/link", kind: "folder", label: "link" }] })).statusCode).toBe(400);
    expect((await call("POST", "/v1/context/grants", { kind: "files", provider: "folder", selected: [{ providerId: "../etc", kind: "folder", label: "x" }] })).statusCode).toBe(400);
    expect((await call("POST", "/v1/context/grants", { kind: "files", provider: "drive", selected: [{ providerId: "x", kind: "folder", label: "x" }] })).json().error.code).toBe("PROVIDER_UNAVAILABLE");
    const ok = await call("POST", "/v1/context/grants", { kind: "files", provider: "folder", selected: [{ providerId: "proj", kind: "folder", label: "proj" }] });
    expect(ok.statusCode).toBe(200);
    const s = (await call("GET", "/v1/context")).json().data;
    expect(s.grants[0]).toMatchObject({ kind: "files", selected: [{ providerId: "proj" }] });
    expect(s.providers.find((p: { provider: string }) => p.provider === "folder").scopeNote).toMatch(/enforced by Afterhours/);
  });

  it("reports that no folder source exists when none is configured", async () => {
    const { call } = await setup();
    expect((await call("GET", "/v1/context/folders")).json().data).toMatchObject({ available: false, limitation: expect.stringMatching(/CONTEXT_FILES_ROOT/) });
    expect((await call("POST", "/v1/context/grants", { kind: "files", provider: "folder", selected: [{ providerId: "x", kind: "folder", label: "x" }] })).json().error.code).toBe("PROVIDER_UNAVAILABLE");
  });
});

describe("context API: evidence, corrections and source access on a task", () => {
  async function ambiguousTask() {
    const t = await setup();
    connectGmail(t.db, t.config);
    patchSettings(t.db, { allowedSenders: ["jordan@harbor.example"] }, NOW);
    const account = upsertAccount(t.db, OWNER_ID, "gmail", "me@harbor.example", { state: "connected" }, NOW);
    createEmailGrant(t.db, OWNER_ID, account.id, { lookbackDays: 90 }, NOW);
    const a = await buildDeckFixture([{ title: "Proposal", bullets: ["x"] }, { title: "Pricing", bullets: ["Fee is $50,000"] }]);
    const b = await buildDeckFixture([{ title: "Results", bullets: ["y"] }, { title: "Pricing", bullets: ["Fee is $50,000"] }]);
    const d = (n: number) => new Date(NOW.getTime() - (n === 5 ? 7 : 4) * 86_400_000).toISOString();
    const mail = new MemoryMailProvider("me@harbor.example", [
      { id: "d1", threadId: "TA", from: { email: "jordan@harbor.example" }, to: ["me@harbor.example"], subject: "Proposal deck", body: "Deck", date: d(5), attachments: [{ filename: "Proposal Deck.pptx", bytes: a }] },
      { id: "d2", threadId: "TB", from: { email: "jordan@harbor.example" }, to: ["me@harbor.example"], subject: "Results deck", body: "Deck", date: d(3), attachments: [{ filename: "Results Deck.pptx", bytes: b }] },
    ]);
    await runSyncUntilIdle({ db: t.db, ownerId: OWNER_ID, accountId: account.id, provider: mail, now: () => NOW, limits: DEFAULT_LIMITS }, 20);
    const envelope = { providerMessageId: "req", providerThreadId: "TX", from: { name: null, email: "jordan@harbor.example" }, to: ["me@harbor.example"], subject: "Revision", receivedAt: "2026-10-26T16:00:00.000Z",
      bodyText: "Can you revise the presentation from last week? Change the fee from $50,000 to $45,000 on slide 2.", attachments: [] };
    const out = ingestMessage(t.db, { sourceKey: "gmail:t:req", mode: "gmail", integrationId: null, envelope, attachments: [], generationMode: "fixture", fixtureScenario: null }, NOW);
    if (out.kind !== "task") throw new Error("ingest");
    const deps = { artifactsDir: t.config.artifactsDir, extract: extractDocument, parserVersion: PARSER_VERSION, providers: new ProviderRegistry({}, () => mail) };
    const outcome = await resolveContext(deps, { db: t.db, taskId: out.taskId, revision: 1, now: NOW, envelope, attachments: [], timezone: "UTC", answers: [], useAccount: true });
    if (outcome.kind === "needs_input") {
      t.db.prepare("UPDATE tasks SET status='needs_input', questions_json=? WHERE id=?").run(JSON.stringify(outcome.questions), out.taskId);
    }
    return { ...t, taskId: out.taskId, outcome, account, deps, mail, envelope };
  }

  it("shows the candidates, messages and reasons, lets the user pick a file, and queues a new revision that reuses the search", async () => {
    const t = await ambiguousTask();
    expect(t.outcome.kind).toBe("needs_input");
    const view = (await t.call("GET", `/v1/tasks/${t.taskId}/context`)).json().data;
    expect(view.candidates.map((c: { name: string }) => c.name).sort()).toEqual(["Proposal Deck.pptx", "Results Deck.pptx"]);
    expect(view.candidates.every((c: { openable: boolean }) => c.openable)).toBe(true);
    expect(view.messages.map((m: { role: string }) => m.role)).toContain("request");
    expect(view.failure).toBe("ambiguous_match");
    const pick = view.candidates.find((c: { name: string }) => c.name === "Results Deck.pptx");
    // a file that was not found for this request cannot be selected (no cross-task or arbitrary ids)
    const bad = await t.call("POST", `/v1/tasks/${t.taskId}/context/corrections`, { action: "select_file", revision: 1, fileVersionId: "00000000-0000-0000-0000-000000000000" });
    expect(bad.statusCode).toBe(400);
    const stale = await t.call("POST", `/v1/tasks/${t.taskId}/context/corrections`, { action: "select_file", revision: 9, fileVersionId: pick.versionId });
    expect(stale.statusCode).toBe(409);
    const ok = await t.call("POST", `/v1/tasks/${t.taskId}/context/corrections`, { action: "select_file", revision: 1, fileVersionId: pick.versionId });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ status: "queued", revision: 2 });
    expect(getTaskDetail(t.db, t.taskId).events.at(-1)!.message).toMatch(/Context corrected \(Use Results Deck\.pptx\)/);
    const second = await resolveContext(t.deps, { db: t.db, taskId: t.taskId, revision: 2, now: NOW, envelope: t.envelope, attachments: [], timezone: "UTC", answers: [], useAccount: true });
    expect(second.kind).toBe("resolved");
    if (second.kind === "resolved") expect(second.bundle.resolvedTarget.filename).toBe("Results Deck.pptx");
    expect(t.db.prepare("SELECT reused_from_revision r FROM retrieval_runs WHERE revision=2").get()).toMatchObject({ r: 1 });
    const v2 = (await t.call("GET", `/v1/tasks/${t.taskId}/context`)).json().data;
    expect(v2.corrections.map((c: { label: string }) => c.label)).toEqual(["You chose a different file"]);
  });

  it("removes a source, supplies missing feedback, and refuses corrections on a closed task", async () => {
    const t = await ambiguousTask();
    const view = (await t.call("GET", `/v1/tasks/${t.taskId}/context`)).json().data;
    const file = view.candidates[0];
    const rm = await t.call("POST", `/v1/tasks/${t.taskId}/context/corrections`, { action: "exclude_source", revision: 1, sourceType: "file", sourceId: file.fileId });
    expect(rm.statusCode).toBe(200);
    expect((await t.call("POST", `/v1/tasks/${t.taskId}/context/corrections`, { action: "add_feedback", revision: 2, text: "Too early: still queued" })).statusCode).toBe(409);
    t.db.prepare("UPDATE tasks SET status='needs_input' WHERE id=?").run(t.taskId); // the worker would have asked again
    const fb = await t.call("POST", `/v1/tasks/${t.taskId}/context/corrections`, { action: "add_feedback", revision: 2, text: "Change the fee from $50,000 to $40,000 on slide 2." });
    expect(fb.statusCode).toBe(200);
    expect((await t.call("POST", `/v1/tasks/${t.taskId}/context/corrections`, { action: "add_feedback", revision: 3, text: "x" })).statusCode).toBe(400);
    t.db.prepare("UPDATE tasks SET status='dismissed' WHERE id=?").run(t.taskId);
    expect((await t.call("POST", `/v1/tasks/${t.taskId}/context/corrections`, { action: "add_feedback", revision: 3, text: "Another change please" })).statusCode).toBe(409);
  });

  it("opens a message or file only while the grant allows it", async () => {
    const t = await ambiguousTask();
    const view = (await t.call("GET", `/v1/tasks/${t.taskId}/context`)).json().data;
    const cand = view.candidates[0];
    const dl = await t.call("GET", `/v1/context/files/${cand.versionId}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-disposition"]).toMatch(/attachment; filename=/);
    expect(dl.headers["cache-control"]).toBe("private, no-store");
    const emailId = (t.db.prepare("SELECT id FROM emails LIMIT 1").get() as { id: string }).id;
    expect((await t.call("GET", `/v1/context/emails/${emailId}`)).json().data).toMatchObject({ subject: expect.any(String), text: expect.any(String) });
    const grant = (await t.call("GET", "/v1/context")).json().data.grants[0];
    await t.call("DELETE", `/v1/context/grants/${grant.id}`);
    expect((await t.call("GET", `/v1/context/emails/${emailId}`)).statusCode).toBe(404);
    expect((await t.call("GET", `/v1/context/files/${cand.versionId}/download`)).statusCode).toBe(404);
    const after = (await t.call("GET", `/v1/tasks/${t.taskId}/context`)).json().data;
    expect(after.candidates.every((c: { openable: boolean }) => c.openable === false)).toBe(true);
    expect(after.messages.filter((m: { id: string }) => !m.id.startsWith("current-")).every((m: { excerpt: string }) => m.excerpt === "")).toBe(true);
  });

  it("returns no context view for a task that is not a revision request", async () => {
    const t = await setup();
    const { injectTask } = await import("@afterhours/data/testing");
    const id = injectTask(t.db, t.config, "plain", NOW);
    expect((await t.call("GET", `/v1/tasks/${id}/context`)).json()).toEqual({ data: null });
    expect((await t.call("GET", "/v1/tasks/nope/context")).statusCode).toBe(404);
  });
});
