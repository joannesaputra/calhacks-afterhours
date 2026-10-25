import { expect, test } from "@playwright/test";
import { BASE, expectOfficeZip, inject, login, readZip, statusBadge, taskStatus, xmlText } from "./helpers";

test.describe.configure({ mode: "serial" });

test("revision: the attached deck is edited in place, every requested change is accounted for, and Mark reviewed sends nothing", async ({ page }) => {
  await login(page);
  const { taskId } = await inject(page.request, "revision");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
  // dashboard states
  await expect(page.getByTestId("context-phase").first()).toHaveText("Ready for review");
  await page.getByRole("tab", { name: "Context used" }).click();
  const used = page.getByTestId("context-used");
  await expect(used.getByText("kickoff-deck.pptx").first()).toBeVisible();
  await expect(used.getByText("Attachment as sent")).toBeVisible();
  await expect(used.getByText(/Named or attached in the request/)).toBeVisible(); // the request carried the file itself
  await expect(used.getByText("Applied").first()).toBeVisible();
  await expect(used.getByText("Not supported", { exact: true })).toBeVisible(); // "Make the closing warmer." is reported, not guessed at
  const summary = page.getByTestId("change-summary");
  await expect(summary).toContainText("2 slides changed, 2 unchanged");
  await expect(summary).toContainText("original was not modified");
  // the downloaded file is the revised deck, not a rebuilt one
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download/ }).first().click()]);
  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(await download.path());
  expect(download.suggestedFilename()).toMatch(/kickoff-deck-revised-r1\.pptx$/);
  expectOfficeZip(bytes, "ppt/presentation.xml");
  const zip = readZip(bytes);
  expect(xmlText(zip.get("ppt/slides/slide2.xml"))).toContain("Fee is $45,000");
  expect(xmlText(zip.get("ppt/slides/slide2.xml"))).not.toContain("$50,000");
  expect(xmlText(zip.get("ppt/slides/slide3.xml"))).toContain("Launch review on Friday");
  expect(xmlText(zip.get("ppt/slides/slide4.xml"))).toContain("Questions?");
  expect(xmlText(zip.get("ppt/slides/slide1.xml"))).toContain("Maple & Moss kickoff");
  // Mark reviewed records review only
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(statusBadge(page, "approved")).toBeVisible();
  await expect(page.getByText("Nothing was sent").first()).toBeVisible();
  const detail = (await (await page.request.get(`${BASE}/api/tasks/${taskId}`)).json()) as { data: { notifications: Array<{ state: string }> } };
  expect(detail.data.notifications.every((n) => n.state === "simulated" || n.state === "queued")).toBe(true);
});

test("clarification: two attached decks ask which one, the answer resumes, and the choice is on record", async ({ page }) => {
  await login(page);
  const { taskId } = await inject(page.request, "revision_choice");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "needs_input")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "AfterHours needs a few answers" })).toBeVisible();
  await expect(page.getByText(/Which presentation should I revise/)).toBeVisible();
  const radios = page.getByRole("radio");
  await expect(radios).toHaveCount(2);
  await page.getByRole("button", { name: "Submit answers and resume" }).click(); // required: nothing chosen
  await expect(page.getByText("This answer is required.")).toBeVisible();
  await page.getByRole("radio", { name: /results-deck\.pptx/ }).check();
  await page.getByRole("button", { name: "Submit answers and resume" }).click();
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
  expect((await taskStatus(page, taskId)).revision).toBe(2);
  await page.getByRole("tab", { name: "Context used" }).click();
  await expect(page.getByTestId("context-used").getByText("You chose it")).toBeVisible();
  await expect(page.getByTestId("context-used").getByText("results-deck.pptx").first()).toBeVisible();
  // the other deck stays visible as a candidate that was considered
  await expect(page.getByTestId("context-used").getByText("proposal-deck.pptx").first()).toBeVisible();
});

test("consent: history and files are separate choices, limits are stated, and unavailable sources say so", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  const section = page.locator("#context-access");
  await expect(section.getByRole("heading", { name: /Email history and files/ })).toBeVisible();
  await expect(section.getByText(/Connect Gmail first/)).toBeVisible();
  await expect(section.getByText(/attach the presentation to a new email/i)).toBeVisible();
  await expect(section.getByText(/No local folder source is configured/)).toBeVisible();
  await expect(section.getByText(/Google Drive is not connected/)).toBeVisible();
  await expect(section.getByRole("button", { name: /Allow reading/ })).toHaveCount(0);
});

test("sender policy: the choice defaults to approved, explains each option, warns for everyone, and persists", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  const form = page.getByRole("form", { name: "Automation" });
  const approved = form.getByRole("radio", { name: /Approved senders only/ });
  await expect(approved).toBeChecked();
  await expect(form.getByText(/Connect Gmail first. Then anyone at the connected mailbox/)).toBeVisible();
  await form.getByRole("radio", { name: /Everyone/ }).check();
  await expect(form.getByText(/Anyone who emails this mailbox can start a task/)).toBeVisible();
  await expect(form.getByText("Unsaved changes").first()).toBeVisible();
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("form", { name: "Automation" }).getByRole("radio", { name: /Everyone/ })).toBeChecked();
  // restore the default so later tests start from the safe setting
  const again = page.getByRole("form", { name: "Automation" });
  await again.getByRole("radio", { name: /Approved senders only/ }).check();
  await again.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
});

test("preview: clicking a file opens it beside the task before any download, and closes with Escape", async ({ page }) => {
  await login(page);
  const { taskId } = await inject(page.request, "proposal");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });

  const deckButton = page.getByRole("button", { name: /^Preview .*\.pptx$/ });
  await deckButton.click();
  const drawer = page.getByTestId("file-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: /\.pptx$/ })).toBeVisible();
  await expect(drawer.getByText(/not a pixel-accurate Word or PowerPoint rendering/)).toBeVisible();
  await expect(drawer.locator(".thumbs li")).toHaveCount(5);
  await drawer.locator(".thumb").nth(2).click();
  await expect(drawer.locator(".slide")).toBeVisible();
  // the file can be downloaded from the panel itself
  const [download] = await Promise.all([page.waitForEvent("download"), drawer.getByRole("button", { name: /^Download .*\.pptx$/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.pptx$/);

  // Escape closes it and returns focus to the file that opened it
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(deckButton).toBeFocused();

  // the document opens as a page, and clicking outside the panel closes it
  await page.getByRole("button", { name: /^Preview .*\.docx$/ }).click();
  await expect(drawer.locator(".doc-page")).toBeVisible();
  await page.locator(".drawer-scrim").click({ position: { x: 10, y: 10 } });
  await expect(drawer).toBeHidden();
});

test("send back: offered only after review, and a demo message explains there is nobody to reply to", async ({ page }) => {
  await login(page);
  const { taskId } = await inject(page.request, "proposal");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("reply-panel")).toHaveCount(0); // not before review
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(page.getByRole("heading", { name: "Marked reviewed" })).toBeVisible();
  const panel = page.getByTestId("reply-panel");
  await expect(panel.getByRole("heading", { name: "Send back to the sender" })).toBeVisible();
  await expect(panel.getByTestId("reply-reason")).toContainText(/demo message, not a real email/);
  await expect(panel.getByRole("button", { name: /Send reply to/ })).toHaveCount(0);
  await expect(panel.getByRole("link", { name: "Allow sending replies" })).toHaveCount(0);
  await expect(page.getByText(/Nothing was sent to anyone/)).toBeVisible(); // review still only records acceptance
});

test("delete: a finished task is removed only after an explicit confirmation, and it is gone for good", async ({ page }) => {
  await login(page);
  const { taskId } = await inject(page.request, "proposal");
  await page.goto(`/tasks/${taskId}`);
  await expect(statusBadge(page, "ready")).toBeVisible({ timeout: 90_000 });

  await page.getByRole("button", { name: "Delete task" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this task?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/cannot be undone/)).toBeVisible();
  await expect(dialog.getByText(/original email in Gmail is not touched/)).toBeVisible();
  // Cancel keeps everything
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await taskStatus(page, taskId)).status).toBe("ready");

  await page.getByRole("button", { name: "Delete task" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete permanently" }).click();
  await page.waitForURL(`${BASE}/`);
  await expect(page.getByText("Task deleted.")).toBeVisible();
  const gone = await page.request.get(`${BASE}/api/tasks/${taskId}`);
  expect(gone.status()).toBe(404);
  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByText(/not found|could not find/i).first()).toBeVisible();
});
