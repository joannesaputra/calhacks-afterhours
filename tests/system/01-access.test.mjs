/* global fetch */
// Scenario G (+ H of the shared spec): access, CLI-token and data boundaries over real HTTP. No artifact needed.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startStack } from "./support/harness.mjs";

describe("G. access and data boundaries (real API + worker, throwaway DB)", () => {
  let s;
  before(async () => { s = await startStack(); });
  after(async () => { await s?.stop(); });

  const PRIVATE_GETS = ["/v1/tasks", "/v1/tasks/00000000-0000-0000-0000-000000000000", "/v1/settings", "/v1/integrations", "/v1/notifications", "/v1/artifacts/x/download"];

  it("rejects every private GET without a session (401, no data)", async () => {
    for (const route of PRIVATE_GETS) {
      const r = await s.get(route, { auth: false });
      assert.equal(r.status, 401, `${route} expected 401 got ${r.status}`);
      assert.equal(r.body?.data, undefined);
      assert.ok(r.body?.error?.requestId);
    }
  });

  it("rejects unauthenticated mutations (answers/retry/review/settings/inject)", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const cases = [
      ["POST", `/v1/tasks/${id}/review`, { revision: 1, action: "approve" }],
      ["POST", `/v1/tasks/${id}/retry`, { revision: 1 }],
      ["POST", `/v1/tasks/${id}/answers`, { revision: 1, answers: [] }],
      ["PATCH", "/v1/settings", { automationEnabled: false }],
      ["DELETE", "/v1/integrations/gmail", undefined],
      ["POST", "/v1/demo/inject", { scenario: "proposal" }],
    ];
    for (const [m, route, body] of cases) {
      const r = await s.call(m, route, { auth: false, body });
      assert.ok([401, 403].includes(r.status), `${m} ${route} expected 401/403 got ${r.status}`);
    }
  });

  it("restricted CLI bearer token injects only; it cannot read or mutate private data", async () => {
    const bearer = { authorization: `Bearer ${s.cliToken}` };
    for (const route of PRIVATE_GETS) {
      const r = await s.get(route, { auth: false, headers: bearer });
      assert.equal(r.status, 401, `CLI token must not read ${route} (got ${r.status})`);
    }
    for (const [m, route, body] of [
      ["POST", "/v1/tasks/00000000-0000-0000-0000-000000000000/review", { revision: 1, action: "approve" }],
      ["PATCH", "/v1/settings", { automationEnabled: false }],
    ]) {
      const r = await s.call(m, route, { auth: false, headers: bearer, body });
      assert.ok([401, 403].includes(r.status), `${m} ${route} with CLI token got ${r.status}`);
    }
    const ok = await s.inject("no_action");
    assert.equal(ok.status, 200, "CLI token should still be able to inject");
    const bad = await s.call("POST", "/v1/demo/inject", { auth: false, headers: { authorization: "Bearer wrong" }, body: { scenario: "proposal" } });
    assert.equal(bad.status, 401);
  });

  it("login: wrong password 401, bad Origin 403, cookie is HttpOnly + SameSite=Lax, logout revokes", async () => {
    const wrong = await fetch(`${s.apiOrigin}/v1/session`, { method: "POST", headers: { "content-type": "application/json", origin: s.publicOrigin }, body: JSON.stringify({ password: "not-the-password" }) });
    assert.equal(wrong.status, 401);
    const badOrigin = await fetch(`${s.apiOrigin}/v1/session`, { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" }, body: JSON.stringify({ password: s.password }) });
    assert.equal(badOrigin.status, 403);
    const fresh = await fetch(`${s.apiOrigin}/v1/session`, { method: "POST", headers: { "content-type": "application/json", origin: s.publicOrigin }, body: JSON.stringify({ password: s.password }) });
    assert.equal(fresh.status, 200);
    const c = fresh.headers.getSetCookie().join(" ; ");
    assert.match(c, /HttpOnly/i);
    assert.match(c, /SameSite=Lax/i);
    const cookie = fresh.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
    const me = await fetch(`${s.apiOrigin}/v1/session`, { headers: { cookie } }).then((r) => r.json());
    assert.equal(me.data.authenticated, true);
    const out = await fetch(`${s.apiOrigin}/v1/session`, { method: "DELETE", headers: { cookie, origin: s.publicOrigin } });
    assert.equal(out.status, 200);
    const after = await fetch(`${s.apiOrigin}/v1/session`, { headers: { cookie } }).then((r) => r.json());
    assert.equal(after.data.authenticated, false, "revoked session cookie must stop working");
    const priv = await fetch(`${s.apiOrigin}/v1/tasks`, { headers: { cookie } });
    assert.equal(priv.status, 401);
  });

  it("mutation with a valid session but wrong Origin is rejected (403)", async () => {
    const r = await s.call("PATCH", "/v1/settings", { body: { automationEnabled: false }, headers: { origin: "http://evil.example" } });
    assert.equal(r.status, 403);
  });

  it("artifact download: unknown id 404; traversal-shaped ids never reach the filesystem or leak paths", async () => {
    const ids = ["does-not-exist", "..%2F..%2F..%2Fetc%2Fpasswd", "%2e%2e%2f%2e%2e%2fdb.sqlite", "a%00b", encodeURIComponent("/etc/passwd")];
    for (const id of ids) {
      const r = await s.get(`/v1/artifacts/${id}/download`);
      assert.ok([400, 404].includes(r.status), `id ${id} got ${r.status}`);
      const text = r.bytes.toString("utf8");
      assert.ok(!text.includes("root:"), "must never return file contents");
      assert.ok(!text.includes(s.dir), "must not leak storage paths");
      assert.ok(!/\bat .*\.(ts|js):\d+/.test(text), "no stack traces");
    }
  });

  it("error and DTO bodies carry no storage paths, secrets or stack traces", async () => {
    const probes = [await s.get("/v1/tasks/not-a-uuid"), await s.post("/v1/tasks/00000000-0000-0000-0000-000000000000/review", { revision: "x" }), await s.get("/v1/settings"), await s.get("/v1/integrations")];
    for (const r of probes) {
      const text = r.bytes.toString("utf8");
      for (const secret of [s.password, s.cliToken, s.env.SESSION_SECRET, s.env.TOKEN_ENCRYPTION_KEY, s.dir]) assert.ok(!text.includes(secret), "leaked a secret or path");
      assert.ok(!/stack|node_modules/i.test(text));
    }
  });

  it("service logs never contain the password, CLI token, session secret or encryption key", async () => {
    const all = s.logs.flatMap((l) => l.log).join("\n");
    for (const secret of [s.password, s.cliToken, s.env.SESSION_SECRET, s.env.TOKEN_ENCRYPTION_KEY]) assert.ok(!all.includes(secret));
  });

  it("integration status discloses fixture mode, outbox channel, disconnected Gmail, healthy worker", async () => {
    const r = await s.get("/v1/integrations");
    const d = r.body.data;
    assert.equal(d.model.mode, "fixture");
    assert.equal(d.model.provider, "fixture");
    assert.equal(d.notifications.channel, "outbox");
    assert.equal(d.gmail.state, "disconnected");
    assert.equal(d.worker.healthy, true);
  });
});
