import { expect, test } from "@playwright/test";
import { CLI_TOKEN, FAIL_BASE, inject, login, statusBadge, taskStatus } from "./helpers";

// These run against the second stack whose live model has no credentials, so every task fails with the real
// MODEL_NOT_CONFIGURED error. Nothing is faked: the worker, API, and database are real.
test.describe.configure({ mode: "serial" });

test("17. an unconfigured live model fails honestly, points to Settings, and a double-clicked retry makes one new revision", async ({ page }) => {
  expect(CLI_TOKEN).not.toBe("");
  await login(page, FAIL_BASE);
  const { taskId } = await inject(page.request, "proposal", undefined, FAIL_BASE);
  await page.goto(`${FAIL_BASE}/tasks/${taskId}`);
  await expect(statusBadge(page, "failed")).toBeVisible({ timeout: 90_000 });

  await expect(page.getByRole("heading", { name: "Preparation failed" })).toBeVisible();
  await expect(page.getByText("MODEL_NOT_CONFIGURED").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" }).first()).toBeVisible();
  await expect(page.getByText("Live model not configured")).toBeVisible();
  await expect(page.getByRole("button", { name: /Download/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toHaveCount(0);

  // Two rapid clicks must create exactly one new revision.
  await page.getByRole("button", { name: "Retry preparation" }).dblclick();
  await expect(page.getByText(/Revision 2/).first()).toBeVisible({ timeout: 30_000 });
  await expect(statusBadge(page, "failed")).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  expect((await taskStatus(page, taskId, FAIL_BASE)).revision).toBe(2);

  // History from both revisions stays visible.
  await page.getByRole("tab", { name: /^Activity/ }).click();
  await expect(page.getByRole("tabpanel").getByText("revision 1").first()).toBeVisible();
  await expect(page.getByRole("tabpanel").getByText("revision 2").first()).toBeVisible();

  // The queue card tells the same story and offers settings, not a retry loop.
  await page.goto(`${FAIL_BASE}/?filter=failed`);
  await expect(page.getByRole("article").first()).toContainText("MODEL_NOT_CONFIGURED");
  await expect(page.getByRole("article").first().getByRole("link", { name: "Check settings" })).toBeVisible();
});

test("18. a failed task can be dismissed and then is closed for good", async ({ page }) => {
  await login(page, FAIL_BASE);
  const { taskId } = await inject(page.request, "proposal", undefined, FAIL_BASE);
  await page.goto(`${FAIL_BASE}/tasks/${taskId}`);
  await expect(statusBadge(page, "failed")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Dismiss this task" }).click();
  await page.getByRole("button", { name: "Yes, dismiss" }).click();
  await expect(statusBadge(page, "dismissed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry preparation" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Dismissed" })).toBeVisible();
  await page.reload();
  await expect(statusBadge(page, "dismissed")).toBeVisible();
});
