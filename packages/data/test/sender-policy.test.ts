import { describe, expect, it } from "vitest";
import { hasWorkDomain, WorkspaceSettingsSchema } from "@afterhours/contracts";
import {
  decideSender, getGmailRow, getSettings, ingestMessage, looksAutomated, patchSettings, pollGmailOnce, saveGmailConnection,
  type GmailApi, type GmailMessage,
} from "../src";
import { makeTestDb } from "../src/testing";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const ACCOUNT = "me@acme.test";
const T = new Date("2026-03-02T20:00:00Z");

describe("decideSender", () => {
  const listed = ["partner@elsewhere.test"];
  const d = (senderPolicy: "approved" | "same_domain" | "everyone", sender: string, account: string | null = ACCOUNT) =>
    decideSender({ senderPolicy, allowedSenders: listed }, sender, account);

  it("approved: only exact listed addresses, case-insensitively", () => {
    expect(d("approved", "Partner@Elsewhere.test")).toBe("listed");
    expect(d("approved", "colleague@acme.test")).toBe("no");
    expect(d("approved", "stranger@x.test")).toBe("no");
  });

  it("same_domain: the connected work domain plus listed addresses, never lookalikes or subdomains", () => {
    expect(d("same_domain", "colleague@acme.test")).toBe("same_domain");
    expect(d("same_domain", "COLLEAGUE@ACME.TEST")).toBe("same_domain");
    expect(d("same_domain", "partner@elsewhere.test")).toBe("listed");
    expect(d("same_domain", "x@evilacme.test")).toBe("no");
    expect(d("same_domain", "x@acme.test.evil.test")).toBe("no");
    expect(d("same_domain", "x@mail.acme.test")).toBe("no");
    expect(d("same_domain", "x@acme.test@evil.test")).toBe("no");
  });

  it("same_domain on a personal mailbox accepts only the mailbox's own address, never the whole provider", () => {
    expect(hasWorkDomain("someone@gmail.com")).toBe(false);
    expect(hasWorkDomain(ACCOUNT)).toBe(true);
    expect(d("same_domain", "other@gmail.com", "me@gmail.com")).toBe("no");
    expect(d("same_domain", "me@gmail.com", "me@gmail.com")).toBe("same_domain");
  });

  it("same_domain with no connected account accepts nobody beyond the list", () => {
    expect(d("same_domain", "colleague@acme.test", null)).toBe("no");
    expect(d("same_domain", "partner@elsewhere.test", null)).toBe("listed");
  });

  it("everyone accepts any well-formed sender but not an empty or malformed one", () => {
    expect(d("everyone", "stranger@x.test")).toBe("everyone");
    expect(d("everyone", "partner@elsewhere.test")).toBe("listed");
    expect(d("everyone", "")).toBe("no");
    expect(d("everyone", "not-an-address")).toBe("no");
  });
});

describe("looksAutomated", () => {
  const h = (map: Record<string, string>) => (n: string) => map[n];
  it("flags no-reply senders, lists, newsletters and auto-replies", () => {
    expect(looksAutomated("noreply@x.test", h({}))).toBe(true);
    expect(looksAutomated("no-reply+abc@x.test", h({}))).toBe(true);
    expect(looksAutomated("a@x.test", h({ "list-unsubscribe": "<mailto:u@x.test>" }))).toBe(true);
    expect(looksAutomated("a@x.test", h({ "list-id": "<l.x.test>" }))).toBe(true);
    expect(looksAutomated("a@x.test", h({ "auto-submitted": "auto-replied" }))).toBe(true);
    expect(looksAutomated("a@x.test", h({ precedence: "bulk" }))).toBe(true);
  });
  it("keeps ordinary people, including a person whose address merely starts like a keyword", () => {
    expect(looksAutomated("jordan@x.test", h({}))).toBe(false);
    expect(looksAutomated("notifications@x.test", h({}))).toBe(true);
    expect(looksAutomated("noreplyfan@x.test", h({}))).toBe(false);
    expect(looksAutomated("a@x.test", h({ "auto-submitted": "no" }))).toBe(false);
  });
});

describe("settings", () => {
  it("defaults to approved, including for settings saved before the field existed", () => {
    const { db } = makeTestDb();
    expect(getSettings(db).senderPolicy).toBe("approved");
    const legacy = JSON.parse(JSON.stringify(getSettings(db)));
    delete legacy.senderPolicy;
    expect(WorkspaceSettingsSchema.parse(legacy).senderPolicy).toBe("approved");
    db.prepare("UPDATE workspace_settings SET settings_json = ? WHERE id = 1").run(JSON.stringify(legacy));
    expect(getSettings(db).senderPolicy).toBe("approved");
  });

  it("saves a policy without touching the list, and rejects unknown values", () => {
    const { db } = makeTestDb();
    patchSettings(db, { allowedSenders: ["a@b.test"] }, T);
    expect(patchSettings(db, { senderPolicy: "everyone" }, T)).toMatchObject({ senderPolicy: "everyone", allowedSenders: ["a@b.test"] });
    expect(patchSettings(db, { automationEnabled: false }, T).senderPolicy).toBe("everyone");
  });
});

function envelope(from: string) {
  return {
    providerMessageId: `m-${from}`, providerThreadId: "t", from: { name: null, email: from }, to: [ACCOUNT],
    subject: "Please prepare a report", receivedAt: T.toISOString(), bodyText: "Please prepare a report.", attachments: [],
  };
}
const ingest = (db: ReturnType<typeof makeTestDb>["db"], from: string) =>
  ingestMessage(db, { sourceKey: `gmail:int:${from}`, mode: "gmail", integrationId: getGmailRow(db)?.id ?? null, envelope: envelope(from), attachments: [], generationMode: "fixture", fixtureScenario: null }, T);

describe("intake honours the policy", () => {
  it("approved ignores a stranger; same_domain accepts a colleague only; everyone accepts a stranger", () => {
    const { db, config } = makeTestDb();
    saveGmailConnection(db, config.tokenEncryptionKey, { account: ACCOUNT, tokens: { refresh_token: "r" } }, T);
    expect(ingest(db, "colleague@acme.test")).toMatchObject({ kind: "ignored", reason: "sender_not_allowed" });

    patchSettings(db, { senderPolicy: "same_domain" }, T);
    expect(ingest(db, "stranger@x.test")).toMatchObject({ kind: "ignored", reason: "sender_not_allowed" });
    expect(ingest(db, "colleague@acme.test").kind).toBe("task");

    patchSettings(db, { senderPolicy: "everyone" }, T);
    expect(ingest(db, "stranger@x.test").kind).toBe("task");
  });

  it("automation off and auto-prepare off still win over a broad policy", () => {
    const { db } = makeTestDb();
    patchSettings(db, { senderPolicy: "everyone", automationEnabled: false }, T);
    expect(ingest(db, "stranger@x.test")).toMatchObject({ kind: "ignored", reason: "automation_disabled" });
    patchSettings(db, { automationEnabled: true, autoPrepare: false }, T);
    expect(ingest(db, "stranger@x.test")).toMatchObject({ kind: "ignored", reason: "auto_prepare_disabled" });
  });
});

function gmailMsg(id: string, ms: number, from: string, extra: { name: string; value: string }[] = [], attach = false): GmailMessage {
  return {
    id, threadId: `t-${id}`, internalDate: String(ms), labelIds: ["INBOX"],
    payload: {
      mimeType: "multipart/mixed",
      headers: [{ name: "From", value: from }, { name: "To", value: ACCOUNT }, { name: "Subject", value: `Req ${id}` }, ...extra],
      parts: [
        { partId: "0", mimeType: "text/plain", body: { data: b64("Please prepare a report.") } },
        ...(attach ? [{ partId: "1", mimeType: "text/csv", filename: "s.csv", body: { attachmentId: "A", size: 24 } }] : []),
      ],
    },
  };
}

describe("gmail poll with a broader policy", () => {
  async function run(policy: "approved" | "same_domain" | "everyone", messages: GmailMessage[]) {
    const { db, config } = makeTestDb();
    saveGmailConnection(db, config.tokenEncryptionKey, { account: ACCOUNT, tokens: { refresh_token: "r" } }, T);
    patchSettings(db, { senderPolicy: policy, allowedSenders: ["boss@client.test"] }, T);
    let attachments = 0;
    const api: GmailApi = {
      getProfileEmail: async () => ACCOUNT,
      listInbox: async () => ({ ids: messages.map((m) => m.id), nextPageToken: null }),
      getMessage: async (id) => messages.find((m) => m.id === id)!,
      getAttachment: async () => { attachments++; return Buffer.from("month,revenue\n2025-01,1\n"); },
    };
    const r = await pollGmailOnce({ db, config, now: () => new Date(T.getTime() + 60_000), makeApi: () => api });
    const senders = (db.prepare("SELECT sender_email FROM tasks ORDER BY sender_email").all() as { sender_email: string }[]).map((x) => x.sender_email);
    const audit = (db.prepare("SELECT reason FROM intake_audit ORDER BY id").all() as { reason: string }[]).map((x) => x.reason);
    return { r, senders, audit, attachments };
  }
  const t = T.getTime();

  it("everyone: strangers become tasks, with their attachments, but automated and spoofed mail does not", async () => {
    const { r, senders, audit, attachments } = await run("everyone", [
      gmailMsg("a", t + 1000, "Stranger <stranger@x.test>", [], true),
      gmailMsg("b", t + 2000, "Newsletter <news@x.test>", [{ name: "List-Unsubscribe", value: "<mailto:u@x.test>" }], true),
      gmailMsg("c", t + 3000, "noreply@x.test", [], true),
      gmailMsg("d", t + 4000, "Spoof <spoof@x.test>", [{ name: "Authentication-Results", value: "mx.google.com; dmarc=fail" }], true),
      gmailMsg("e", t + 5000, "boss@client.test", [{ name: "List-Unsubscribe", value: "<mailto:u@x.test>" }]),
    ]);
    expect(r).toMatchObject({ status: "ok", ingested: 2, ignored: 3 });
    expect(senders).toEqual(["boss@client.test", "stranger@x.test"]); // a listed address is never filtered as automated
    expect(audit.sort()).toEqual(["automated_sender", "automated_sender", "sender_authentication_failed"]);
    expect(attachments).toBe(1); // only the stranger's real request; none for automated or spoofed mail
  });

  it("same_domain: a colleague is accepted, an outsider is not and gets no attachment download", async () => {
    const { r, senders, attachments } = await run("same_domain", [
      gmailMsg("a", t + 1000, "colleague@acme.test", [], true),
      gmailMsg("b", t + 2000, "outsider@x.test", [], true),
    ]);
    expect(r).toMatchObject({ ingested: 1, ignored: 1 });
    expect(senders).toEqual(["colleague@acme.test"]);
    expect(attachments).toBe(1);
  });

  it("approved is unchanged: a colleague is not enough", async () => {
    const { r, senders, attachments } = await run("approved", [
      gmailMsg("a", t + 1000, "colleague@acme.test", [], true),
      gmailMsg("b", t + 2000, "boss@client.test", [], true),
    ]);
    expect(r).toMatchObject({ ingested: 1, ignored: 1 });
    expect(senders).toEqual(["boss@client.test"]);
    expect(attachments).toBe(1);
  });
});
