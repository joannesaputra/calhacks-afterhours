import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export const PASSWORD = process.env.E2E_PASSWORD ?? "";
export const CLI_TOKEN = process.env.E2E_CLI_TOKEN ?? "";
export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
/** Second stack whose model is live but unconfigured, so every task fails with MODEL_NOT_CONFIGURED. */
export const FAIL_BASE = process.env.E2E_FAIL_BASE_URL ?? "http://127.0.0.1:3101";

export type Scenario = "proposal" | "report" | "ambiguous" | "no_action" | "revision" | "revision_choice";

/** Inject through the real demo endpoint with the restricted CLI token (the same path as `pnpm demo:*`). */
export async function inject(request: APIRequestContext, scenario: Scenario, replayKey?: string, base = BASE) {
  const res = await request.post(`${base}/api/demo/inject`, {
    headers: { authorization: `Bearer ${CLI_TOKEN}`, "content-type": "application/json" },
    data: { scenario, replayKey: replayKey ?? `e2e-${scenario}-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  expect(res.ok(), `inject ${scenario}: ${res.status()}`).toBe(true);
  return ((await res.json()) as { data: { taskId: string; deduplicated: boolean } }).data;
}

const cachedCookies = new Map<string, Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>>();

/**
 * Sign in through the real session endpoint so the page context carries the session cookie.
 * The login endpoint is rate limited, so each stack is logged into once and the session is reused.
 */
export async function login(page: Page, base = BASE) {
  const cached = cachedCookies.get(base);
  if (cached) {
    await page.context().addCookies(cached);
    return;
  }
  const res = await page.request.post(`${base}/api/session`, {
    headers: { origin: new URL(base).origin, "content-type": "application/json" },
    data: { password: PASSWORD },
  });
  expect(res.ok(), `login: ${res.status()}`).toBe(true);
  cachedCookies.set(base, await page.context().cookies());
}

export async function taskStatus(page: Page, taskId: string, base = BASE): Promise<{ status: string; revision: number }> {
  const res = await page.request.get(`${base}/api/tasks/${taskId}`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { data: { task: { status: string; revision: number } } };
  return body.data.task;
}

export const statusBadge = (page: Page, status: string) => page.locator(`.badge[data-status="${status}"]`).first();

/** Download via the UI button and return the bytes the browser actually received. */
export async function downloadFile(page: Page, buttonName: RegExp) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: buttonName }).click()]);
  const path = await download.path();
  const bytes = readFileSync(path);
  return { name: download.suggestedFilename(), bytes };
}

/** A real Office file is a ZIP container with the expected part names. */
export function expectOfficeZip(bytes: Buffer, entry: string) {
  expect(bytes.length).toBeGreaterThan(100);
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  const text = bytes.toString("latin1");
  expect(text).toContain("[Content_Types].xml");
  expect(text).toContain(entry);
}

/** Minimal ZIP reader (stored and deflated entries) so tests can inspect what the browser really downloaded. */
export function readZip(bytes: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  expect(eocd, "ZIP end-of-central-directory record").toBeGreaterThanOrEqual(0);
  const count = bytes.readUInt16LE(eocd + 10);
  let p = bytes.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    expect(bytes.readUInt32LE(p)).toBe(0x02014b50);
    const method = bytes.readUInt16LE(p + 10);
    const compSize = bytes.readUInt32LE(p + 20);
    const nameLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const local = bytes.readUInt32LE(p + 42);
    const name = bytes.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Visible text of an OOXML part: tags removed, entities decoded. */
export function xmlText(part: Buffer | undefined): string {
  return (part?.toString("utf8") ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

let engineProbe: Promise<{ real: boolean; detail: string }> | null = null;

/**
 * The engine is Joanne's package. While it is the foundation stub, every task fails with ENGINE_NOT_IMPLEMENTED and
 * no ready result can exist. Tests that need generated work call this and are skipped (BLOCKED), never faked.
 */
export function probeEngine(page: Page) {
  engineProbe ??= (async () => {
    const { taskId } = await inject(page.request, "proposal", `e2e-probe-${Date.now()}`);
    for (let i = 0; i < 90; i++) {
      const res = await page.request.get(`${BASE}/api/tasks/${taskId}`);
      const body = (await res.json()) as { data: { task: { status: string; error: { code: string } | null } } };
      const t = body.data.task;
      if (t.status === "failed") {
        return { real: t.error?.code !== "ENGINE_NOT_IMPLEMENTED", detail: `probe task ${taskId} failed with ${t.error?.code}` };
      }
      if (["ready", "needs_input", "skipped", "approved"].includes(t.status)) return { real: true, detail: `probe task ${taskId} reached ${t.status}` };
      await page.waitForTimeout(1000);
    }
    return { real: false, detail: `probe task ${taskId} never finished` };
  })();
  return engineProbe;
}

/** Realistic answers for the engine's stable clarification question ids; the engine validates them (for example a fee needs an amount and a currency). */
const ANSWERS: Record<string, string> = {
  client_identity: "Maple & Moss",
  project_scope: "Brand refresh workshop, website content plan, and a launch checklist",
  authorized_fee: "USD 6,000",
  project_schedule: "Start October 26, 2026 for 4 weeks",
};

/** Fill every clarification textarea (ids look like q-<questionId>) with a valid answer. Returns the answers given. */
export async function fillClarifications(form: import("@playwright/test").Locator): Promise<string[]> {
  const areas = form.locator("textarea");
  const n = await areas.count();
  const given: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = ((await areas.nth(i).getAttribute("id")) ?? "").replace(/^q-/, "");
    const text = ANSWERS[id] ?? "As described in the request";
    await areas.nth(i).fill(text);
    given.push(text);
  }
  return given;
}
