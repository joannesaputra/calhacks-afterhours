import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS, OWNER_ID, ProviderError, activeGrants, checkAccess, coverageOf, createEmailGrant, createFilesGrant, createLocalFolderProvider, disconnectAccount,
  emailCutoff, emailsInvolving, getEmail, purgeGrantData, redactDetail, revokeGrant, runSyncStep, runSyncUntilIdle, scopeDecision, searchEmails, upsertAccount, upsertEmail,
  verifyAlias, identityAddresses, getAccount, MAX_SYNC_ATTEMPTS, backoffSeconds, ensureSearchIndex,
} from "../src";
import { MemoryFileProvider } from "../src/testing";
import { BOSS, MAILBOX, NOW, deck, makeTask, makeWorld, msg, resolveTask, syncAll } from "./context-helpers";

const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const limits = { ...DEFAULT_LIMITS };

describe("9. duplicate sync events, retries and backfill never create or replay tasks", () => {
  it("stores history as context only: no task, job or notification is created, and re-syncing adds nothing", async () => {
    const d = await deck();
    const w = makeWorld({
      messages: [
        // an old message that looks exactly like a work request from an allowed sender
        msg({ id: "old1", threadId: "T9", subject: "Please revise the deck", body: "Can you revise the presentation from last week? Change the fee to $45,000 on slide 2.", date: day(40), attachments: [{ filename: "Old.pptx", bytes: d }] }),
        ...Array.from({ length: 12 }, (_, i) => msg({ id: `h${i}`, threadId: `TH${i}`, subject: `History ${i}`, body: "context", date: day(i + 1) })),
      ],
    });
    const before = { tasks: w.db.prepare("SELECT COUNT(*) n FROM tasks").get(), jobs: w.db.prepare("SELECT COUNT(*) n FROM jobs").get(), notes: w.db.prepare("SELECT COUNT(*) n FROM notifications").get(), intake: w.db.prepare("SELECT COUNT(*) n FROM intake_messages").get() };
    await syncAll(w);
    const count = () => (w.db.prepare("SELECT COUNT(*) n FROM emails").get() as { n: number }).n;
    expect(count()).toBe(13);
    await syncAll(w);
    await syncAll(w);
    expect(count()).toBe(13);
    expect(w.db.prepare("SELECT COUNT(*) n FROM source_files").get()).toMatchObject({ n: 1 });
    expect({ tasks: w.db.prepare("SELECT COUNT(*) n FROM tasks").get(), jobs: w.db.prepare("SELECT COUNT(*) n FROM jobs").get(), notes: w.db.prepare("SELECT COUNT(*) n FROM notifications").get(), intake: w.db.prepare("SELECT COUNT(*) n FROM intake_messages").get() }).toEqual(before);
    expect(w.db.prepare("SELECT COUNT(*) n FROM emails WHERE provenance='gmail_backfill'").get()).toMatchObject({ n: 13 });
  });

  it("resumes after a provider error with backoff and without duplicating what was stored", async () => {
    const w = makeWorld({ messages: Array.from({ length: 60 }, (_, i) => msg({ id: `m${i}`, threadId: `T${i}`, subject: `S${i}`, body: "x", date: day(i % 80 === 0 ? 1 : (i % 80) + 1) })) });
    const base = { db: w.db, ownerId: OWNER_ID, accountId: w.accountId, provider: w.mail, now: () => w.now, limits };
    const first = await runSyncStep(base);
    expect(first).toMatchObject({ scope: "backfill", stored: 25, done: false });
    w.mail.failures.push(new ProviderError("rate_limit", "The mailbox rate limit was reached."));
    const failed = await runSyncStep(base);
    expect(failed.error).toMatch(/rate limit/i);
    expect(failed.retryAt).toBeTruthy();
    // backoff holds the backfill cursor; only the incremental cursor may run meanwhile
    expect(await runSyncStep(base)).toMatchObject({ scope: "incremental", stored: 0 });
    expect((w.db.prepare("SELECT COUNT(*) n FROM emails").get() as { n: number }).n).toBe(25);
    const later = { ...base, now: () => new Date(Date.parse(failed.retryAt!) + 1000) };
    const rest = await runSyncUntilIdle(later, 20);
    expect(rest.length).toBeGreaterThan(0);
    expect((w.db.prepare("SELECT COUNT(*) n FROM emails").get() as { n: number }).n).toBe(60);
    expect((w.db.prepare("SELECT COUNT(DISTINCT provider_message_id) n FROM emails").get() as { n: number }).n).toBe(60);
    expect(coverageOf(w.db, OWNER_ID, w.accountId, later.now()).complete).toBe(true);
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(20)).toBe(3600);
  });

  it("stops after repeated failures and reports incomplete coverage; an auth failure pauses until reconnect", async () => {
    const w = makeWorld({ messages: [msg({ id: "m1", subject: "x", body: "x", date: day(1) })] });
    let t = NOW.getTime();
    const run = () => runSyncStep({ db: w.db, ownerId: OWNER_ID, accountId: w.accountId, provider: w.mail, now: () => new Date(t), limits });
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i += 1) { w.mail.failures.push(new ProviderError("temporary", "down")); await run(); t += 3_700_000; }
    expect(w.db.prepare("SELECT status FROM sync_cursors WHERE scope='backfill'").get()).toMatchObject({ status: "failed" });
    expect(coverageOf(w.db, OWNER_ID, w.accountId, new Date(t))).toMatchObject({ complete: false, note: expect.stringContaining("stopped after repeated errors") });
    const w2 = makeWorld({ messages: [msg({ id: "m1", subject: "x", body: "x", date: day(1) })] });
    w2.mail.failures.push(new ProviderError("auth", "revoked"));
    const r = await runSyncStep({ db: w2.db, ownerId: OWNER_ID, accountId: w2.accountId, provider: w2.mail, now: () => NOW, limits });
    expect(r.paused).toBe("auth");
    expect(getAccount(w2.db, OWNER_ID, w2.accountId)).toMatchObject({ state: "error", sync_status: "paused" });
  });

  it("only widens to the newly authorized older range when the lookback is increased", async () => {
    const w = makeWorld({ lookbackDays: 30, messages: [msg({ id: "new", subject: "n", body: "x", date: day(5) }), msg({ id: "old", subject: "o", body: "x", date: day(60) })] });
    await syncAll(w);
    expect((w.db.prepare("SELECT COUNT(*) n FROM emails").get() as { n: number }).n).toBe(1);
    createEmailGrant(w.db, OWNER_ID, w.accountId, { lookbackDays: 90 }, NOW);
    await syncAll(w);
    expect((w.db.prepare("SELECT COUNT(*) n FROM emails").get() as { n: number }).n).toBe(2);
  });
});

describe("8. revoked access, forbidden files, other owners and shortcut escapes", () => {
  it("revoking the email grant stops history use at once, and a task cannot complete on revoked access", async () => {
    const d = await deck();
    const w = makeWorld({ messages: [
      msg({ id: "m1", threadId: "T1", subject: "Kickoff deck", body: "Deck", date: day(6), attachments: [{ filename: "Kickoff Deck.pptx", bytes: d }] }),
      msg({ id: "m2", threadId: "T1", subject: "Re: Kickoff deck", body: "Change the fee from $50,000 to $45,000 on slide 2.", date: day(4) }),
    ] });
    await syncAll(w);
    const t = makeTask(w, { subject: "Revision", body: "Can you revise the presentation from last week based on what we discussed?", threadId: "T1" });
    const ok = await resolveTask(w, t);
    expect(ok.kind).toBe("resolved");
    expect(await checkAccess(w.db, w.deps, OWNER_ID, t.taskId, 1, w.now)).toMatchObject({ ok: true });
    const grant = activeGrants(w.db, OWNER_ID, w.accountId, "email", w.now)[0]!;
    expect(revokeGrant(w.db, OWNER_ID, grant.id, "user", w.now)).toBe(true);
    expect(emailCutoff(w.db, OWNER_ID, w.accountId, w.now)).toBeNull();
    expect(await checkAccess(w.db, w.deps, OWNER_ID, t.taskId, 1, w.now)).toMatchObject({ ok: false, reason: "access_revoked" });
    // a fresh run finds nothing in the revoked history and says history is not authorized
    const t2 = makeTask(w, { subject: "Revision again", body: "Can you revise the presentation from last week based on what we discussed?", threadId: "T1", messageId: "req-2" });
    const out = await resolveTask(w, t2);
    expect(out.kind).toBe("needs_input");
    if (out.kind === "needs_input") expect(out.failure).toBe("not_authorized");
    expect(searchEmails(w.db, { ownerId: OWNER_ID, accountId: w.accountId, cutoff: null }, ["kickoff"], 10).hits).toEqual([]);
    // revoking is not erasing
    expect((w.db.prepare("SELECT COUNT(*) n FROM emails").get() as { n: number }).n).toBe(2);
  });

  it("an expired grant stops access exactly like a revoked one", async () => {
    const w = makeWorld({ messages: [msg({ id: "m1", subject: "x", body: "x", date: day(2) })] });
    const g = activeGrants(w.db, OWNER_ID, w.accountId, "email", NOW)[0]!;
    w.db.prepare("UPDATE context_grants SET expires_at=? WHERE id=?").run(day(1), g.id);
    expect(emailCutoff(w.db, OWNER_ID, w.accountId, NOW)).toBeNull();
    expect((await runSyncStep({ db: w.db, ownerId: OWNER_ID, accountId: w.accountId, provider: w.mail, now: () => NOW, limits })).paused).toBe("no_active_grant");
  });

  it("another owner never sees, matches or reuses these records", async () => {
    const w = makeWorld({ messages: [msg({ id: "m1", threadId: "T1", subject: "Secret kickoff plan", body: "confidential kickoff numbers", date: day(2), attachments: [{ filename: "Secret.pptx", bytes: await deck() }] })] });
    await syncAll(w);
    const email = w.db.prepare("SELECT id FROM emails").get() as { id: string };
    expect(getEmail(w.db, OWNER_ID, email.id)).toBeTruthy();
    expect(getEmail(w.db, "someone-else", email.id)).toBeNull();
    expect(getAccount(w.db, "someone-else", w.accountId)).toBeNull();
    expect(emailCutoff(w.db, "someone-else", w.accountId, NOW)).toBeNull();
    expect(searchEmails(w.db, { ownerId: "someone-else", accountId: w.accountId, cutoff: day(90) }, ["kickoff"], 10).hits).toEqual([]);
    expect(emailsInvolving(w.db, { ownerId: "someone-else", accountId: w.accountId, cutoff: day(90) }, [BOSS], {}, 10)).toEqual([]);
    expect(() => createEmailGrant(w.db, "someone-else", w.accountId, { lookbackDays: 30 }, NOW)).toThrow(/does not exist/);
    expect(revokeGrant(w.db, "someone-else", activeGrants(w.db, OWNER_ID, w.accountId, "email", NOW)[0]!.id, "x", NOW)).toBe(false);
    expect(() => purgeGrantData(w.db, w.config.artifactsDir, "someone-else", activeGrants(w.db, OWNER_ID, w.accountId, "email", NOW)[0]!.id, NOW)).toThrow(/does not exist/);
    // a task run for another owner cannot use this owner's history
    const t = makeTask(w, { subject: "Secret deck", body: "Can you revise the Secret presentation from last week? Change the fee from $50,000 to $45,000 on slide 2." });
    const out = await resolveTask(w, t, { deps: {} });
    expect(out.kind).toBe("resolved"); // the real owner can
  });

  it("denies a file outside the selected folder, a forbidden file, a parent/sibling folder and a shortcut that leaves the grant", async () => {
    const d = await deck();
    const p = new MemoryFileProvider("drive", [
      { id: "root", name: "root", parent: null, folder: true },
      { id: "proj", name: "proj", parent: "root", folder: true },
      { id: "sub", name: "sub", parent: "proj", folder: true },
      { id: "in1", name: "In.pptx", parent: "sub", content: d },
      { id: "sib", name: "sibling", parent: "root", folder: true },
      { id: "out1", name: "Out.pptx", parent: "sib", content: d },
      { id: "short-out", name: "Link to Out", parent: "proj", shortcutTo: "out1" },
      { id: "short-in", name: "Link to In", parent: "proj", shortcutTo: "in1" },
      { id: "locked", name: "Locked.pptx", parent: "proj", content: d, forbidden: true },
    ]);
    const sel = [{ providerId: "proj", kind: "folder" as const, label: "proj" }];
    expect(await scopeDecision(p, "in1", sel)).toMatchObject({ ok: true, via: "folder", rootId: "proj" });
    expect(await scopeDecision(p, "short-in", sel)).toMatchObject({ ok: true });
    expect(await scopeDecision(p, "out1", sel)).toMatchObject({ ok: false, reason: "outside_grant" });
    expect(await scopeDecision(p, "sib", sel)).toMatchObject({ ok: false });
    expect(await scopeDecision(p, "root", sel)).toMatchObject({ ok: false }); // parent folder
    expect(await scopeDecision(p, "short-out", sel)).toMatchObject({ ok: false, reason: "shortcut_outside_grant" });
    expect(await scopeDecision(p, "locked", sel)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await scopeDecision(p, "missing", sel)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await scopeDecision(p, "in1", [{ providerId: "in1", kind: "file", label: "x" }])).toMatchObject({ ok: true, via: "file" });
    expect(await scopeDecision(p, "out1", [{ providerId: "in1", kind: "file", label: "x" }])).toMatchObject({ ok: false });
  });

  it("the local folder provider treats symbolic links as shortcuts and refuses escapes from the root and the grant", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ah-folder-"));
    const secret = mkdtempSync(path.join(tmpdir(), "ah-secret-"));
    mkdirSync(path.join(root, "proj")); mkdirSync(path.join(root, "sibling"));
    writeFileSync(path.join(root, "proj", "a.pptx"), await deck());
    writeFileSync(path.join(root, "sibling", "b.pptx"), await deck());
    writeFileSync(path.join(secret, "s.pptx"), await deck());
    symlinkSync(path.join(root, "sibling", "b.pptx"), path.join(root, "proj", "to-sibling.pptx"));
    symlinkSync(path.join(secret, "s.pptx"), path.join(root, "proj", "to-outside.pptx"));
    symlinkSync(path.join(root, "proj", "a.pptx"), path.join(root, "proj", "to-self.pptx"));
    const p = createLocalFolderProvider(root);
    const sel = [{ providerId: "proj", kind: "folder" as const, label: "proj" }];
    expect(await scopeDecision(p, "proj/a.pptx", sel)).toMatchObject({ ok: true });
    expect(await scopeDecision(p, "proj/to-self.pptx", sel)).toMatchObject({ ok: true });
    expect(await scopeDecision(p, "proj/to-sibling.pptx", sel)).toMatchObject({ ok: false, reason: "shortcut_outside_grant" });
    expect(await scopeDecision(p, "proj/to-outside.pptx", sel)).toMatchObject({ ok: false });
    expect(await scopeDecision(p, "sibling/b.pptx", sel)).toMatchObject({ ok: false, reason: "outside_grant" });
    expect(await scopeDecision(p, "../x", sel)).toMatchObject({ ok: false });
    expect(await scopeDecision(p, "/etc/passwd", sel)).toMatchObject({ ok: false });
    expect((await p.open("proj/to-outside.pptx")).ok).toBe(false);
    const listed = await p.list("proj", { pageToken: null, limit: 50 });
    expect("missing" in listed ? [] : listed.entries.map((e) => e.name).sort()).toEqual(["a.pptx", "to-outside.pptx", "to-self.pptx", "to-sibling.pptx"]);
    const opened = await p.open("proj/a.pptx");
    expect(opened.ok && opened.entry.versionKey).toMatch(/^\d+:\d+:\d+$/);
  });

  it("a folder grant needs a selection, a file grant cannot be made on a mailbox, and an unavailable source cannot be granted", () => {
    const w = makeWorld();
    const folder = upsertAccount(w.db, OWNER_ID, "folder", "files", { state: "connected" }, NOW);
    const drive = upsertAccount(w.db, OWNER_ID, "drive", "drive", { state: "unavailable" }, NOW);
    expect(() => createFilesGrant(w.db, OWNER_ID, folder.id, [], {}, NOW)).toThrow(/Whole-drive access is not offered/);
    expect(() => createFilesGrant(w.db, OWNER_ID, w.accountId, [{ providerId: "x", kind: "file", label: "x" }], {}, NOW)).toThrow(/not a mailbox/);
    expect(() => createFilesGrant(w.db, OWNER_ID, drive.id, [{ providerId: "x", kind: "file", label: "x" }], {}, NOW)).toThrow(/not available/);
    expect(() => createEmailGrant(w.db, OWNER_ID, folder.id, { lookbackDays: 30 }, NOW)).toThrow(/mailbox/);
    expect(() => createEmailGrant(w.db, OWNER_ID, w.accountId, { lookbackDays: 0 }, NOW)).toThrow(/between 1 and 730/);
  });

  it("email-only mode: a mailbox grant alone gives no file access, and a files grant alone gives no history", () => {
    const w = makeWorld();
    const folder = upsertAccount(w.db, OWNER_ID, "folder", "files", { state: "connected" }, NOW);
    expect(activeGrants(w.db, OWNER_ID, folder.id, "files", NOW)).toEqual([]);
    expect(activeGrants(w.db, OWNER_ID, w.accountId, "files", NOW)).toEqual([]);
    createFilesGrant(w.db, OWNER_ID, folder.id, [{ providerId: "proj", kind: "folder", label: "proj" }], {}, NOW);
    expect(activeGrants(w.db, OWNER_ID, folder.id, "email", NOW)).toEqual([]);
    expect(emailCutoff(w.db, OWNER_ID, folder.id, NOW)).toBeNull();
  });
});

describe("retention: stopping access is not deleting data", () => {
  it("purges messages, files, extracted text, search entries, associations, blobs and stored evidence for a revoked grant only", async () => {
    const d = await deck();
    const w = makeWorld({ messages: [
      msg({ id: "m1", threadId: "T1", subject: "Kickoff deck", body: "Deck", date: day(6), attachments: [{ filename: "Kickoff Deck.pptx", bytes: d }] }),
      msg({ id: "m2", threadId: "T1", subject: "Re: Kickoff deck", body: "Change the fee from $50,000 to $45,000 on slide 2.", date: day(4) }),
    ] });
    await syncAll(w);
    const t = makeTask(w, { subject: "Revision", body: "Can you revise the presentation from last week based on what we discussed?", threadId: "T1" });
    expect((await resolveTask(w, t)).kind).toBe("resolved");
    const grant = activeGrants(w.db, OWNER_ID, w.accountId, "email", NOW)[0]!;
    expect(() => purgeGrantData(w.db, w.config.artifactsDir, OWNER_ID, grant.id, NOW)).toThrow(/Revoke the grant/);
    revokeGrant(w.db, OWNER_ID, grant.id, "user", NOW);
    const blobs = (w.db.prepare("SELECT COUNT(*) n FROM file_versions WHERE blob_rel_path IS NOT NULL").get() as { n: number }).n;
    expect(blobs).toBeGreaterThan(0);
    const summary = purgeGrantData(w.db, w.config.artifactsDir, OWNER_ID, grant.id, NOW);
    expect(summary).toMatchObject({ emails: 2, files: 1, runsRedacted: 1 });
    expect(summary.chunks).toBeGreaterThan(0);
    for (const table of ["emails", "email_participants", "email_links", "source_files", "content_chunks", "search_docs"]) {
      const n = (w.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${table === "source_files" ? "provider='gmail'" : "1=1"}`).get() as { n: number }).n;
      expect(n, table).toBe(table === "search_docs" ? 0 : 0);
    }
    expect((w.db.prepare("SELECT COUNT(*) n FROM context_fts").get() as { n: number }).n).toBe(0);
    const run = w.db.prepare("SELECT bundle_json, candidates_json FROM retrieval_runs").get() as { bundle_json: string | null; candidates_json: string };
    expect(run.bundle_json).toBeNull();
    expect(run.candidates_json).toBe("[]");
    expect(w.db.prepare("SELECT purged_at FROM context_grants WHERE id=?").get(grant.id)).toMatchObject({ purged_at: expect.any(String) });
    // the request itself (a task) is untouched
    expect((w.db.prepare("SELECT COUNT(*) n FROM tasks").get() as { n: number }).n).toBe(1);
  });

  it("disconnecting a mailbox revokes every grant and pauses sync, keeping history until it is purged", async () => {
    const w = makeWorld({ messages: [msg({ id: "m1", subject: "x", body: "x", date: day(2) })] });
    await syncAll(w);
    disconnectAccount(w.db, OWNER_ID, w.accountId, "disconnected", NOW);
    expect(activeGrants(w.db, OWNER_ID, w.accountId, "email", NOW)).toEqual([]);
    expect(getAccount(w.db, OWNER_ID, w.accountId)).toMatchObject({ state: "disconnected", sync_status: "paused" });
    expect(w.db.prepare("SELECT status FROM sync_cursors WHERE scope='backfill'").get()).toMatchObject({ status: "complete" });
    expect((w.db.prepare("SELECT COUNT(*) n FROM emails").get() as { n: number }).n).toBe(1);
  });
});

describe("identity, audit and search", () => {
  it("merges two addresses only after they are explicitly verified as one person", () => {
    const w = makeWorld();
    const a = (addr: string, msgId: string) => upsertEmail(w.db, OWNER_ID, w.accountId, null, { providerMessageId: msgId, threadId: null, direction: "inbound", fromAddress: addr, fromName: "Sam Lee", to: [MAILBOX], cc: [], subject: "s", bodyText: "b", receivedAt: day(1), provenance: "fixture", attachments: [] }, NOW);
    a("sam@client.example", "1"); a("sam.lee@gmail.example", "2"); a("sam@client.example", "3");
    expect(identityAddresses(w.db, OWNER_ID, "sam@client.example")).toEqual(["sam@client.example"]); // same name, same company: not merged
    expect(identityAddresses(w.db, OWNER_ID, "other@client.example")).toEqual(["other@client.example"]);
    verifyAlias(w.db, OWNER_ID, "sam@client.example", "sam.lee@gmail.example", NOW);
    expect(identityAddresses(w.db, OWNER_ID, "sam@client.example").sort()).toEqual(["sam.lee@gmail.example", "sam@client.example"]);
  });

  it("audit events carry ids and counts only, never content or secrets", () => {
    expect(redactDetail({ count: 3, ok: true, subject: "Confidential pricing", body: "x", accessToken: "sk-abc", url: "https://x?t=1", note: "a".repeat(200), nested: { a: 1 } }))
      .toEqual({ count: 3, ok: true, subject: "[redacted]", body: "[redacted]", accessToken: "[redacted]", url: "[redacted]", note: `${"a".repeat(77)}...` });
    const w = makeWorld({ messages: [msg({ id: "m1", subject: "Private subject line", body: "private body text", date: day(2) })] });
    return syncAll(w).then(() => {
      const rows = JSON.stringify(w.db.prepare("SELECT * FROM context_audit").all());
      expect(rows).not.toContain("Private subject");
      expect(rows).not.toContain("private body");
      expect(rows).toContain("sync.step");
    });
  });

  it("finds messages by full text, and falls back to a bounded scan that reports when it was cut short", async () => {
    const w = makeWorld({ messages: Array.from({ length: 30 }, (_, i) => msg({ id: `m${i}`, subject: i === 7 ? "Aurora launch plan" : `Other ${i}`, body: i === 7 ? "aurora details" : "nothing relevant", date: day(i + 1) })) });
    await syncAll(w);
    const scope = { ownerId: OWNER_ID, accountId: w.accountId, cutoff: day(90) };
    expect(ensureSearchIndex(w.db)).toBe("fts5");
    const fts = searchEmails(w.db, scope, ["aurora"], 5);
    expect(fts.backend).toBe("fts5");
    expect(fts.hits).toHaveLength(1);
    const scan = searchEmails(w.db, scope, ["aurora"], 5, { backend: "scan" });
    expect(scan).toMatchObject({ backend: "scan", capped: false });
    expect(scan.hits[0]!.id).toBe(fts.hits[0]!.id);
    const capped = searchEmails(w.db, scope, ["aurora"], 5, { backend: "scan", scanCap: 3 });
    expect(capped.capped).toBe(true);
    expect(capped.hits).toEqual([]); // the match is older than the 3 newest rows: reported as capped, not as "no match"
    // no active grant window means nothing is searchable
    expect(searchEmails(w.db, { ...scope, cutoff: null }, ["aurora"], 5).hits).toEqual([]);
    // a hostile query string is just terms
    expect(() => searchEmails(w.db, scope, ['" OR * NEAR(', "a\"b"], 5)).not.toThrow();
  });
});
