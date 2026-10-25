import { expect, test, type Page } from "@playwright/test";
import {
  BASE, CLI_TOKEN, PASSWORD, downloadFile, expectOfficeZip, fillClarifications, inject, login, probeEngine, readZip, statusBadge, taskStatus, xmlText,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const BLOCKED = "BLOCKED: the engine is still the foundation stub (ENGINE_NOT_IMPLEMENTED), so no ready task can exist. Not a pass.";

/** Logs in and skips (BLOCKED) when the real engine is not installed. */
async function needEngine(page: Page) {
  await login(page);
  const probe = await probeEngine(page);
  test.skip(!probe.real, `${BLOCKED} (${probe.detail})`);
}

test("0. with the stub engine, failure is honest: failed state, no files, no review", async ({ page }) => {
  await login(page);
  const probe = await probeEngine(page);
  test.skip(probe.real, "Engine is real; the stub-failure check does not apply.");
  const { taskId } = await inject(page.request, "proposal");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "failed")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Preparation failed" })).toBeVisible();
  await expect(page.getByText("ENGINE_NOT_IMPLEMENTED").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Download/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry preparation" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("article", { name: /Maple|Proposal/i }).first()).toContainText("ENGINE_NOT_IMPLEMENTED");
});

test("1. proposal: inject, observe progress, preview both products, download real files, mark reviewed, persists", async ({ page }) => {
  await needEngine(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Run demo/ }).click();
  await page.getByRole("button", { name: /Proposal \+ kickoff deck/ }).click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  const taskId = page.url().split("/").pop()!;
  test.info().annotations.push({ type: "taskId", description: taskId });

  // Real, persisted progress is visible while the worker runs.
  await page.getByRole("tab", { name: /^Activity/ }).click();
  await expect(page.locator(".details-tabs").getByRole("tabpanel").getByText("Reading request").first()).toBeVisible();
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });

  // One proposal document and one presentation, both previewable.
  await expect(page.getByRole("heading", { name: "Content preview" })).toBeVisible();
  const productTabs = page.getByRole("tablist", { name: "Products" }).getByRole("tab");
  await expect(productTabs).toHaveCount(2);
  const docTitle = (await page.locator(".doc-title").innerText()).trim();
  await expect(page.locator(".doc-page")).toContainText(/6,000/);
  await productTabs.filter({ hasText: /Presentation/ }).click();
  await expect(page.locator(".thumbs li")).toHaveCount(5);
  const slideTitles = await page.locator(".thumb-title").allInnerTexts();
  await page.locator(".thumb").nth(3).click();
  await expect(page.locator(".slide")).toBeVisible();

  // Source references open the actual excerpt in an accessible dialog.
  await productTabs.filter({ hasText: /Proposal/ }).click();
  const chip = page.locator(".doc-page .chip").first();
  await chip.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Excerpt" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Real downloads: inspect the bytes the browser received, and compare them with the preview.
  const docx = await downloadFile(page, /Download .*\.docx/);
  expect(docx.name).toMatch(/\.docx$/);
  expectOfficeZip(docx.bytes, "word/document.xml");
  const docxParts = readZip(docx.bytes);
  expect(xmlText(docxParts.get("word/document.xml"))).toContain(docTitle);
  expect(xmlText(docxParts.get("word/document.xml"))).toMatch(/6,000/);

  const pptx = await downloadFile(page, /Download .*\.pptx/);
  expect(pptx.name).toMatch(/\.pptx$/);
  expectOfficeZip(pptx.bytes, "ppt/presentation.xml");
  const pptxParts = readZip(pptx.bytes);
  const slideParts = [...pptxParts.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
  expect(slideParts, "five slide parts in the PPTX").toHaveLength(5);
  const deckText = slideParts.map((k) => xmlText(pptxParts.get(k))).join("\n");
  for (const title of slideTitles) expect(deckText).toContain(title.trim());

  // Review is recorded server-side and survives a reload.
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(page.getByRole("heading", { name: "Marked reviewed" })).toBeVisible();
  await page.reload();
  await expect(statusBadge(page, "approved")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Marked reviewed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toHaveCount(0);
  expect((await taskStatus(page, taskId)).status).toBe("approved");
});

test("2. report: calculated values appear consistently in the preview and chart data", async ({ page }) => {
  await needEngine(page);
  const { taskId } = await inject(page.request, "report");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
  const main = page.getByRole("main");
  for (const value of [/12,000/, /15,000/, /3,000/, /25%/]) await expect(main.locator(".doc-page")).toContainText(value);
  const chart = page.locator(".chart-svg").first();
  await expect(chart).toHaveAttribute("aria-label", /12,000/);
  await expect(chart).toHaveAttribute("aria-label", /15,000/);
  await page.getByText(/^Chart data/).first().click();
  await expect(page.locator(".chart-data table").first()).toContainText("12,000");

  // The downloaded report and deck carry the same numbers as the preview.
  const docx = await downloadFile(page, /Download .*\.docx/);
  const docText = xmlText(readZip(docx.bytes).get("word/document.xml"));
  for (const value of [/12,000/, /15,000/, /3,000/, /25%/]) expect(docText).toMatch(value);
  const pptx = await downloadFile(page, /Download .*\.pptx/);
  const pptxParts = readZip(pptx.bytes);
  const deckText = [...pptxParts.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).map((k) => xmlText(pptxParts.get(k))).join("\n");
  expect(deckText).toMatch(/25%/);
  // The deck's chart is a native chart: its data lives in the chart part, as plain numbers.
  const chartParts = [...pptxParts.keys()].filter((k) => /^ppt\/charts\/chart\d+\.xml$/.test(k));
  expect(chartParts.length, "native chart part(s) in the PPTX").toBeGreaterThan(0);
  const chartXml = chartParts.map((k) => pptxParts.get(k)!.toString("utf8")).join("\n");
  expect(chartXml).toMatch(/<c:v>12000<\/c:v>/);
  expect(chartXml).toMatch(/<c:v>15000<\/c:v>/);
});

test("3. ambiguous: answer the questions, get a new revision, and generation resumes", async ({ page }) => {
  await needEngine(page);
  const { taskId } = await inject(page.request, "ambiguous");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "needs_input")).toBeVisible({ timeout: 90_000 });
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: /Submit answers/ }) });

  // Required answers are enforced before anything is sent.
  await form.getByRole("button", { name: /Submit answers/ }).click();
  await expect(form.getByText("This answer is required.").first()).toBeVisible();
  expect((await taskStatus(page, taskId)).revision).toBe(1);

  expect(await form.locator("textarea").count()).toBeGreaterThan(0);
  // The engine validates answers (a fee needs an amount and currency), so give real ones.
  await fillClarifications(form);
  await form.getByRole("button", { name: /Submit answers/ }).click();
  await expect(page.getByText(/Revision 2/).first()).toBeVisible({ timeout: 30_000 });
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
  expect((await taskStatus(page, taskId)).revision).toBe(2);

  // Activity keeps both revisions, and the earlier answers stay on record in the Plan tab.
  await page.getByRole("tab", { name: /^Activity/ }).click();
  const activity = page.locator(".details-tabs").getByRole("tabpanel");
  await expect(activity.getByText("revision 1").first()).toBeVisible();
  await expect(activity.getByText("revision 2").first()).toBeVisible();
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  await expect(page.locator(".details-tabs").getByRole("tabpanel").getByRole("heading", { name: "Your answers" })).toBeVisible();
  await expect(page.locator(".details-tabs").getByRole("tabpanel")).toContainText("Brand refresh workshop");
});

test("4. duplicate replayKey returns one task", async ({ page }) => {
  await login(page);
  const key = `e2e-dup-${Date.now()}`;
  const before = await page.request.get(`${BASE}/api/tasks?limit=100`);
  const countBefore = ((await before.json()) as { data: { items: unknown[] } }).data.items.length;
  const first = await inject(page.request, "proposal", key);
  const second = await inject(page.request, "proposal", key);
  expect(second.taskId).toBe(first.taskId);
  expect(first.deduplicated).toBe(false);
  expect(second.deduplicated).toBe(true);
  const after = await page.request.get(`${BASE}/api/tasks?limit=100`);
  expect(((await after.json()) as { data: { items: unknown[] } }).data.items.length).toBe(countBefore + 1);
});

test("5. no_action is skipped and offers no downloads", async ({ page }) => {
  await needEngine(page);
  const { taskId } = await inject(page.request, "no_action");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "skipped")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "No action needed" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Download/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toHaveCount(0);
});

test("6. notifications are labeled honestly (simulated outbox, never delivered)", async ({ page }) => {
  await needEngine(page);
  const { taskId } = await inject(page.request, "proposal");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
  await page.goto("/notifications");
  await expect(page.getByText("Simulated (outbox)").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/not sent to any phone or inbox/).first()).toBeVisible();
  await expect(page.getByText("Delivered", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Accepted by provider")).toHaveCount(0);
});

test("7. an unauthenticated deep link goes to login and returns to the task", async ({ browser, page, request }) => {
  await login(page);
  const { taskId } = await inject(page.request, "no_action");
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await anon.goto(`${BASE}/tasks/${taskId}`);
  await anon.waitForURL(/\/login\?returnTo=/);
  expect(decodeURIComponent(new URL(anon.url()).searchParams.get("returnTo") ?? "")).toBe(`/tasks/${taskId}`);
  await anon.getByLabel("Password").fill("definitely-wrong");
  await anon.getByRole("button", { name: "Sign in" }).click();
  await expect(anon.getByText("Incorrect password.")).toBeVisible();
  await anon.getByLabel("Password").fill(PASSWORD);
  await anon.getByRole("button", { name: "Sign in" }).click();
  await anon.waitForURL(`${BASE}/tasks/${taskId}`);
  await expect(anon.getByRole("heading", { level: 1 })).toBeVisible();

  // External returnTo values are never followed; the CLI token cannot read private data.
  const evil = await ctx.newPage();
  await evil.goto(`${BASE}/login?returnTo=${encodeURIComponent("https://evil.example/")}`);
  await expect(evil.getByRole("heading", { name: "Private workspace" })).toBeVisible();
  expect(new URL(evil.url()).origin).toBe(new URL(BASE).origin);
  const cli = await request.get(`${BASE}/api/tasks`, { headers: { authorization: `Bearer ${CLI_TOKEN}` }, failOnStatusCode: false });
  expect(cli.status()).toBe(401);
  // Artifact downloads are private too.
  const dl = await request.get(`${BASE}/api/artifacts/anything/download`, { failOnStatusCode: false });
  expect(dl.status()).toBe(401);
  await ctx.close();
});

test("8. a stale review gets a 409 refresh prompt and approves nothing", async ({ page }) => {
  await needEngine(page);
  const { taskId } = await inject(page.request, "proposal");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
  // Make the browser submit an out-of-date revision to the real API.
  await page.route("**/api/tasks/*/review", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    await route.continue({ postData: JSON.stringify({ ...body, revision: 99 }) });
  });
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(page.getByText("This task changed. Refresh to review the latest version.").first()).toBeVisible();
  expect((await taskStatus(page, taskId)).status).toBe("ready");
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toBeDisabled();
  await page.unroute("**/api/tasks/*/review");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toBeEnabled();
});

test("9. queue and detail are usable on a phone-sized screen", async ({ browser, page }) => {
  await needEngine(page);
  const { taskId } = await inject(page.request, "proposal");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() });
  const m = await ctx.newPage();
  const noOverflow = async () => expect(await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await m.goto(`${BASE}/`);
  await expect(m.getByRole("heading", { name: "Ready for review" })).toBeVisible();
  await noOverflow();
  await m.goto(`${BASE}/tasks/${taskId}`);
  await expect(statusBadge(m, "ready")).toBeVisible({ timeout: 90_000 });
  await noOverflow();
  const button = m.getByRole("button", { name: "Mark reviewed" });
  await button.scrollIntoViewIfNeeded();
  expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
  await m.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(m.getByRole("heading", { name: "Marked reviewed" })).toBeVisible();
  await noOverflow();
  await ctx.close();
});

test("10. settings persist across a reload", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toBeVisible();
  const original = await name.inputValue();
  await name.fill(`${original} QA`);
  await expect(page.getByText("Unsaved changes").first()).toBeVisible();
  await page.getByRole("form", { name: "Organization" }).getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`${original} QA`);
});

test("11. ingestion time and original email time are labeled separately and are the real values", async ({ page }) => {
  await login(page);
  const { taskId } = await inject(page.request, "proposal");
  const res = await page.request.get(`${BASE}/api/tasks/${taskId}`);
  const detail = ((await res.json()) as { data: { task: { createdAt: string }; email: { receivedAt: string } } }).data;
  const settings = await page.request.get(`${BASE}/api/settings`);
  const tz = ((await settings.json()) as { data: { organization: { timezone: string } } }).data.organization.timezone;
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: tz, dateStyle: "medium" });

  await page.goto(`/tasks/${taskId}`);
  const times = page.getByTestId("task-times");
  await expect(times.getByText(/^Entered the system/)).toContainText(day(detail.task.createdAt));
  await expect(times.getByText(/^Original email received/)).toContainText(day(detail.email.receivedAt));

  // The request tab carries both labels as well.
  await page.getByRole("tab", { name: "Original request" }).click();
  await expect(page.locator(".details-tabs").getByRole("tabpanel").getByText("Original email received", { exact: true })).toBeVisible();
  await expect(page.locator(".details-tabs").getByRole("tabpanel").getByText("Entered the system", { exact: true })).toBeVisible();

  // Queue cards show only ingestion time, and say so.
  await page.goto("/");
  await expect(page.getByRole("article").first()).toContainText("entered the system");
});

test("12. keyboard: source dialog opens and closes with focus restored, and review works without a mouse", async ({ page }) => {
  await needEngine(page);
  const { taskId } = await inject(page.request, "proposal");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
  const chip = page.locator(".doc-page .chip").first();
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(chip).toBeFocused();

  const review = page.getByRole("button", { name: "Mark reviewed" });
  await review.focus();
  await expect(review).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Marked reviewed" })).toBeVisible();
});

test("13. a stale answers submission shows the conflict and keeps the typed text", async ({ page }) => {
  await needEngine(page);
  const { taskId } = await inject(page.request, "ambiguous");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "needs_input")).toBeVisible({ timeout: 90_000 });
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: /Submit answers/ }) });
  const areas = form.locator("textarea");
  const n = await areas.count();
  for (let i = 0; i < n; i++) await areas.nth(i).fill(`Unsent answer ${i + 1}`);

  await page.route("**/api/tasks/*/answers", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    await route.continue({ postData: JSON.stringify({ ...body, revision: 99 }) });
  });
  await form.getByRole("button", { name: /Submit answers/ }).click();
  await expect(page.getByText("This task changed. Refresh to review the latest version.").first()).toBeVisible();
  // Nothing was applied, the form is blocked until refresh, and the text the user typed is still there.
  expect(await taskStatus(page, taskId)).toMatchObject({ status: "needs_input", revision: 1 });
  await expect(areas.first()).toHaveValue("Unsent answer 1");
  await expect(form.getByRole("button", { name: /Submit answers/ })).toBeDisabled();
  await page.unroute("**/api/tasks/*/answers");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(areas.first()).toHaveValue("Unsent answer 1");
  await expect(form.getByRole("button", { name: /Submit answers/ })).toBeEnabled();
});

test("14. server-side answer validation is shown and does not lose input or create a revision", async ({ page }) => {
  await needEngine(page);
  const { taskId } = await inject(page.request, "ambiguous");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "needs_input")).toBeVisible({ timeout: 90_000 });
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: /Submit answers/ }) });
  const areas = form.locator("textarea");
  const n = await areas.count();
  for (let i = 0; i < n; i++) await areas.nth(i).fill(`Typed answer ${i + 1}`);

  // Let the browser pass its own checks, then make the server see an unknown question id (a real 400).
  await page.route("**/api/tasks/*/answers", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { answers: Array<{ questionId: string; answer: string }> };
    const answers = body.answers.map((a, i) => (i === 0 ? { ...a, questionId: "not-a-real-question" } : a));
    await route.continue({ postData: JSON.stringify({ ...body, answers }) });
  });
  await form.getByRole("button", { name: /Submit answers/ }).click();
  await expect(form.getByText(/The server rejected the answers/)).toBeVisible();
  expect(await taskStatus(page, taskId)).toMatchObject({ status: "needs_input", revision: 1 });
  await expect(areas.first()).toHaveValue("Typed answer 1");
  await page.unroute("**/api/tasks/*/answers");
});

test("15. a blocked notification does not hide, disable, or fail the finished work", async ({ page }) => {
  await needEngine(page);
  const origin = new URL(BASE).origin;
  const patch = (data: unknown) => page.request.patch(`${BASE}/api/settings`, { headers: { origin, "content-type": "application/json" }, data });
  expect((await patch({ notifications: { channel: "whatsapp", recipient: "+15551234567" } })).ok()).toBe(true);
  try {
    const { taskId } = await inject(page.request, "proposal");
    await page.goto(`/tasks/${taskId}`);
    await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("tab", { name: /^Notifications/ }).click();
    // The operator has not enabled live WhatsApp in this stack, so the message is blocked, not sent.
    await expect(page.locator(".details-tabs").getByRole("tabpanel").getByText("Blocked", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".details-tabs").getByRole("tabpanel").getByText(/WhatsApp is not configured|WHATSAPP_USE_CASE_ELIGIBLE|not confirmed/).first()).toBeVisible();
    await expect(page.locator(".details-tabs").getByRole("tabpanel").getByText("Delivered", { exact: true })).toHaveCount(0);
    // Files stay downloadable and the task can still be reviewed.
    const docx = await downloadFile(page, /Download .*\.docx/);
    expectOfficeZip(docx.bytes, "word/document.xml");
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(page.getByRole("heading", { name: "Marked reviewed" })).toBeVisible();
    expect((await taskStatus(page, taskId)).status).toBe("approved");
  } finally {
    await patch({ notifications: { channel: "outbox", recipient: null } });
  }
});

test("16. the source dialog shows the real evidence quote, and fits a phone screen", async ({ browser, page }) => {
  await needEngine(page);
  const { taskId } = await inject(page.request, "proposal");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
  const res = await page.request.get(`${BASE}/api/tasks/${taskId}`);
  const detail = ((await res.json()) as { data: { products: Array<{ blocks: Array<{ evidence: Array<{ sourceId: string; quote: string | null }> }> }>; sources: Array<{ id: string; title: string; text: string }> } }).data;
  const ref = detail.products.flatMap((p) => p.blocks.flatMap((b) => b.evidence)).find((e) => e.quote);
  test.skip(!ref, "BLOCKED: the engine returned evidence references with quote:null only, so there is no real quote to compare. Owner: Joanne (engine).");
  const source = detail.sources.find((s) => s.id === ref!.sourceId)!;
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  expect(norm(source.text)).toContain(norm(ref!.quote!)); // the engine's quote really is in the source

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() });
  const m = await ctx.newPage();
  await m.goto(`${BASE}/tasks/${taskId}`);
  await expect(statusBadge(m, "ready")).toBeVisible();
  await m.locator(".doc-page .chip", { hasText: source.title.slice(0, 12) }).first().click();
  const dialog = m.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".quote").first()).toContainText(ref!.quote!.slice(0, 40));
  await expect(dialog.getByText(/appears in the extracted source text/)).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await m.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await ctx.close();
});

test("19. very long titles, filenames, text and tables wrap on a phone and keep the actions reachable", async ({ browser, page }) => {
  // The real API response is fetched and then padded with hostile-length strings, so this exercises layout only.
  await needEngine(page);
  const { taskId } = await inject(page.request, "proposal");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() });
  const m = await ctx.newPage();
  const long = "Supercalifragilistic".repeat(12);
  await m.route(`**/api/tasks/${taskId}`, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const d = body.data;
    d.task.title = long;
    d.task.subject = long;
    d.email.subject = long;
    d.email.bodyText = long.repeat(5);
    for (const a of d.artifacts) a.filename = `${long}.${a.format}`;
    const first = d.products[0].blocks[0];
    first.text = long.repeat(4);
    d.products[0].blocks.push({
      id: "wide", kind: "table", heading: long, text: null, items: [], columns: Array.from({ length: 8 }, (_, i) => `Column ${i + 1} ${long}`),
      rows: [Array.from({ length: 8 }, () => long)], chart: null, evidence: [], basis: "recommendation",
    });
    await route.fulfill({ response: res, json: body });
  });
  await m.goto(`${BASE}/tasks/${taskId}`);
  await expect(statusBadge(m, "ready")).toBeVisible();
  // Name the offending elements (outside scrollable containers) so a failure points at the cause.
  const offenders = await m.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.parentElement?.closest(".table-scroll, .email-body, .thumbs, .toasts") && !e.closest(".skip-link"))
      .slice(0, 8)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} right=${Math.round(e.getBoundingClientRect().right)}`),
  );
  expect(offenders).toEqual([]);
  expect(await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const review = m.getByRole("button", { name: "Mark reviewed" });
  await review.scrollIntoViewIfNeeded();
  const box = await review.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await m.getByRole("button", { name: /^Download/ }).first().scrollIntoViewIfNeeded();
  await m.goto(`${BASE}/`);
  await expect(m.getByRole("heading", { name: "Ready for review" })).toBeVisible();
  expect(await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await ctx.close();
});

test("20. offline: actions fail visibly and are never queued to fire on reconnect", async ({ page, context }) => {
  await needEngine(page);
  const { taskId } = await inject(page.request, "proposal");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
  await context.setOffline(true);
  await expect(page.getByText("You are offline.")).toBeVisible();
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(page.getByText(/Could not reach the server/).first()).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("You are offline.")).toBeHidden();
  // Wait long enough for any hidden queued request to fire, then prove the task is still unreviewed.
  await page.waitForTimeout(3000);
  expect((await taskStatus(page, taskId)).status).toBe("ready");
  await expect(statusBadge(page, "ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toBeEnabled();
});

test("21. on a phone: a revoked (expired) session on a deep link returns to login, then back to the same task", async ({ browser, page }) => {
  await login(page);
  const { taskId } = await inject(page.request, "no_action");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // a phone opening a notification link
  const p = await ctx.newPage();
  // Take a real session, then revoke it on the server while the browser still holds the cookie.
  const res = await p.request.post(`${BASE}/api/session`, { headers: { origin: new URL(BASE).origin, "content-type": "application/json" }, data: { password: PASSWORD } });
  expect(res.ok()).toBe(true);
  const held = await ctx.cookies();
  expect((await p.request.delete(`${BASE}/api/session`, { headers: { origin: new URL(BASE).origin } })).ok()).toBe(true);
  await ctx.clearCookies();
  await ctx.addCookies(held); // the browser still sends the now-revoked token
  await p.goto(`${BASE}/tasks/${taskId}`);
  await p.waitForURL(/\/login\?returnTo=/);
  expect(decodeURIComponent(new URL(p.url()).searchParams.get("returnTo") ?? "")).toBe(`/tasks/${taskId}`);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL(`${BASE}/tasks/${taskId}`);
  await expect(p.getByRole("heading", { level: 1 })).toBeVisible();
  await ctx.close();
});

test("22. quiet hours: files are ready now, the notification shows its planned time in the workspace timezone", async ({ page }) => {
  await needEngine(page);
  const origin = new URL(BASE).origin;
  const patch = (data: unknown) => page.request.patch(`${BASE}/api/settings`, { headers: { origin, "content-type": "application/json" }, data });
  const current = await (await page.request.get(`${BASE}/api/settings`)).json();
  const tz: string = current.data.organization.timezone;
  const hhmm = (offsetMin: number) => {
    const d = new Date(Date.now() + offsetMin * 60_000);
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  };
  const quiet = { enabled: true, start: hhmm(-30), end: hhmm(90), timezone: tz };
  const ok = await patch({ notifications: { quietHours: quiet, digestTime: hhmm(180) } });
  expect(ok.ok(), "quiet hours accepted").toBe(true);
  try {
    const { taskId } = await inject(page.request, "proposal");
    await page.goto(`/tasks/${taskId}`);
    // Work is not delayed by quiet hours.
    await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("tab", { name: /^Notifications/ }).click();
    const panel = page.locator(".details-tabs").getByRole("tabpanel");
    await expect(panel.getByText("Queued", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText(/plan, not a promise/)).toBeVisible();
    await expect(panel.getByText("Currently planned for")).toBeVisible();
    await expect(panel.getByText("Files prepared")).toBeVisible();
    // The shown time is the backend's persisted schedule, formatted in the workspace timezone, and it is in the future.
    const detail = (await (await page.request.get(`${BASE}/api/tasks/${taskId}`)).json()).data;
    const note = detail.notifications[0];
    expect(Date.parse(note.scheduledFor)).toBeGreaterThan(Date.now());
    const shown = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeStyle: "short" }).format(new Date(note.scheduledFor));
    await expect(panel).toContainText(shown);
    await expect(panel.getByText("Simulated (outbox)")).toHaveCount(0); // queued is not sent
    // Review still works while the notification waits.
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(page.getByRole("heading", { name: "Marked reviewed" })).toBeVisible();
  } finally {
    await patch({ notifications: { quietHours: { enabled: false, start: "22:00", end: "07:00", timezone: tz }, digestTime: "08:00" } });
  }
});

test("23. a failed download shows an error and never saves a file", async ({ page }) => {
  await needEngine(page);
  const { taskId } = await inject(page.request, "proposal");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
  let saved = false;
  page.on("download", () => { saved = true; });
  // The server answers with a JSON error instead of a file; the page must not turn that into a document.
  await page.route("**/api/artifacts/*/download", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Simulated failure", requestId: "r" } }) }));
  await page.getByRole("button", { name: /Download .*\.docx/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Simulated failure|server answered|Something went wrong/ }).first()).toBeVisible();
  await expect(page.getByText(/^Downloaded /)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(saved).toBe(false);
  await expect(page.getByRole("button", { name: /Retry download/ })).toBeVisible();
  // After the problem clears, retrying produces a real file.
  await page.unroute("**/api/artifacts/*/download");
  const docx = await downloadFile(page, /Retry download of .*\.docx/);
  expectOfficeZip(docx.bytes, "word/document.xml");
});

test("24. login return: nested task path with a query is restored; a wrong password stays put; a manual login lands on the queue", async ({ browser, page }) => {
  await login(page);
  const { taskId } = await inject(page.request, "no_action");
  const origin = new URL(BASE).origin;

  // Expired session on a deep link with a query string: the whole same-origin path comes back after login.
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  expect((await p.request.post(`${BASE}/api/session`, { headers: { origin, "content-type": "application/json" }, data: { password: PASSWORD } })).ok()).toBe(true);
  const held = await ctx.cookies();
  expect((await p.request.delete(`${BASE}/api/session`, { headers: { origin } })).ok()).toBe(true);
  await ctx.clearCookies();
  await ctx.addCookies(held);
  await p.goto(`${BASE}/tasks/${taskId}?from=notification`);
  await p.waitForURL(/\/login\?returnTo=/);
  expect(decodeURIComponent(new URL(p.url()).searchParams.get("returnTo") ?? "")).toBe(`/tasks/${taskId}?from=notification`);
  // A wrong password does not leave the login page or lose the return target.
  await p.getByLabel("Password").fill("definitely-wrong");
  await p.getByRole("button", { name: "Sign in" }).click();
  await expect(p.getByText("Incorrect password.")).toBeVisible();
  expect(new URL(p.url()).pathname).toBe("/login");
  expect(decodeURIComponent(new URL(p.url()).searchParams.get("returnTo") ?? "")).toBe(`/tasks/${taskId}?from=notification`);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL(`${BASE}/tasks/${taskId}?from=notification`);
  await expect(p.getByRole("heading", { level: 1 })).toBeVisible();
  await ctx.close();

  // Manual login with no return target goes to the queue, never to an external address.
  const ctx2 = await browser.newContext();
  const q = await ctx2.newPage();
  await q.goto(`${BASE}/login`);
  await q.getByLabel("Password").fill(PASSWORD);
  await q.getByRole("button", { name: "Sign in" }).click();
  await q.waitForURL(`${BASE}/`);
  await ctx2.close();

  // Hostile return targets are ignored (the helper is also unit-tested for the full list).
  for (const bad of ["//evil.example/x", "/\\evil.example", "javascript:alert(1)", "%2F%2Fevil.example"]) {
    const c = await browser.newContext();
    const r = await c.newPage();
    await r.goto(`${BASE}/login?returnTo=${encodeURIComponent(bad)}`);
    await expect(r.getByRole("heading", { name: "Private workspace" })).toBeVisible();
    await c.close();
  }
});

test("25. logout revokes the session and the private queue is no longer reachable", async ({ browser }) => {
  const origin = new URL(BASE).origin;
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  // Own login (not the cached one other tests use), because logout revokes it on the server.
  expect((await p.request.post(`${BASE}/api/session`, { headers: { origin, "content-type": "application/json" }, data: { password: PASSWORD } })).ok()).toBe(true);
  await p.goto(`${BASE}/`);
  await expect(p.getByRole("heading", { name: "Ready for review" })).toBeVisible();
  const held = await ctx.cookies();
  await p.getByRole("button", { name: "Sign out" }).click();
  await p.waitForURL(/\/login/);
  await p.goto(`${BASE}/`);
  await p.waitForURL(/\/login\?returnTo=/);
  await expect(p.getByRole("article")).toHaveCount(0);
  // The old token is dead on the server even if a browser still holds it.
  await ctx.addCookies(held);
  expect((await p.request.get(`${BASE}/api/tasks`, { failOnStatusCode: false })).status()).toBe(401);
  await ctx.close();
});
