/* global Buffer, setTimeout, fetch */
// System-test harness: starts the REAL API and REAL worker as child processes against a throwaway
// SQLite database and artifact directory, then talks to them only through public HTTP routes.
// No engine/provider mocks, no auth bypass. Environment is built from scratch (never inherited), so
// real keys, the developer's .env values and normal databases cannot leak in.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(process.env.QA_REPO_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.."));

export async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns a truthy value; fail loudly at the deadline. */
export async function waitFor(what, fn, { timeoutMs = 30_000, intervalMs = 200 } = {}) {
  const end = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > end) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}${last instanceof Error ? `: ${last.message}` : ""}`);
    await sleep(intervalMs);
  }
}

function spawnService(name, entry, env, logs) {
  const child = spawn(process.execPath, ["--import", "tsx", entry], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  const state = { name, child, exited: null, log: [] };
  const keep = (buf) => { state.log.push(...String(buf).split("\n").filter(Boolean)); if (state.log.length > 400) state.log.splice(0, state.log.length - 400); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.on("exit", (code, signal) => { state.exited = { code, signal }; });
  logs.push(state);
  return state;
}

async function stopService(svc, signal = "SIGTERM", graceMs = 15_000) {
  if (!svc || svc.exited) return;
  svc.child.kill(signal);
  await waitFor(`${svc.name} to exit`, () => svc.exited, { timeoutMs: graceMs, intervalMs: 100 }).catch(() => svc.child.kill("SIGKILL"));
  await waitFor(`${svc.name} to exit after SIGKILL`, () => svc.exited, { timeoutMs: 5_000, intervalMs: 100 }).catch(() => undefined);
}

/**
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.env] extra/overriding environment variables
 * @param {boolean} [opts.worker] start the worker (default true)
 */
export async function startStack(opts = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ah-system-"));
  const apiPort = await freePort();
  const webPort = await freePort(); // only used to form a consistent PUBLIC_APP_URL / Origin header
  const password = `pw-${randomBytes(9).toString("hex")}`;
  const cliToken = `cli-${randomBytes(16).toString("hex")}`;
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: dir,
    NODE_ENV: "development",
    PUBLIC_APP_URL: `http://localhost:${webPort}`,
    API_PORT: String(apiPort),
    API_ORIGIN: `http://127.0.0.1:${apiPort}`,
    DATABASE_PATH: path.join(dir, "db.sqlite"),
    ARTIFACTS_DIR: path.join(dir, "artifacts"),
    SESSION_SECRET: randomBytes(24).toString("hex"),
    APP_PASSWORD: password,
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    DEMO_ENABLED: "true",
    DEMO_CLI_TOKEN: cliToken,
    GENERATION_MODE: "fixture",
    MODEL_PROVIDER: "fixture",
    NOTIFICATION_CHANNEL: "outbox",
    ...opts.env,
  };
  const logs = [];
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const publicOrigin = env.PUBLIC_APP_URL;
  const svc = { api: null, worker: null };
  const stack = {
    dir, apiOrigin, publicOrigin, env, password, cliToken, logs,
    dbPath: env.DATABASE_PATH, artifactsDir: env.ARTIFACTS_DIR,
    cookie: null,
    async startApi() {
      svc.api = spawnService("api", "apps/api/src/main.ts", env, logs);
      await waitFor("API /health", async () => {
        if (svc.api.exited) throw new Error(`API exited early (${JSON.stringify(svc.api.exited)}): ${svc.api.log.slice(-5).join(" | ")}`);
        const r = await fetch(`${apiOrigin}/health`).catch(() => null);
        return r?.ok;
      });
    },
    async startWorker() {
      const startedAt = Date.now();
      svc.worker = spawnService("worker", "apps/worker/src/main.ts", env, logs);
      await waitFor("a fresh worker heartbeat", async () => {
        if (svc.worker.exited) throw new Error(`worker exited early (${JSON.stringify(svc.worker.exited)}): ${svc.worker.log.slice(-5).join(" | ")}`);
        const s = await stack.get("/v1/integrations");
        const hb = s.body?.data?.worker?.lastHeartbeatAt;
        return s.status === 200 && hb && Date.parse(hb) >= startedAt - 1000;
      }, { timeoutMs: 40_000 });
    },
    async stopWorker(signal = "SIGTERM") { await stopService(svc.worker, signal); },
    async stopApi(signal = "SIGTERM") { await stopService(svc.api, signal); },
    /** Stop worker + API (graceful) and start fresh processes on the SAME database/artifact dir. The session cookie stays valid if sessions persist. */
    async restartAll() {
      await stack.stopWorker();
      await stack.stopApi();
      await stack.startApi();
      await stack.startWorker();
    },
    get workerState() { return svc.worker; },
    async login() {
      const r = await fetch(`${apiOrigin}/v1/session`, {
        method: "POST", headers: { "content-type": "application/json", origin: publicOrigin }, body: JSON.stringify({ password }),
      });
      if (r.status !== 200) throw new Error(`login failed (${r.status})`);
      const setCookie = r.headers.getSetCookie?.() ?? [];
      stack.cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
      if (!stack.cookie) throw new Error("login returned no cookie");
      return setCookie;
    },
    /** Authenticated (cookie) request unless `auth:false`. Mutations send the browser Origin. */
    /** Contract `downloadPath` is a browser path (/api/...); the API itself serves /v1/... */
    backendPath: (p) => p.replace(/^\/api\//, "/v1/"),
    async call(method, route, { body, auth = true, headers = {}, raw = false } = {}) {
      const h = { ...headers };
      if (auth && stack.cookie) h.cookie = stack.cookie;
      if (method !== "GET" && method !== "HEAD") { h.origin ??= publicOrigin; }
      if (body !== undefined) h["content-type"] = "application/json";
      const r = await fetch(`${apiOrigin}${route}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
      if (raw) return r;
      const buf = Buffer.from(await r.arrayBuffer());
      let json = null;
      try { json = JSON.parse(buf.toString("utf8")); } catch { /* binary or empty */ }
      return { status: r.status, headers: r.headers, body: json, bytes: buf };
    },
    get: (route, o) => stack.call("GET", route, o),
    post: (route, body, o) => stack.call("POST", route, { ...o, body }),
    /** Restricted CLI bearer: the same call the `pnpm demo:*` scripts make. */
    inject: (scenario, replayKey) => stack.call("POST", "/v1/demo/inject", {
      auth: false, headers: { authorization: `Bearer ${cliToken}` }, body: replayKey ? { scenario, replayKey } : { scenario },
    }),
    async waitStatus(taskId, wanted, timeoutMs = 60_000) {
      const set = Array.isArray(wanted) ? wanted : [wanted];
      let last = null;
      try {
        return await waitFor(`task ${taskId} to reach ${set.join("|")}`, async () => {
          const r = await stack.get(`/v1/tasks/${taskId}`);
          last = r.body?.data;
          return set.includes(last?.task?.status) ? last : null;
        }, { timeoutMs });
      } catch (e) {
        throw new Error(`${e.message}; last status=${last?.task?.status}, error=${JSON.stringify(last?.task?.error)}`, { cause: e });
      }
    },
    async stop() {
      await stopService(svc.worker);
      await stopService(svc.api);
      rmSync(dir, { recursive: true, force: true });
    },
    /** Sanitized tail of service logs for failure diagnostics (secrets are never logged by the services). */
    tail(n = 8) { return logs.map((l) => `[${l.name}] ${l.log.slice(-n).join(" | ")}`).join("\n").replaceAll(password, "<pw>").replaceAll(cliToken, "<cli>"); },
  };
  try {
    await stack.startApi();
    await stack.login();
    if (opts.worker !== false) await stack.startWorker();
  } catch (e) {
    const tail = stack.tail(12);
    await stack.stop();
    throw new Error(`${e.message}\n${tail}`, { cause: e });
  }
  return stack;
}

export function readFixture(rel) { return JSON.parse(readFileSync(path.join(REPO_ROOT, "fixtures", rel), "utf8")); }
