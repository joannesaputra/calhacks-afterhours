import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReplySendBodySchema } from "@afterhours/contracts";
import {
  GMAIL_SEND_SCOPE, SEND_STALE_MS, attachmentName, buildReplyMime, getReplyView, hasSendScope, headerSafe, replySubject, sendReply,
  type GmailApi, type GmailMessage, type ReplyDeps,
} from "../src";
import { makeTestDb, seedApprovedReply } from "../src/testing";

const decode = (raw: Buffer) => raw.toString("utf8");

describe("buildReplyMime", () => {
  const base = { from: "me@acme.example", to: "jordan@client.example", subject: "Re: Plan", text: "Hello\nthere", inReplyTo: "<abc@mail.example>", references: "<abc@mail.example>", attachments: [] };

  it("builds a threaded multipart message with one recipient and base64 attachments", () => {
    const raw = decode(buildReplyMime({ ...base, attachments: [{ filename: "Plan.pptx", mimeType: "application/vnd.x", bytes: Buffer.from("PK-binary") }] }));
    expect(raw).toMatch(/^From: me@acme\.example\r\nTo: jordan@client\.example\r\nSubject: Re: Plan\r\nIn-Reply-To: <abc@mail\.example>\r\nReferences: <abc@mail\.example>\r\n/);
    expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="=_ah_[0-9a-f]{24}"/);
    expect(raw).toContain('Content-Disposition: attachment; filename="Plan.pptx"');
    expect(raw).toContain(Buffer.from("PK-binary").toString("base64"));
    expect(raw).not.toMatch(/\r\nCc:|\r\nBcc:/i);
  });

  it("cannot be made to add recipients or headers through any field", () => {
    const raw = decode(buildReplyMime({
      ...base,
      subject: "Hello\r\nBcc: attacker@evil.example",
      inReplyTo: "<x@y>\r\nBcc: attacker@evil.example",
      attachments: [{ filename: 'a"\r\nBcc: attacker@evil.example/../b.pptx', mimeType: "text/plain\r\nBcc: attacker@evil.example", bytes: Buffer.from("x") }],
    }));
    const headerBlock = raw.split("\r\n\r\n")[0]!;
    expect(headerBlock.split("\r\n").filter((l) => /^bcc:/i.test(l))).toEqual([]);
    for (const line of raw.split("\r\n")) expect(/^bcc:/i.test(line)).toBe(false);
    expect(attachmentName('../../etc/pass"wd;x')).toBe("pass_wd_x");
  });

  it("rejects an address that is not a single plain mailbox", () => {
    for (const to of ["a@b.example, c@d.example", "A <a@b.example>", "a@b.example\r\nBcc: x@y.example", "nope", ""]) {
      expect(() => buildReplyMime({ ...base, to }), to).toThrow(/recipient/);
    }
    expect(() => buildReplyMime({ ...base, from: "bad" })).toThrow(/sending account/);
  });

  it("encodes a non-ASCII subject, keeps one 'Re:' and strips control characters", () => {
    expect(decode(buildReplyMime({ ...base, subject: "Café plan" }))).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(replySubject("Re: Plan")).toBe("Re: Plan");
    expect(replySubject("RE: Plan")).toBe("RE: Plan");
    expect(replySubject("Plan")).toBe("Re: Plan");
    expect(replySubject("")).toBe("Re: (no subject)");
    expect(headerSafe("a\r\nb\tc")).toBe("a b c");
  });

  it("recognizes the send permission only when granted", () => {
    expect(hasSendScope(`https://www.googleapis.com/auth/gmail.readonly ${GMAIL_SEND_SCOPE}`)).toBe(true);
    expect(hasSendScope("https://www.googleapis.com/auth/gmail.readonly")).toBe(false);
    expect(hasSendScope(null)).toBe(false);
  });
});

function fakeApi(opts: { fail?: unknown; delayMs?: number; noSend?: boolean } = {}) {
  const sent: { raw: string; threadId: string | null }[] = [];
  const api: GmailApi = {
    getProfileEmail: async () => "me@acme.example",
    listInbox: async () => ({ ids: [], nextPageToken: null }),
    getAttachment: async () => Buffer.alloc(0),
    getMessage: async (): Promise<GmailMessage> => ({
      id: "msg-1", threadId: "thr-1", internalDate: "0", labelIds: [],
      payload: { mimeType: "text/plain", headers: [{ name: "Message-ID", value: "<orig-1@client.example>" }, { name: "References", value: "<root@client.example>" }] },
    }),
    ...(opts.noSend ? {} : {
      sendMessage: async (raw: Buffer, threadId: string | null) => {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        if (opts.fail) throw opts.fail;
        sent.push({ raw: raw.toString("utf8"), threadId });
        return { id: `sent-${sent.length}`, threadId };
      },
    }),
  };
  return { api, sent };
}

function setup(seedOpts: Parameters<typeof seedApprovedReply>[2] = {}, apiOpts: Parameters<typeof fakeApi>[0] = {}) {
  const { db, config } = makeTestDb();
  const seed = seedApprovedReply(db, config, seedOpts);
  const fake = fakeApi(apiOpts);
  let clock = new Date("2026-03-03T09:00:00Z");
  const deps: ReplyDeps = { db, config, now: () => clock, makeApi: () => fake.api };
  const body = (over: Record<string, unknown> = {}) =>
    ReplySendBodySchema.parse({ revision: seed.revision, body: "Here you go.", artifactIds: seed.artifactIds, ...over });
  return { db, config, seed, fake, deps, body, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); } };
}

describe("reply view: why it can or cannot be sent", () => {
  it("is available for a reviewed Gmail task with permission, addressed to the original sender", () => {
    const t = setup();
    const v = getReplyView(t.db, t.config, t.seed.taskId, new Date());
    expect(v).toMatchObject({ available: true, reason: null, to: "jordan@client.example", from: "me@acme.example", subject: "Re: Please prepare the proposal" });
    expect(v.attachments.map((a) => a.filename).sort()).toEqual(["Proposal.docx", "Proposal.pptx"]);
    expect(v.defaultBody).toMatch(/^Hi Jordan,/);
  });

  it("explains each reason it is not available", () => {
    const view = (o: Parameters<typeof seedApprovedReply>[2]) => { const t = setup(o); return getReplyView(t.db, t.config, t.seed.taskId, new Date()); };
    expect(view({ status: "ready" })).toMatchObject({ available: false, reason: expect.stringMatching(/Mark this task reviewed first/) });
    expect(view({ mode: "demo" })).toMatchObject({ available: false, reason: expect.stringMatching(/demo message/) });
    expect(view({ scope: "https://www.googleapis.com/auth/gmail.readonly" })).toMatchObject({ available: false, needsSendPermission: true });
    expect(view({ connect: false })).toMatchObject({ available: false, reason: "Gmail is not connected." });
  });
});

describe("sendReply", () => {
  it("sends once to the original sender, in the original thread, with the chosen files, and records it", async () => {
    const t = setup();
    const view = await sendReply(t.deps, t.seed.taskId, t.body());
    expect(t.fake.sent).toHaveLength(1);
    const { raw, threadId } = t.fake.sent[0]!;
    expect(threadId).toBe("thr-1");
    expect(raw).toContain("To: jordan@client.example\r\n");
    expect(raw).toContain("In-Reply-To: <orig-1@client.example>");
    expect(raw).toContain("References: <root@client.example> <orig-1@client.example>");
    expect(raw).toContain('filename="Proposal.docx"');
    expect(raw).toContain('filename="Proposal.pptx"');
    expect(view.last).toMatchObject({ status: "sent", to: "jordan@client.example", uncertain: false });
    expect(view).toMatchObject({ available: false, reason: expect.stringMatching(/Already sent to jordan@client.example/) });
    const events = t.db.prepare("SELECT message FROM task_events WHERE task_id=? AND type='review'").all(t.seed.taskId) as { message: string }[];
    expect(events.map((e) => e.message)).toContain("Reply sent to jordan@client.example with 2 files.");
    // the stored record keeps no message text or file bytes
    const row = JSON.stringify(t.db.prepare("SELECT * FROM reply_sends").get());
    expect(row).not.toContain("Here you go");
  });

  it("never sends the same revision twice, including two clicks at once", async () => {
    const t = setup({}, { delayMs: 40 });
    const results = await Promise.allSettled([sendReply(t.deps, t.seed.taskId, t.body()), sendReply(t.deps, t.seed.taskId, t.body())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ httpStatus: 409 });
    expect(t.fake.sent).toHaveLength(1);
    await expect(sendReply(t.deps, t.seed.taskId, t.body())).rejects.toMatchObject({ code: "ALREADY_SENT" });
    expect(t.fake.sent).toHaveLength(1);
  });

  it("ignores any recipient the request tries to supply", async () => {
    const t = setup();
    await sendReply(t.deps, t.seed.taskId, ReplySendBodySchema.parse({ revision: 1, body: "Hi", artifactIds: t.seed.artifactIds, to: "attacker@evil.example", cc: "x@y.example" }));
    expect(t.fake.sent[0]!.raw).toContain("To: jordan@client.example\r\n");
    expect(t.fake.sent[0]!.raw).not.toMatch(/attacker@evil|x@y\.example/);
  });

  it("refuses without review, without permission, for demo tasks, and for a stale revision, and sends nothing", async () => {
    for (const [seedOpts, code] of [
      [{ status: "ready" }, "REPLY_NOT_AVAILABLE"],
      [{ mode: "demo" as const }, "REPLY_NOT_AVAILABLE"],
      [{ scope: "https://www.googleapis.com/auth/gmail.readonly" }, "SEND_PERMISSION_MISSING"],
    ] as const) {
      const t = setup(seedOpts);
      await expect(sendReply(t.deps, t.seed.taskId, t.body())).rejects.toMatchObject({ code, httpStatus: 409 });
      expect(t.fake.sent).toHaveLength(0);
      expect((t.db.prepare("SELECT COUNT(*) n FROM reply_sends").get() as { n: number }).n).toBe(0);
    }
    const t = setup();
    await expect(sendReply(t.deps, t.seed.taskId, t.body({ revision: 2 }))).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(t.fake.sent).toHaveLength(0);
  });

  it("rejects files that are not this revision's and files that changed on disk", async () => {
    const t = setup();
    await expect(sendReply(t.deps, t.seed.taskId, t.body({ artifactIds: ["art_other"] }))).rejects.toMatchObject({ httpStatus: 400 });
    const rel = (t.db.prepare("SELECT rel_path FROM artifacts WHERE id=?").get(t.seed.artifactIds[0]) as { rel_path: string }).rel_path;
    writeFileSync(path.join(t.config.artifactsDir, rel), Buffer.from("tampered but same length?"));
    await expect(sendReply(t.deps, t.seed.taskId, t.body())).rejects.toMatchObject({ code: "ARTIFACT_MISMATCH" });
    expect(t.fake.sent).toHaveLength(0);
    expect((t.db.prepare("SELECT COUNT(*) n FROM reply_sends").get() as { n: number }).n).toBe(0);
  });

  it("records a refusal from Google as failed and allows a clean retry", async () => {
    const t = setup({}, { fail: Object.assign(new Error("Request had insufficient authentication scopes"), { code: 403 }) });
    await expect(sendReply(t.deps, t.seed.taskId, t.body())).rejects.toMatchObject({ code: "SEND_FAILED" });
    let v = getReplyView(t.db, t.config, t.seed.taskId, new Date());
    expect(v.last).toMatchObject({ status: "failed" });
    expect(v.available).toBe(true);
    const ok = fakeApi();
    t.deps.makeApi = () => ok.api;
    v = await sendReply(t.deps, t.seed.taskId, t.body());
    expect(v.last?.status).toBe("sent");
    expect(ok.sent).toHaveLength(1);
    expect((t.db.prepare("SELECT COUNT(*) n FROM reply_sends").get() as { n: number }).n).toBe(2);
  });

  it("does not hide the error text from a failed send in a way that leaks secrets", async () => {
    const t = setup({}, { fail: Object.assign(new Error("ya29.SECRET-TOKEN rejected for refresh r"), { code: 500 }) });
    const err = await sendReply(t.deps, t.seed.taskId, t.body()).catch((e) => e);
    expect(String(err.message)).not.toMatch(/ya29|SECRET|refresh/);
    expect(JSON.stringify(t.db.prepare("SELECT error FROM reply_sends").get())).not.toMatch(/ya29|SECRET/);
  });

  it("treats no answer from Google as unknown: it blocks a duplicate until the user confirms", async () => {
    const t = setup({}, { fail: new Error("socket hang up") });
    await expect(sendReply(t.deps, t.seed.taskId, t.body())).rejects.toMatchObject({ code: "SEND_OUTCOME_UNKNOWN", httpStatus: 504 });
    expect(getReplyView(t.db, t.config, t.seed.taskId, t.deps.now())).toMatchObject({ available: false, reason: "A send is already in progress." });
    await expect(sendReply(t.deps, t.seed.taskId, t.body())).rejects.toMatchObject({ httpStatus: 409 });

    t.advance(SEND_STALE_MS + 1000);
    const stale = getReplyView(t.db, t.config, t.seed.taskId, t.deps.now());
    expect(stale.available).toBe(true);
    expect(stale.last).toMatchObject({ status: "sending", uncertain: true });
    await expect(sendReply(t.deps, t.seed.taskId, t.body())).rejects.toMatchObject({ code: "SEND_OUTCOME_UNKNOWN" });

    const ok = fakeApi();
    t.deps.makeApi = () => ok.api;
    const v = await sendReply(t.deps, t.seed.taskId, t.body({ confirmResend: true }));
    expect(v.last?.status).toBe("sent");
    expect(ok.sent).toHaveLength(1);
    const statuses = (t.db.prepare("SELECT status FROM reply_sends ORDER BY created_at, rowid").all() as { status: string }[]).map((r) => r.status);
    expect(statuses).toEqual(["failed", "sent"]);
  });

  it("sends nothing when Gmail was disconnected, or the connection cannot send", async () => {
    const t = setup({}, { noSend: true });
    await expect(sendReply(t.deps, t.seed.taskId, t.body())).rejects.toMatchObject({ code: "SEND_FAILED", httpStatus: 409 });
    expect(t.db.prepare("SELECT status FROM reply_sends").get()).toEqual({ status: "failed" });
  });
});
