// Batch 4 OAuth/settings/status route tests. Google token exchange is an injected port (mock) except the
// first test, which uses the real google-auth-library to build the consent URL (local, no network).
// None of this proves access to a real Google account.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { injectDemo, type AppConfig, type Db } from "@afterhours/data";
import { makeTestConfig, makeTestDb } from "@afterhours/data/testing";
import { buildApp } from "../src/app";
import type { GmailOAuthPort } from "../src/routes/integrations";

const ORIGIN = "http://localhost:3000";
const GOOGLE = { GOOGLE_CLIENT_ID: "test-client.apps.example", GOOGLE_CLIENT_SECRET: "test-client-secret" };
let app: FastifyInstance;
afterEach(async () => { await app?.close(); });

let clock = new Date("2026-10-20T17:00:00Z");
async function setup(overrides: Record<string, string> = {}, gmailOAuth?: GmailOAuthPort): Promise<{ db: Db; config: AppConfig }> {
  clock = new Date("2026-10-20T17:00:00Z");
  const config = makeTestConfig(overrides);
  const { db } = makeTestDb(config);
  app = await buildApp({ config, db, rateLimit: false, gmailOAuth, now: () => clock });
  return { db, config };
}
async function login(): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/v1/session", headers: { origin: ORIGIN }, payload: { password: "correct-horse-battery" } });
  return (r.headers["set-cookie"] as string).split(";")[0]!;
}
async function startState(cookie: string): Promise<string> {
  const r = await app.inject({ method: "GET", url: "/v1/integrations/gmail/start", headers: { cookie } });
  expect(r.statusCode).toBe(302);
  return new URL(r.headers.location as string).searchParams.get("state")!;
}
const callback = (cookie: string | null, qs: string) =>
  app.inject({ method: "GET", url: `/v1/integrations/gmail/callback?${qs}`, headers: cookie ? { cookie } : {} });

function fakePort(over: Partial<GmailOAuthPort> = {}) {
  const log: string[] = [];
  const port: GmailOAuthPort = {
    authUrl: (state) => `https://accounts.example/auth?state=${state}`,
    exchange: async () => ({ access_token: "AT-secret-1", refresh_token: "RT-secret-1", scope: "https://www.googleapis.com/auth/gmail.readonly" }),
    profileEmail: async () => "inbox@test.dev",
    revoke: async () => { log.push("revoke"); },
    ...over,
  };
  return { port, log };
}

describe("OAuth start", () => {
  it("real consent URL: gmail.readonly only, offline access, exact public callback, opaque state", async () => {
    await setup(GOOGLE); // no injected port: real google-auth-library builds the URL locally
    const cookie = await login();
    const r = await app.inject({ method: "GET", url: "/v1/integrations/gmail/start", headers: { cookie } });
    expect(r.statusCode).toBe(302);
    const url = new URL(r.headers.location as string);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/integrations/gmail/callback");
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(url.searchParams.get("client_id")).toBe(GOOGLE.GOOGLE_CLIENT_ID);
    expect(url.toString()).not.toContain(GOOGLE.GOOGLE_CLIENT_SECRET);
  });

  it("503 GMAIL_NOT_CONFIGURED without credentials; 503 GMAIL_REDIRECT_MISMATCH when the callback is not on PUBLIC_APP_URL", async () => {
    await setup();
    let cookie = await login();
    let r = await app.inject({ method: "GET", url: "/v1/integrations/gmail/start", headers: { cookie } });
    expect([r.statusCode, r.json().error.code]).toEqual([503, "GMAIL_NOT_CONFIGURED"]);
    await app.close();
    await setup({ ...GOOGLE, GOOGLE_REDIRECT_URI: "http://127.0.0.1:4177/v1/integrations/gmail/callback" });
    cookie = await login();
    r = await app.inject({ method: "GET", url: "/v1/integrations/gmail/start", headers: { cookie } });
    expect([r.statusCode, r.json().error.code]).toEqual([503, "GMAIL_REDIRECT_MISMATCH"]);
    expect(r.body).not.toContain(GOOGLE.GOOGLE_CLIENT_SECRET);
  });

  it("a browser clicking Connect is sent back to Settings with a safe marker instead of a JSON error page", async () => {
    const html = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    await setup();
    let cookie = await login();
    let r = await app.inject({ method: "GET", url: "/v1/integrations/gmail/start", headers: { cookie, accept: html } });
    expect([r.statusCode, r.headers.location]).toEqual([302, "/settings?gmail=error&reason=not_configured"]);
    await app.close();
    await setup({ ...GOOGLE, GOOGLE_REDIRECT_URI: "http://127.0.0.1:4177/v1/integrations/gmail/callback" });
    cookie = await login();
    r = await app.inject({ method: "GET", url: "/v1/integrations/gmail/start", headers: { cookie, accept: html } });
    expect([r.statusCode, r.headers.location]).toEqual([302, "/settings?gmail=error&reason=redirect_mismatch"]);
    // Without a session a browser still gets 401, never a redirect that hints at configuration.
    r = await app.inject({ method: "GET", url: "/v1/integrations/gmail/start", headers: { accept: html } });
    expect(r.statusCode).toBe(401);
  });

  it("local 4177 override stays consistent: callback follows PUBLIC_APP_URL, not the private API port", async () => {
    await setup({ ...GOOGLE, API_PORT: "4177", API_ORIGIN: "http://127.0.0.1:4177" });
    const cookie = await login();
    const r = await app.inject({ method: "GET", url: "/v1/integrations/gmail/start", headers: { cookie } });
    expect(new URL(r.headers.location as string).searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/integrations/gmail/callback");
  });

  it("requires a session", async () => {
    await setup(GOOGLE);
    const r = await app.inject({ method: "GET", url: "/v1/integrations/gmail/start" });
    expect(r.statusCode).toBe(401);
  });
});

describe("OAuth callback failures are safe", () => {
  it("expired state (> 10 min) -> reason=expired, nothing stored", async () => {
    const { port } = fakePort();
    const { db } = await setup(GOOGLE, port);
    const cookie = await login();
    const state = await startState(cookie);
    clock = new Date(clock.getTime() + 601_000);
    const r = await callback(cookie, `code=c&state=${state}`);
    expect(r.headers.location).toBe("/settings?gmail=error&reason=expired");
    expect(db.prepare("SELECT COUNT(*) n FROM integrations WHERE credentials_enc IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it("no session cookie -> reason=session; unknown state -> invalid_state; missing state -> invalid_state", async () => {
    const { port } = fakePort();
    await setup(GOOGLE, port);
    const cookie = await login();
    const state = await startState(cookie);
    expect((await callback(null, `code=c&state=${state}`)).headers.location).toBe("/settings?gmail=error&reason=session");
    expect((await callback(cookie, "code=c&state=forged-state-value")).headers.location).toBe("/settings?gmail=error&reason=invalid_state");
    expect((await callback(cookie, "code=c")).headers.location).toBe("/settings?gmail=error&reason=invalid_state");
  });

  it("state is single-use even when the first use failed (session mismatch burns it)", async () => {
    const { port } = fakePort();
    await setup(GOOGLE, port);
    const a = await login();
    const b = await login();
    const state = await startState(a);
    expect((await callback(b, `code=c&state=${state}`)).headers.location).toBe("/settings?gmail=error&reason=session");
    expect((await callback(a, `code=c&state=${state}`)).headers.location).toBe("/settings?gmail=error&reason=invalid_state");
  });

  it("user denied consent -> reason=denied; no exchange attempted", async () => {
    let exchanged = 0;
    const { port } = fakePort({ exchange: async () => { exchanged++; return {}; } });
    await setup(GOOGLE, port);
    const cookie = await login();
    const state = await startState(cookie);
    expect((await callback(cookie, `error=access_denied&state=${state}`)).headers.location).toBe("/settings?gmail=error&reason=denied");
    expect(exchanged).toBe(0);
  });

  it("read scope not granted -> reason=scope, token revoked, not connected", async () => {
    const { port, log } = fakePort({ exchange: async () => ({ access_token: "AT", refresh_token: "RT", scope: "openid email" }) });
    const { db } = await setup(GOOGLE, port);
    const cookie = await login();
    const state = await startState(cookie);
    expect((await callback(cookie, `code=c&state=${state}`)).headers.location).toBe("/settings?gmail=error&reason=scope");
    expect(log).toEqual(["revoke"]);
    expect(db.prepare("SELECT COUNT(*) n FROM integrations WHERE credentials_enc IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it("no refresh token -> reason=no_refresh_token; exchange error -> exchange_failed without leaking details", async () => {
    const { port } = fakePort({ exchange: async () => ({ access_token: "AT" }) });
    await setup(GOOGLE, port);
    let cookie = await login();
    let state = await startState(cookie);
    expect((await callback(cookie, `code=c&state=${state}`)).headers.location).toBe("/settings?gmail=error&reason=no_refresh_token");
    await app.close();
    const failing = fakePort({ exchange: async () => { throw new Error("invalid_client secret=abc123"); } });
    await setup(GOOGLE, failing.port);
    cookie = await login();
    state = await startState(cookie);
    const r = await callback(cookie, `code=c&state=${state}`);
    expect(r.headers.location).toBe("/settings?gmail=error&reason=exchange_failed");
    expect(JSON.stringify(r.headers)).not.toMatch(/abc123|invalid_client/);
  });

  it("success stores encrypted tokens only; status and settings never show them", async () => {
    const { port } = fakePort();
    const { db } = await setup(GOOGLE, port);
    const cookie = await login();
    const state = await startState(cookie);
    expect((await callback(cookie, `code=c&state=${state}`)).headers.location).toBe("/settings?gmail=connected");
    const raw = db.prepare("SELECT credentials_enc FROM integrations").get() as { credentials_enc: string };
    expect(raw.credentials_enc).toMatch(/^v1\./);
    expect(raw.credentials_enc).not.toMatch(/AT-secret|RT-secret/);
    for (const url of ["/v1/integrations", "/v1/settings"]) {
      const r = await app.inject({ method: "GET", url, headers: { cookie } });
      expect(r.body).not.toMatch(/AT-secret|RT-secret|test-client-secret/);
    }
  });
});

describe("disconnect", () => {
  it("deletes credentials before revoking, keeps task history, and allows reconnect", async () => {
    let stateAtRevoke: unknown = null;
    let dbRef: Db | null = null;
    const { port } = fakePort({
      revoke: async () => { stateAtRevoke = dbRef!.prepare("SELECT state, credentials_enc FROM integrations").get(); },
    });
    const { db, config } = await setup(GOOGLE, port);
    dbRef = db;
    const cookie = await login();
    const state = await startState(cookie);
    await callback(cookie, `code=c&state=${state}`);
    injectDemo(db, config, "proposal", "keep-me", clock);
    const del = await app.inject({ method: "DELETE", url: "/v1/integrations/gmail", headers: { cookie, origin: ORIGIN } });
    expect(del.json()).toEqual({ data: { disconnected: true } });
    expect(stateAtRevoke).toEqual({ state: "disconnected", credentials_enc: null });
    expect(db.prepare("SELECT COUNT(*) n FROM tasks").get()).toEqual({ n: 1 });
    const st = await app.inject({ method: "GET", url: "/v1/integrations", headers: { cookie } });
    expect(st.json().data.gmail).toMatchObject({ state: "disconnected", email: null });
    const again = await startState(cookie);
    expect((await callback(cookie, `code=c&state=${again}`)).headers.location).toBe("/settings?gmail=connected");
  });

  it("disconnect requires the browser Origin", async () => {
    await setup(GOOGLE, fakePort().port);
    const cookie = await login();
    const r = await app.inject({ method: "DELETE", url: "/v1/integrations/gmail", headers: { cookie } });
    expect(r.statusCode).toBe(403);
  });
});

describe("settings PATCH: operator fields cannot be set from the browser", () => {
  it("rejects credential, eligibility and provider fields (strict schema) and invalid recipients", async () => {
    await setup();
    const cookie = await login();
    const patch = (payload: Record<string, unknown>) => app.inject({ method: "PATCH", url: "/v1/settings", headers: { cookie, origin: ORIGIN }, payload });
    for (const body of [
      { whatsappUseCaseEligible: true },
      { notifications: { eligible: true } },
      { twilioAuthToken: "x" },
      { generationMode: "live" },
      { anthropicApiKey: "sk-test" },
      { organization: { id: "other" } },
      { notifications: { recipient: "not-a-phone" } },
    ]) {
      const r = await patch(body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
    }
    const ok = await patch({ notifications: { recipient: "+15551234567" }, autoPrepare: false });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ autoPrepare: false, notifications: { recipient: "+15551234567" } });
  });

  it("integration status shows the WhatsApp block reason from operator config", async () => {
    await setup();
    const cookie = await login();
    await app.inject({ method: "PATCH", url: "/v1/settings", headers: { cookie, origin: ORIGIN }, payload: { notifications: { channel: "whatsapp" } } });
    const st = (await app.inject({ method: "GET", url: "/v1/integrations", headers: { cookie } })).json().data.notifications;
    expect(st).toMatchObject({ channel: "whatsapp", configured: false, eligible: false });
    expect(st.lastError).toMatch(/not configured on the server/);
  });
});
