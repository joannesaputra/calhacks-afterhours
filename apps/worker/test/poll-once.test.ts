// The intake-only Gmail check must queue new mail without running generation, and must stay idempotent.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { patchSettings, saveGmailConnection, type GmailApi, type GmailMessage } from "@afterhours/data";
import { makeTestConfig, makeTestDb } from "@afterhours/data/testing";
import { pollIntakeOnce } from "../src/poll-once";

const T0 = new Date("2026-10-20T17:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const mail: GmailMessage = {
  id: "m1", threadId: "t1", internalDate: String(at(20).getTime()), labelIds: ["INBOX"],
  payload: {
    mimeType: "text/plain",
    headers: [{ name: "From", value: "Boss <boss@client.test>" }, { name: "To", value: "inbox@test.dev" }, { name: "Subject", value: "AfterHours Gmail test" }],
    body: { data: Buffer.from("Please prepare a proposal.").toString("base64url") },
  },
};
const api: GmailApi = {
  async getProfileEmail() { return "inbox@test.dev"; },
  async listInbox() { return { ids: ["m1"], nextPageToken: null }; },
  async getMessage() { return mail; },
  async getAttachment() { return Buffer.alloc(0); },
};

describe("gmail:poll-once", () => {
  it("queues one live-mode Gmail task and runs nothing: no attempt, no progress, no files, no notification", async () => {
    // Live mode with no model key: if anything tried to generate, the task would fail instead of staying queued.
    const { db, config } = makeTestDb(makeTestConfig({ GENERATION_MODE: "live", MODEL_PROVIDER: "anthropic" }));
    saveGmailConnection(db, config.tokenEncryptionKey, { account: "inbox@test.dev", tokens: { refresh_token: "r1" } }, T0);
    patchSettings(db, { allowedSenders: ["boss@client.test"] }, T0);

    const report = await pollIntakeOnce({ db, config, now: () => at(30), makeApi: () => api });
    expect(report).toMatchObject({ status: "ok", ingested: 1, queuedJobsBefore: 0, queuedJobsAfter: 1, workerHealthy: false });
    expect(report.newTasks).toEqual([{ id: expect.any(String), ingestionMode: "gmail", generationMode: "live", status: "queued", receivedAt: at(20).toISOString() }]);
    const id = report.newTasks[0]!.id;
    expect(db.prepare("SELECT status, attempts, lease_owner FROM jobs WHERE task_id=?").get(id)).toEqual({ status: "queued", attempts: 0, lease_owner: null });
    const count = (sql: string) => (db.prepare(sql).get(id) as { n: number }).n;
    expect(count("SELECT COUNT(*) n FROM task_events WHERE task_id=? AND stage NOT IN ('intake')")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM artifacts WHERE task_id=?")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM notification_members WHERE task_id=?")).toBe(0);

    const again = await pollIntakeOnce({ db, config, now: () => at(45), makeApi: () => api });
    expect(again).toMatchObject({ status: "ok", ingested: 0, newTasks: [], queuedJobsAfter: 1 });
  });

  it("the entry point cannot reach generation or delivery: it imports neither package", () => {
    for (const file of ["../src/poll-once.ts", "../src/poll-once-main.ts"]) {
      const source = readFileSync(resolve(import.meta.dirname, file), "utf8");
      expect(source).not.toMatch(/@afterhours\/(engine|delivery)|from "\.\/worker"/);
    }
  });
});
