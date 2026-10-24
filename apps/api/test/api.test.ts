import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTaskDetail, saveGmailConnection, type AppConfig, type Db } from "@afterhours/data";
import { makeTestDb, runToReady } from "@afterhours/data/testing";
import { buildApp } from "../src/app";
import type { GmailOAuthPort } from "../src/routes/integrations";

const ORIGIN = "http://localhost:3000";
let app: FastifyInstance;
afterEach(async () => { await app?.close(); });

async function setup(overrides: Record<string, string> = {}, gmailOAuth?: GmailOAuthPort) {
  const { makeTestConfig } = await import("@afterhours/data/testing");
  const config: AppConfig = makeTestConfig(overrides);
  const { db } = makeTestDb(config);
  app = await buildApp({ config, db, rateLimit: false, gmailOAuth });
  return { db, config };
}

async function login(): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/v1/session", headers: { origin: ORIGIN }, payload: { password: "correct-horse-battery" } });
  expect(r.statusCode).toBe(200);
  const set = r.headers["set-cookie"] as string;
  expect(set).toMatch(/ah_session=/);
  expect(set).toMatch(/HttpOnly/i);
  expect(set).toMatch(/SameSite=Lax/i);
  expect(set).not.toMatch(/Domain=/i);
  return set.split(";")[0]!;
}

describe("auth and access control", () => {
  it("rejects unauthenticated access to every private route with the error envelope", async () => {
    await setup();
    const routes: Array<[string, string]> = [
      ["GET", "/v1/tasks"], ["GET", "/v1/tasks/x"], ["POST", "/v1/tasks/x/review"], ["POST", "/v1/tasks/x/answers"],
      ["POST", "/v1/tasks/x/retry"], ["GET", "/v1/artifacts/x/download"], ["GET", "/v1/settings"], ["PATCH", "/v1/settings"],
      ["GET", "/v1/integrations"], ["GET", "/v1/integrations/gmail/start"], ["DELETE", "/v1/integrations/gmail"],
      ["GET", "/v1/notifications"], ["POST", "/v1/demo/inject"],
    ];
    for (const [method, url] of routes) {
      const r = await app.inject({ method: method as "GET", url, headers: { origin: ORIGIN }, payload: method === "GET" ? undefined : {} });
      expect(r.statusCode, `${method} ${url}`).toBe(401);
      expect(r.json().error).toMatchObject({ code: "UNAUTHENTICATED" });
      expect(typeof r.json().error.requestId).toBe("string");
    }
  });

  it("logs in, keeps the session, and revokes it on logout", async () => {
    await setup();
    expect((await app.inject({ method: "GET", url: "/v1/session" })).json()).toEqual({ data: { authenticated: false } });
    const bad = await app.inject({ method: "POST", url: "/v1/session", headers: { origin: ORIGIN }, payload: { password: "nope" } });
    expect(bad.statusCode).toBe(401);
    const cookie = await login();
    expect((await app.inject({ method: "GET", url: "/v1/session", headers: { cookie } })).json()).toEqual({ data: { authenticated: true } });
    expect((await app.inject({ method: "GET", url: "/v1/tasks", headers: { cookie } })).statusCode).toBe(200);
    await app.inject({ method: "DELETE", url: "/v1/session", headers: { cookie, origin: ORIGIN } });
    expect((await app.inject({ method: "GET", url: "/v1/tasks", headers: { cookie } })).statusCode).toBe(401);
  });

  it("checks Origin on browser mutations", async () => {
    await setup();
    const cookie = await login();
    const evil = await app.inject({ method: "PATCH", url: "/v1/settings", headers: { cookie, origin: "https://evil.test" }, payload: { autoPrepare: false } });
    expect(evil.statusCode).toBe(403);
    const missing = await app.inject({ method: "PATCH", url: "/v1/settings", headers: { cookie }, payload: { autoPrepare: false } });
    expect(missing.statusCode).toBe(403);
    const loginEvil = await app.inject({ method: "POST", url: "/v1/session", headers: { origin: "https://evil.test" }, payload: { password: "correct-horse-battery" } });
    expect(loginEvil.statusCode).toBe(403);
  });

  it("restricts the CLI bearer token to demo injection only", async () => {
    await setup();
    const auth = { authorization: "Bearer cli-token-for-tests" };
    const ok = await app.inject({ method: "POST", url: "/v1/demo/inject", headers: auth, payload: { scenario: "proposal", replayKey: "cli-1" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ deduplicated: false });
    for (const url of ["/v1/tasks", "/v1/settings", "/v1/notifications", "/v1/integrations", `/v1/tasks/${ok.json().data.taskId}`]) {
      expect((await app.inject({ method: "GET", url, headers: auth })).statusCode, url).toBe(401);
    }
    const wrong = await app.inject({ method: "POST", url: "/v1/demo/inject", headers: { authorization: "Bearer wrong" }, payload: { scenario: "proposal" } });
    expect(wrong.statusCode).toBe(401);
  });

  it("disables demo injection unless DEMO_ENABLED=true", async () => {
    await setup({ DEMO_ENABLED: "false" });
    const r = await app.inject({ method: "POST", url: "/v1/demo/inject", headers: { authorization: "Bearer cli-token-for-tests" }, payload: { scenario: "proposal" } });
    expect(r.statusCode).toBe(404);
  });
});

describe("tasks, review, downloads", () => {
  it("dedupes injections by replayKey and returns the original task", async () => {
    await setup();
    const cookie = await login();
    const h = { cookie, origin: ORIGIN };
    const a = await app.inject({ method: "POST", url: "/v1/demo/inject", headers: h, payload: { scenario: "report", replayKey: "same" } });
    const b = await app.inject({ method: "POST", url: "/v1/demo/inject", headers: h, payload: { scenario: "report", replayKey: "same" } });
    expect(b.json().data).toEqual({ taskId: a.json().data.taskId, deduplicated: true });
    const c = await app.inject({ method: "POST", url: "/v1/demo/inject", headers: h, payload: { scenario: "report" } });
    expect(c.json().data.taskId).not.toBe(a.json().data.taskId);
    const list = (await app.inject({ method: "GET", url: "/v1/tasks", headers: { cookie } })).json().data;
    expect(list.items).toHaveLength(2);
    expect(list.nextCursor).toBeNull();
    const bad = await app.inject({ method: "POST", url: "/v1/demo/inject", headers: h, payload: { scenario: "rm -rf" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("paginates with a stable cursor", async () => {
    const { db, config } = await setup();
    const cookie = await login();
    for (let i = 0; i < 5; i++) runToReady(db, config, `p${i}`, new Date(Date.UTC(2026, 2, 2, 20, 0, i)));
    const p1 = (await app.inject({ method: "GET", url: "/v1/tasks?limit=2", headers: { cookie } })).json().data;
    const p2 = (await app.inject({ method: "GET", url: `/v1/tasks?limit=2&cursor=${p1.nextCursor}`, headers: { cookie } })).json().data;
    const p3 = (await app.inject({ method: "GET", url: `/v1/tasks?limit=2&cursor=${p2.nextCursor}`, headers: { cookie } })).json().data;
    const ids = [...p1.items, ...p2.items, ...p3.items].map((t: { id: string }) => t.id);
    expect(new Set(ids).size).toBe(5);
    expect(p3.nextCursor).toBeNull();
    expect((await app.inject({ method: "GET", url: "/v1/tasks?limit=500", headers: { cookie } })).statusCode).toBe(400);
  });

  it("serves the real file with correct headers, then marks reviewed and enforces revisions", async () => {
    const { db, config } = await setup();
    const cookie = await login();
    const { taskId } = runToReady(db, config, "k", new Date());
    const detail = (await app.inject({ method: "GET", url: `/v1/tasks/${taskId}`, headers: { cookie } })).json().data;
    expect(detail.task.status).toBe("ready");
    const docx = detail.artifacts.find((a: { format: string }) => a.format === "docx");
    expect(docx.downloadPath).toBe(`/api/artifacts/${docx.id}/download`);

    const dl = await app.inject({ method: "GET", url: `/v1/artifacts/${docx.id}/download`, headers: { cookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(dl.headers["content-disposition"]).toMatch(/^attachment; filename="Proposal.docx"/);
    expect(dl.headers["cache-control"]).toBe("private, no-store");
    expect(dl.rawPayload.subarray(0, 2).toString()).toBe("PK");
    expect(dl.rawPayload.byteLength).toBe(docx.sizeBytes);
    expect((await app.inject({ method: "GET", url: "/v1/artifacts/..%2F..%2Fetc%2Fpasswd/download", headers: { cookie } })).statusCode).toBe(404);

    const h = { cookie, origin: ORIGIN };
    const stale = await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/review`, headers: h, payload: { revision: 2, action: "approve" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("STALE_REVISION");
    const ok = await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/review`, headers: h, payload: { revision: 1, action: "approve" } });
    expect(ok.json().data.status).toBe("approved");
    // Survives a "refresh": read again from the DB.
    expect(getTaskDetail(db as Db, taskId).task.status).toBe("approved");
    const retry = await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/retry`, headers: h, payload: { revision: 1 } });
    expect(retry.statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: "/v1/tasks/nope", headers: { cookie } })).statusCode).toBe(404);
  });

  it("validates settings patches and never returns secrets", async () => {
    await setup();
    const cookie = await login();
    const h = { cookie, origin: ORIGIN };
    const r = await app.inject({ method: "PATCH", url: "/v1/settings", headers: h, payload: { allowedSenders: ["Boss@Client.test"], notifications: { digestTime: "07:30" } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.allowedSenders).toEqual(["boss@client.test"]);
    expect(r.json().data.notifications.digestTime).toBe("07:30");
    expect((await app.inject({ method: "PATCH", url: "/v1/settings", headers: h, payload: { twilioAuthToken: "x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/v1/settings", headers: h, payload: { notifications: { digestTime: "25:00" } } })).statusCode).toBe(400);
    const integ = (await app.inject({ method: "GET", url: "/v1/integrations", headers: { cookie } })).json().data;
    expect(integ).toMatchObject({ gmail: { state: "disconnected" }, model: { mode: "fixture", configured: true }, notifications: { channel: "outbox", configured: true }, worker: { healthy: false } });
  });

  it("reports live mode without credentials as not configured instead of crashing", async () => {
    await setup({ GENERATION_MODE: "live", MODEL_PROVIDER: "anthropic" });
    const cookie = await login();
    const integ = (await app.inject({ method: "GET", url: "/v1/integrations", headers: { cookie } })).json().data;
    expect(integ.model).toEqual({ mode: "live", provider: "anthropic", configured: false, model: null });
  });

  it("reports Claude live mode as configured only with both the key and a model name", async () => {
    await setup({ GENERATION_MODE: "live", MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key", MODEL_NAME: "claude-test" });
    const cookie = await login();
    const integ = (await app.inject({ method: "GET", url: "/v1/integrations", headers: { cookie } })).json().data;
    expect(integ.model).toEqual({ mode: "live", provider: "anthropic", configured: true, model: "claude-test" });
    expect(JSON.stringify(integ)).not.toContain("test-key");
  });
});

const GOOGLE = { GOOGLE_CLIENT_ID: "test-client.apps.example", GOOGLE_CLIENT_SECRET: "test-client-secret" };

describe("gmail oauth routes", () => {
  const port = (): GmailOAuthPort & { revoked: number } => {
    const p = {
      revoked: 0,
      authUrl: (state: string) => `https://accounts.example/auth?state=${state}`,
      exchange: async (code: string) => ({ access_token: `at-${code}`, refresh_token: "rt-secret" }),
      profileEmail: async () => "inbox@test.dev",
      revoke: async () => { p.revoked++; },
    };
    return p;
  };

  it("binds state to the session, connects, rejects replay, and disconnects", async () => {
    const p = port();
    const { db } = await setup(GOOGLE, p);
    const cookie = await login();
    const start = await app.inject({ method: "GET", url: "/v1/integrations/gmail/start", headers: { cookie } });
    expect(start.statusCode).toBe(302);
    const state = new URL(start.headers.location as string).searchParams.get("state")!;

    const otherCookie = await login();
    const mismatch = await app.inject({ method: "GET", url: `/v1/integrations/gmail/callback?code=c&state=${state}`, headers: { cookie: otherCookie } });
    expect(mismatch.headers.location).toBe("/settings?gmail=error&reason=session");

    const start2 = await app.inject({ method: "GET", url: "/v1/integrations/gmail/start", headers: { cookie } });
    const state2 = new URL(start2.headers.location as string).searchParams.get("state")!;
    const ok = await app.inject({ method: "GET", url: `/v1/integrations/gmail/callback?code=c&state=${state2}`, headers: { cookie } });
    expect(ok.headers.location).toBe("/settings?gmail=connected");
    const replay = await app.inject({ method: "GET", url: `/v1/integrations/gmail/callback?code=c&state=${state2}`, headers: { cookie } });
    expect(replay.headers.location).toBe("/settings?gmail=error&reason=invalid_state");

    const integ = await app.inject({ method: "GET", url: "/v1/integrations", headers: { cookie } });
    expect(integ.body).not.toMatch(/rt-secret|at-c/);
    expect(integ.json().data.gmail).toMatchObject({ state: "connected", email: "inbox@test.dev" });

    const del = await app.inject({ method: "DELETE", url: "/v1/integrations/gmail", headers: { cookie, origin: ORIGIN } });
    expect(del.json()).toEqual({ data: { disconnected: true } });
    expect(p.revoked).toBe(1);
    expect((db.prepare("SELECT credentials_enc FROM integrations").get() as { credentials_enc: string | null }).credentials_enc).toBeNull();
    void saveGmailConnection;
  });

  it("returns 503 when Google OAuth is not configured", async () => {
    await setup();
    const cookie = await login();
    const r = await app.inject({ method: "GET", url: "/v1/integrations/gmail/start", headers: { cookie } });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe("GMAIL_NOT_CONFIGURED");
  });
});
