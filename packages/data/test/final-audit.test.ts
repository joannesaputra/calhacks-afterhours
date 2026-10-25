// Final audit regressions for Gmail error classification and the automation / auto-prepare semantics the Settings
// copy describes. Google is replaced by an in-memory GmailApi; these tests do not prove live Google access.
import { describe, expect, it } from "vitest";
import { describeGmailError, getGmailRow, isGmailAuthError, patchSettings, pollGmailOnce, saveGmailConnection, type GmailApi, type GmailMessage } from "../src";
import { makeTestConfig, makeTestDb } from "../src/testing";

const T0 = new Date("2026-10-20T17:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const message = (id: string, ms: number, from = "boss@client.test"): GmailMessage => ({
  id, threadId: `t-${id}`, internalDate: String(ms), labelIds: ["INBOX"],
  payload: {
    mimeType: "text/plain",
    headers: [{ name: "From", value: from }, { name: "To", value: "inbox@test.dev" }, { name: "Subject", value: `Request ${id}` }],
    body: { data: Buffer.from("Please prepare a short report.").toString("base64url") },
  },
});
function inbox(all: GmailMessage[], listError?: unknown): GmailApi {
  return {
    async getProfileEmail() { return "inbox@test.dev"; },
    async listInbox(q) {
      if (listError) throw listError;
      const after = Number(/after:(\d+)/.exec(q)?.[1] ?? 0) * 1000;
      return { ids: all.filter((m) => Number(m.internalDate) >= after).sort((a, b) => Number(b.internalDate) - Number(a.internalDate)).map((m) => m.id), nextPageToken: null };
    },
    async getMessage(id) { return all.find((m) => m.id === id)!; },
    async getAttachment() { return Buffer.alloc(0); },
  };
}
function connected() {
  const { db, config } = makeTestDb(makeTestConfig());
  saveGmailConnection(db, config.tokenEncryptionKey, { account: "inbox@test.dev", tokens: { access_token: "a1", refresh_token: "r1" } }, T0);
  patchSettings(db, { allowedSenders: ["boss@client.test"] }, T0);
  return { db, config };
}
const tasks = (db: ReturnType<typeof makeTestDb>["db"]) => (db.prepare("SELECT COUNT(*) n FROM tasks").get() as { n: number }).n;
/** The shape google-auth-library / gaxios throws for an HTTP error: the status is a property, not in the text. */
const googleError = (status: number, message: string) => Object.assign(new Error(message), { status, response: { status } });

describe("Gmail error classification uses the HTTP status, not only the message text", () => {
  it("a 401 whose text has no recognised keyword pauses polling with reconnect guidance", async () => {
    const error = googleError(401, "Request had invalid authentication credentials. Expected OAuth 2 access token.");
    expect(isGmailAuthError(error)).toBe(true);
    const { db, config } = connected();
    const r = await pollGmailOnce({ db, config, now: () => at(30), makeApi: () => inbox([], error) });
    expect(r.error).toMatch(/Reconnect Gmail/);
    expect(getGmailRow(db)!.auth_failed_at).not.toBeNull();
    expect((await pollGmailOnce({ db, config, now: () => at(45), makeApi: () => { throw new Error("must not call Google while paused"); } })).status).toBe("paused");
  });

  it("a 403 rate limit is not an auth failure: polling keeps its schedule", async () => {
    const error = googleError(403, "User-rate limit exceeded. Retry after 2026-10-20T17:01:00Z");
    expect(isGmailAuthError(error)).toBe(false);
    const { db, config } = connected();
    const r = await pollGmailOnce({ db, config, now: () => at(30), makeApi: () => inbox([], error) });
    expect(r.error).toMatch(/rate limit/);
    expect(getGmailRow(db)!.auth_failed_at).toBeNull();
  });

  it("a disabled Gmail API is named as an operator setup problem instead of a vague retry", () => {
    const error = googleError(403, "Gmail API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123");
    expect(isGmailAuthError(error)).toBe(false);
    expect(describeGmailError(error)).toBe("The Gmail API is not enabled in the Google Cloud project. The operator must enable it; polling will retry.");
  });
});

describe("automation and auto-prepare semantics (what Settings tells the user)", () => {
  it("automation off: Gmail is not read; mail that arrived meanwhile is picked up when it is turned back on", async () => {
    const { db, config } = connected();
    patchSettings(db, { automationEnabled: false }, T0);
    const mail = [message("m1", at(20).getTime())];
    expect((await pollGmailOnce({ db, config, now: () => at(30), makeApi: () => { throw new Error("must not read Gmail"); } })).status).toBe("disabled");
    patchSettings(db, { automationEnabled: true }, at(40));
    const r = await pollGmailOnce({ db, config, now: () => at(50), makeApi: () => inbox(mail) });
    expect(r).toMatchObject({ status: "ok", ingested: 1 });
    expect(tasks(db)).toBe(1);
  });

  it("auto-prepare off: an approved sender's mail is ignored, not held, and is not prepared after turning it back on", async () => {
    const { db, config } = connected();
    patchSettings(db, { autoPrepare: false }, T0);
    const mail = [message("m1", at(20).getTime())];
    expect(await pollGmailOnce({ db, config, now: () => at(30), makeApi: () => inbox(mail) })).toMatchObject({ status: "ok", ingested: 0, ignored: 1 });
    expect(tasks(db)).toBe(0);
    expect((db.prepare("SELECT reason FROM intake_audit").get() as { reason: string }).reason).toBe("auto_prepare_disabled");
    patchSettings(db, { autoPrepare: true }, at(40));
    expect(await pollGmailOnce({ db, config, now: () => at(50), makeApi: () => inbox(mail) })).toMatchObject({ status: "ok", ingested: 0 });
    expect(tasks(db)).toBe(0);
  });
});
