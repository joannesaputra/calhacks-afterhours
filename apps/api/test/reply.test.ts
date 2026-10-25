// Send-back routes. Google is always a test double here: no message is ever sent anywhere real.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { GMAIL_SEND_SCOPE, type GmailApi, type GmailTokens } from "@afterhours/data";
import { makeTestConfig, makeTestDb, seedApprovedReply } from "@afterhours/data/testing";
import { buildApp } from "../src/app";
import type { GmailOAuthPort } from "../src/routes/integrations";

const ORIGIN = "http://localhost:3000";
const GOOGLE = { GOOGLE_CLIENT_ID: "test-client.apps.example", GOOGLE_CLIENT_SECRET: "test-client-secret" };
const READ = "https://www.googleapis.com/auth/gmail.readonly";
let app: FastifyInstance;
afterEach(async () => { await app?.close(); });

function doubleApi() {
  const sent: string[] = [];
  const api: GmailApi = {
    getProfileEmail: async () => "me@acme.example",
    listInbox: async () => ({ ids: [], nextPageToken: null }),
    getAttachment: async () => Buffer.alloc(0),
    getMessage: async () => ({ id: "msg-1", threadId: "thr-1", internalDate: "0", labelIds: [], payload: { mimeType: "text/plain", headers: [{ name: "Message-ID", value: "<o@client.example>" }] } }),
    sendMessage: async (raw) => { sent.push(raw.toString("utf8")); return { id: `s${sent.length}`, threadId: "thr-1" }; },
  };
  return { api, sent };
}

async function setup(seedOpts: Parameters<typeof seedApprovedReply>[2] = {}, env: Record<string, string> = {}, oauth?: GmailOAuthPort) {
  const config = makeTestConfig(env);
  const { db } = makeTestDb(config);
  const seed = seedApprovedReply(db, config, seedOpts);
  const d = doubleApi();
  app = await buildApp({ config, db, rateLimit: false, gmailOAuth: oauth, makeGmailApi: (_t: GmailTokens, _on) => d.api });
  const r = await app.inject({ method: "POST", url: "/v1/session", headers: { origin: ORIGIN }, payload: { password: "correct-horse-battery" } });
  const cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
  const call = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown, origin: string | null = ORIGIN) =>
    app.inject({ method, url, headers: { cookie, ...(origin ? { origin } : {}) }, payload: payload as never });
  return { db, config, seed, d, call, cookie };
}

describe("reply routes", () => {
  it("require a session, and sending also requires the app's own origin", async () => {
    const t = await setup();
    for (const method of ["GET", "POST"] as const) {
      const r = await app.inject({ method, url: `/v1/tasks/${t.seed.taskId}/reply`, headers: { origin: ORIGIN }, payload: method === "POST" ? {} : undefined });
      expect(r.statusCode, method).toBe(401);
    }
    const wrong = await t.call("POST", `/v1/tasks/${t.seed.taskId}/reply`, { revision: 1, body: "x", artifactIds: t.seed.artifactIds }, "https://evil.example");
    expect(wrong.statusCode).toBe(403);
    expect(t.d.sent).toHaveLength(0);
  });

  it("shows who it would go to, then sends once and refuses a repeat", async () => {
    const t = await setup();
    const view = (await t.call("GET", `/v1/tasks/${t.seed.taskId}/reply`)).json().data;
    expect(view).toMatchObject({ available: true, to: "jordan@client.example", from: "me@acme.example" });

    const body = { revision: 1, body: "Here you go.", artifactIds: t.seed.artifactIds, to: "attacker@evil.example" };
    const sent = await t.call("POST", `/v1/tasks/${t.seed.taskId}/reply`, body);
    expect(sent.statusCode).toBe(200);
    expect(sent.json().data.last).toMatchObject({ status: "sent", to: "jordan@client.example" });
    expect(t.d.sent).toHaveLength(1);
    expect(t.d.sent[0]).toContain("To: jordan@client.example\r\n");
    expect(t.d.sent[0]).not.toContain("attacker@evil.example");

    const again = await t.call("POST", `/v1/tasks/${t.seed.taskId}/reply`, body);
    expect([again.statusCode, again.json().error.code]).toEqual([409, "ALREADY_SENT"]);
    expect(t.d.sent).toHaveLength(1);

    const detail = (await t.call("GET", `/v1/tasks/${t.seed.taskId}`)).json().data;
    expect(detail.task.status).toBe("approved");
    expect(detail.events.map((e: { message: string }) => e.message)).toContain("Reply sent to jordan@client.example with 2 files.");
  });

  it("validates the body and refuses an unreviewed, demo or read-only task", async () => {
    const t = await setup();
    const post = (p: unknown) => t.call("POST", `/v1/tasks/${t.seed.taskId}/reply`, p);
    expect((await post({ revision: 1, body: "", artifactIds: t.seed.artifactIds })).statusCode).toBe(400);
    expect((await post({ revision: 1, body: "x", artifactIds: [] })).statusCode).toBe(400);
    expect((await post({ revision: 1, body: "x".repeat(5001), artifactIds: t.seed.artifactIds })).statusCode).toBe(400);
    expect((await post({ revision: 9, body: "x", artifactIds: t.seed.artifactIds })).json().error.code).toBe("STALE_REVISION");
    expect((await t.call("GET", "/v1/tasks/nope/reply")).statusCode).toBe(404);
    expect(t.d.sent).toHaveLength(0);

    for (const [opts, code] of [[{ status: "ready" }, "REPLY_NOT_AVAILABLE"], [{ mode: "demo" as const }, "REPLY_NOT_AVAILABLE"], [{ scope: READ }, "SEND_PERMISSION_MISSING"]] as const) {
      await app.close();
      const u = await setup(opts);
      const r = await u.call("POST", `/v1/tasks/${u.seed.taskId}/reply`, { revision: 1, body: "x", artifactIds: u.seed.artifactIds });
      expect([r.statusCode, r.json().error.code]).toEqual([409, code]);
      expect(u.d.sent).toHaveLength(0);
    }
  });

  it("reports whether the connection may send in the integration status", async () => {
    const t = await setup();
    expect((await t.call("GET", "/v1/integrations")).json().data.gmail.canSend).toBe(true);
    await app.close();
    const r = await setup({ scope: READ });
    expect((await r.call("GET", "/v1/integrations")).json().data.gmail.canSend).toBe(false);
  });
});

describe("consent for sending is separate and opt-in", () => {
  it("connect asks for read-only; ?send=1 adds exactly the send permission", async () => {
    const t = await setup({ connect: false }, GOOGLE);
    const scopeOf = async (url: string) => {
      const r = await t.call("GET", url, undefined, null);
      expect(r.statusCode).toBe(302);
      return new URL(r.headers.location as string).searchParams.get("scope");
    };
    expect(await scopeOf("/v1/integrations/gmail/start")).toBe(READ);
    expect(await scopeOf("/v1/integrations/gmail/start?send=1")).toBe(`${READ} ${GMAIL_SEND_SCOPE}`);
  });

  it("the callback reports whether sending was actually granted", async () => {
    for (const [scope, marker] of [[`${READ} ${GMAIL_SEND_SCOPE}`, "connected&send=1"], [READ, "connected"]] as const) {
      const port: GmailOAuthPort = {
        authUrl: (state) => `https://accounts.example/auth?state=${state}`,
        exchange: async () => ({ access_token: "a", refresh_token: "r", scope }),
        profileEmail: async () => "me@acme.example",
        revoke: async () => {},
      };
      if (app) await app.close();
      const t = await setup({ connect: false }, GOOGLE, port);
      const start = await t.call("GET", "/v1/integrations/gmail/start?send=1", undefined, null);
      const state = new URL(start.headers.location as string).searchParams.get("state")!;
      const cb = await app.inject({ method: "GET", url: `/v1/integrations/gmail/callback?code=abc&state=${state}`, headers: { cookie: t.cookie } });
      expect(cb.headers.location).toBe(`/settings?gmail=${marker}`);
      expect((await t.call("GET", "/v1/integrations")).json().data.gmail.canSend).toBe(scope.includes("gmail.send"));
    }
  });
});

describe("delete route", () => {
  it("needs a session and the app's origin, refuses an unknown or active task, and deletes a finished one", async () => {
    const t = await setup();
    expect((await app.inject({ method: "DELETE", url: `/v1/tasks/${t.seed.taskId}`, headers: { origin: ORIGIN } })).statusCode).toBe(401);
    expect((await t.call("DELETE", `/v1/tasks/${t.seed.taskId}`, undefined, "https://evil.example")).statusCode).toBe(403);
    expect((await t.call("DELETE", "/v1/tasks/nope")).statusCode).toBe(404);
    t.db.prepare("UPDATE tasks SET status='running' WHERE id=?").run(t.seed.taskId);
    const busy = await t.call("DELETE", `/v1/tasks/${t.seed.taskId}`);
    expect([busy.statusCode, busy.json().error.code]).toEqual([409, "TASK_ACTIVE"]);
    t.db.prepare("UPDATE tasks SET status='approved' WHERE id=?").run(t.seed.taskId);
    const ok = await t.call("DELETE", `/v1/tasks/${t.seed.taskId}`);
    expect([ok.statusCode, ok.json().data]).toEqual([200, { deleted: true, files: 2 }]);
    expect((await t.call("GET", `/v1/tasks/${t.seed.taskId}`)).statusCode).toBe(404);
    expect((await t.call("GET", `/v1/tasks/${t.seed.taskId}/reply`)).statusCode).toBe(404);
    expect((await t.call("DELETE", `/v1/tasks/${t.seed.taskId}`)).statusCode).toBe(404);
  });
});
