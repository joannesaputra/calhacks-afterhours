// Browser acceptance tests (Person 3). Starts an isolated API, worker, and web app on temporary storage
// (never the working database), runs the Playwright suite in tests/e2e, then cleans up.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(import.meta.dirname, "..");
const WEB_PORT = process.env.E2E_WEB_PORT ?? "3100";
const API_PORT = process.env.E2E_API_PORT ?? "4100";
const FAIL_WEB_PORT = process.env.E2E_FAIL_WEB_PORT ?? "3101";
const FAIL_API_PORT = process.env.E2E_FAIL_API_PORT ?? "4101";
const tmp = mkdtempSync(path.join(tmpdir(), "afterhours-e2e-"));
const password = `e2e-${randomBytes(6).toString("hex")}`;
const cliToken = randomBytes(24).toString("base64url");

const env = {
  ...process.env,
  NODE_ENV: "development",
  PUBLIC_APP_URL: `http://localhost:${WEB_PORT}`,
  API_ORIGIN: `http://127.0.0.1:${API_PORT}`,
  API_PORT,
  DATABASE_PATH: path.join(tmp, "e2e.sqlite"),
  ARTIFACTS_DIR: path.join(tmp, "artifacts"),
  SESSION_SECRET: randomBytes(32).toString("hex"),
  APP_PASSWORD: password,
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  DEMO_ENABLED: "true",
  DEMO_CLI_TOKEN: cliToken,
  GENERATION_MODE: "fixture",
  MODEL_PROVIDER: "fixture",
  NOTIFICATION_CHANNEL: "outbox",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  WHATSAPP_USE_CASE_ELIGIBLE: "false",
  E2E_JSON: path.join(tmp, "results.json"),
  E2E_BASE_URL: `http://localhost:${WEB_PORT}`,
  E2E_PASSWORD: password,
  E2E_CLI_TOKEN: cliToken,
};

// Second, separate stack on 127.0.0.1 (cookies are per host, so it cannot clobber the first stack's session) whose
// model is live but has no credentials. Every task there fails with MODEL_NOT_CONFIGURED: a real failure path.
const failEnv = {
  ...env,
  PUBLIC_APP_URL: `http://127.0.0.1:${FAIL_WEB_PORT}`,
  API_ORIGIN: `http://127.0.0.1:${FAIL_API_PORT}`,
  API_PORT: FAIL_API_PORT,
  DATABASE_PATH: path.join(tmp, "e2e-fail.sqlite"),
  ARTIFACTS_DIR: path.join(tmp, "artifacts-fail"),
  GENERATION_MODE: "live",
  MODEL_PROVIDER: "anthropic",
  MODEL_NAME: "",
  ANTHROPIC_API_KEY: "",
  E2E_FAIL_BASE_URL: `http://127.0.0.1:${FAIL_WEB_PORT}`,
  NEXT_DIST_DIR: ".next-e2e-fail",
};
env.E2E_FAIL_BASE_URL = failEnv.E2E_FAIL_BASE_URL;

const children = [];
function start(name, args, childEnv = env) {
  const child = spawn("pnpm", args, { cwd: root, env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  for (const s of [child.stdout, child.stderr]) s.on("data", (d) => { log.push(String(d)); if (log.length > 200) log.shift(); });
  child.log = log;
  child.name = name;
  children.push(child);
  return child;
}
function stopChildren() {
  for (const c of children) {
    try { process.kill(-c.pid, "SIGTERM"); } catch { /* already gone */ }
  }
}
async function cleanup() {
  stopChildren();
  await sleep(2000); // let the dev servers release their files before deleting them
  for (const dir of [path.join(root, "apps/web/.next-e2e-fail"), tmp]) {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* best effort; the folder is git-ignored or temporary */ }
  }
}
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(143); });

async function waitFor(url, label, ms = 180_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (const c of children) {
      if (c.exitCode !== null) throw new Error(`${c.name} exited early:\n${c.log.join("")}`);
    }
    try {
      const res = await globalThis.fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label} at ${url}`);
}

let code = 1;
try {
  // The browser is a prerequisite. If it is missing, say NOT RUN loudly instead of failing obscurely or "passing".
  const probe = spawnSync(
    "pnpm",
    ["--filter", "@afterhours/web", "exec", "node", "-e", "const fs=require('fs');const {chromium}=require('@playwright/test');process.exit(fs.existsSync(chromium.executablePath())?0:4)"],
    { cwd: root, env, stdio: "ignore" },
  );
  if (probe.status !== 0) {
    console.error("NOT RUN: no Playwright Chromium browser is installed. Install it with:\n  pnpm --filter @afterhours/web exec playwright install chromium\nExit code 4 means the browser suite did not run. It is not a pass.");
    code = 4;
    throw new Error("browser missing");
  }
  for (const step of ["db:migrate", "db:seed"]) {
    const r = spawnSync("pnpm", [step], { cwd: root, env, stdio: "pipe" });
    if (r.status !== 0) throw new Error(`pnpm ${step} failed:\n${r.stdout}${r.stderr}`);
  }
  for (const step of ["db:migrate", "db:seed"]) {
    const r = spawnSync("pnpm", [step], { cwd: root, env: failEnv, stdio: "pipe" });
    if (r.status !== 0) throw new Error(`pnpm ${step} (failure stack) failed:\n${r.stdout}${r.stderr}`);
  }
  start("api", ["--filter", "@afterhours/api", "exec", "tsx", "src/main.ts"]);
  start("worker", ["--filter", "@afterhours/worker", "exec", "tsx", "src/main.ts"]);
  start("web", ["--filter", "@afterhours/web", "exec", "next", "dev", "-p", WEB_PORT]);
  start("api-fail", ["--filter", "@afterhours/api", "exec", "tsx", "src/main.ts"], failEnv);
  start("worker-fail", ["--filter", "@afterhours/worker", "exec", "tsx", "src/main.ts"], failEnv);
  start("web-fail", ["--filter", "@afterhours/web", "exec", "next", "dev", "-p", FAIL_WEB_PORT, "--hostname", "127.0.0.1"], failEnv);
  await waitFor(`http://127.0.0.1:${API_PORT}/health`, "API");
  await waitFor(`http://localhost:${WEB_PORT}/login`, "web app");
  await waitFor(`http://127.0.0.1:${FAIL_API_PORT}/health`, "failure-stack API");
  await waitFor(`http://127.0.0.1:${FAIL_WEB_PORT}/login`, "failure-stack web app");
  console.log(`E2E stack ready (web :${WEB_PORT}, api :${API_PORT}, storage ${tmp})`);
  const run = spawnSync(
    "pnpm",
    ["--filter", "@afterhours/web", "exec", "playwright", "test", "-c", path.join(root, "tests/e2e/playwright.config.ts"), ...process.argv.slice(2)],
    { cwd: root, env, stdio: "inherit" },
  );
  code = run.status ?? 1;
  // A skipped test is a BLOCKED prerequisite (for example the stub engine), never a pass.
  try {
    const report = JSON.parse(readFileSync(path.join(tmp, "results.json"), "utf8"));
    const blocked = [];
    const walk = (suite) => {
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          if ((t.annotations ?? []).some((a) => String(a.description ?? "").startsWith("BLOCKED"))) blocked.push(spec.title);
        }
      }
      for (const child of suite.suites ?? []) walk(child);
    };
    for (const suite of report.suites ?? []) walk(suite);
    if (code === 0 && blocked.length > 0) {
      console.error(`\nBLOCKED: ${blocked.length} test(s) could not run because a prerequisite is missing (the real engine). This is not a pass. Exit code 3.`);
      code = 3;
    }
  } catch { /* no report written; keep Playwright's exit code */ }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  await cleanup();
}
process.exit(code);
