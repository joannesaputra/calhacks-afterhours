import { describe, expect, it } from "vitest";
import {
  claimDueNotification, completeNotification, createReadyNotification, failNotification, getSettings, markSubmitStarted,
  openDb, patchSettings, recipientFingerprint, recoverNotificationLeases, stalePolicyProblem, type Db,
} from "../src";
import { makeTestDb, runToReady } from "../src/testing";

const LA = "America/Los_Angeles";
const quiet = { enabled: true, start: "22:00", end: "08:00", timezone: LA };
const T = (iso: string) => new Date(iso);
const tx = (db: Db, fn: () => void) => db.transaction(fn).immediate();

type Row = { id: string; dedupe_key: string; kind: string; state: string; scheduled_for: string; local_date: string | null; sealed_at: string | null };
const rows = (db: Db) => db.prepare("SELECT id, dedupe_key, kind, state, scheduled_for, local_date, sealed_at FROM notifications ORDER BY created_at, dedupe_key").all() as Row[];
const members = (db: Db, id: string) =>
  (db.prepare("SELECT task_id, revision FROM notification_members WHERE notification_id=? ORDER BY ordinal").all(id) as Array<{ task_id: string; revision: number }>);
const memberCount = (db: Db) => (db.prepare("SELECT COUNT(*) n FROM notification_members").get() as { n: number }).n;

function quietSetup() {
  const ctx = makeTestDb();
  patchSettings(ctx.db, { notifications: { quietHours: quiet, digestTime: "08:00" } }, new Date());
  return ctx;
}

describe("immediate and digest routes share one membership (no revision delivered twice)", () => {
  it("re-running the intent for an already-queued task revision is a no-op on either route", () => {
    const { db, config } = makeTestDb();
    const noon = T("2026-10-24T19:00:00Z");
    const a = runToReady(db, config, "imm", noon);
    expect(rows(db)).toHaveLength(1);
    tx(db, () => createReadyNotification(db, a.taskId, 1, noon));
    tx(db, () => createReadyNotification(db, a.taskId, 1, T("2026-10-24T06:30:00Z"))); // replayed during quiet hours
    expect(rows(db)).toHaveLength(1);
    expect(memberCount(db)).toBe(1);

    patchSettings(db, { notifications: { quietHours: quiet } }, noon);
    const b = runToReady(db, config, "dig", T("2026-10-24T06:30:00Z"));
    tx(db, () => createReadyNotification(db, b.taskId, 1, T("2026-10-24T06:30:00Z")));
    tx(db, () => createReadyNotification(db, b.taskId, 1, noon)); // replayed outside quiet hours
    expect(rows(db).filter((r) => r.kind === "digest")).toHaveLength(1);
    expect(memberCount(db)).toBe(2);
  });

  it("the database refuses to list one task revision in two notifications for the same channel", () => {
    const { db, config } = makeTestDb();
    const a = runToReady(db, config, "x", T("2026-10-24T19:00:00Z"));
    const other = db.prepare("SELECT id FROM notifications").get() as { id: string };
    db.prepare(
      `INSERT INTO notifications (id, dedupe_key, channel, state, message, task_ids_json, task_revisions_json, scheduled_for, created_at, updated_at, kind)
       VALUES ('n2','digest/x/outbox','outbox','queued','m','[]','[]','2026-10-24T20:00:00Z','2026-10-24T20:00:00Z','2026-10-24T20:00:00Z','digest')`).run();
    expect(() => db.prepare("INSERT INTO notification_members (notification_id, task_id, revision, channel, ordinal) VALUES ('n2',?,1,'outbox',0)").run(a.taskId))
      .toThrow(/UNIQUE/);
    expect(members(db, other.id)).toHaveLength(1);
  });

  it("a new revision of a task is a different member and can be notified (revisions are not collapsed)", () => {
    const { db, config } = makeTestDb();
    const a = runToReady(db, config, "rev", T("2026-10-24T19:00:00Z"));
    db.prepare("UPDATE tasks SET revision=2 WHERE id=?").run(a.taskId);
    tx(db, () => createReadyNotification(db, a.taskId, 2, T("2026-10-24T19:05:00Z")));
    expect(memberCount(db)).toBe(2);
  });
});

describe("digest membership snapshot at claim", () => {
  it("a task that becomes ready before the claim is in the snapshot; the digest is one row, in order", () => {
    const { db, config } = quietSetup();
    const a = runToReady(db, config, "a", T("2026-10-24T06:30:00Z"));
    const b = runToReady(db, config, "b", T("2026-10-24T07:00:00Z"));
    const [digest] = rows(db);
    expect(rows(db)).toHaveLength(1);
    expect(digest!.dedupe_key).toBe("digest/2026-10-24/outbox");
    const c = claimDueNotification(db, "w", T("2026-10-24T15:00:00Z"))!;
    expect(c.kind).toBe("digest");
    expect(c.tasks.map((t) => t.id)).toEqual([a.taskId, b.taskId]);
    expect(c.tasks.every((t) => t.artifactCount === 2)).toBe(true);
  });

  it("a task that becomes ready AFTER the claim is not appended; it gets a deterministic follow-up digest", () => {
    const { db, config } = quietSetup();
    const a = runToReady(db, config, "a", T("2026-10-24T06:30:00Z"));
    const claimed = claimDueNotification(db, "w", T("2026-10-24T15:00:00Z"))!;
    expect(claimed.tasks.map((t) => t.id)).toEqual([a.taskId]);
    // 08:05 local the operator widens quiet hours to 09:00, so a result arriving now is deferred again.
    patchSettings(db, { notifications: { quietHours: { ...quiet, end: "09:00" } } }, T("2026-10-24T15:04:00Z"));
    const late = runToReady(db, config, "late", T("2026-10-24T15:05:00Z"));
    const all = rows(db);
    expect(all).toHaveLength(2);
    const follow = all.find((r) => r.id !== claimed.id)!;
    expect(follow.dedupe_key).toBe("digest/2026-10-24/outbox/2");
    expect(follow.scheduled_for).toBe("2026-10-24T16:00:00.000Z"); // 09:00 PDT
    // The sealed message never changes after it was claimed.
    expect(members(db, claimed.id)).toEqual([{ task_id: a.taskId, revision: 1 }]);
    expect(members(db, follow.id)).toEqual([{ task_id: late.taskId, revision: 1 }]);
    // Finish the first; the follow-up is delivered later, exactly once, to exactly its own members.
    completeNotification(db, claimed.id, claimed.ownerToken, { state: "simulated", message: "m", providerMessageId: null, reason: null }, T("2026-10-24T15:06:00Z"));
    expect(claimDueNotification(db, "w", T("2026-10-24T15:30:00Z"))).toBeNull();
    const second = claimDueNotification(db, "w", T("2026-10-24T16:00:00Z"))!;
    expect(second.tasks.map((t) => t.id)).toEqual([late.taskId]);
    completeNotification(db, second.id, second.ownerToken, { state: "simulated", message: "m", providerMessageId: null, reason: null }, T("2026-10-24T16:01:00Z"));
    expect(claimDueNotification(db, "w", T("2026-10-24T20:00:00Z"))).toBeNull();
    expect(memberCount(db)).toBe(2);
  });

  it("a digest that is mid-retry (sealed, backing off) also refuses new members", () => {
    const { db, config } = quietSetup();
    runToReady(db, config, "a", T("2026-10-24T06:30:00Z"));
    const c = claimDueNotification(db, "w", T("2026-10-24T15:00:00Z"))!;
    expect(failNotification(db, c.id, c.ownerToken, { message: "503", retryable: true }, T("2026-10-24T15:00:05Z"))).toBe("retry");
    patchSettings(db, { notifications: { quietHours: { ...quiet, end: "09:00" } } }, T("2026-10-24T15:00:10Z"));
    const b = runToReady(db, config, "b", T("2026-10-24T15:01:00Z"));
    expect(members(db, c.id)).toHaveLength(1);
    expect(rows(db).find((r) => r.id !== c.id)).toBeDefined();
    expect(memberCount(db)).toBe(2);
    void b;
  });
});

describe("pending schedules are rebuilt from the database after a restart", () => {
  it("keeps schedule, membership and local date across a reopened database; no duplicates", () => {
    const { db, config } = quietSetup();
    const a = runToReady(db, config, "a", T("2026-10-24T06:30:00Z"));
    const before = rows(db);
    db.close();
    const db2 = openDb(config.databasePath);
    expect(rows(db2)).toEqual(before);
    const b = runToReady(db2, config, "b", T("2026-10-24T09:00:00Z")); // after the restart, same night
    expect(rows(db2)).toHaveLength(1);
    expect(members(db2, before[0]!.id).map((m) => m.task_id)).toEqual([a.taskId, b.taskId]);
    expect(claimDueNotification(db2, "w", T("2026-10-24T14:59:59Z"))).toBeNull();
    expect(claimDueNotification(db2, "w", T("2026-10-24T15:00:00Z"))!.tasks).toHaveLength(2);
    db2.close();
  });

  it("a worker that starts late during quiet hours does not send then; it waits for the next eligible slot", () => {
    const { db, config } = quietSetup();
    const a = runToReady(db, config, "a", T("2026-10-24T06:30:00Z")); // due 2026-10-24T15:00Z
    // The worker was down all day and starts at 23:00 PDT, inside quiet hours.
    expect(claimDueNotification(db, "w", T("2026-10-25T06:00:00Z"))).toBeNull();
    const d = rows(db)[0]!;
    expect(d.scheduled_for).toBe("2026-10-25T15:00:00.000Z");
    expect(d.local_date).toBe("2026-10-25");
    expect(d.state).toBe("queued");
    const c = claimDueNotification(db, "w", T("2026-10-25T15:00:00Z"))!;
    expect(c.tasks.map((t) => t.id)).toEqual([a.taskId]);
  });

  it("a worker that starts late OUTSIDE quiet hours dispatches the overdue message once, immediately", () => {
    const { db, config } = quietSetup();
    runToReady(db, config, "a", T("2026-10-24T06:30:00Z"));
    const c = claimDueNotification(db, "w", T("2026-10-24T19:00:00Z"))!; // 12:00 PDT, overdue by 4 h
    expect(c.attempts).toBe(1);
    completeNotification(db, c.id, c.ownerToken, { state: "simulated", message: "m", providerMessageId: null, reason: null }, T("2026-10-24T19:00:01Z"));
    expect(claimDueNotification(db, "w2", T("2026-10-24T19:01:00Z"))).toBeNull();
  });

  it("overdue digests for two nights collapse into the next eligible digest without losing or duplicating a task", () => {
    const { db, config } = quietSetup();
    const a = runToReady(db, config, "a", T("2026-10-24T06:30:00Z")); // digest for Oct 24
    const b = runToReady(db, config, "b", T("2026-10-25T06:30:00Z")); // digest for Oct 25 (worker never ran)
    expect(rows(db)).toHaveLength(2);
    // Worker finally starts at 23:35 PDT on Oct 24 (quiet): the Oct 24 digest is overdue and moves into the Oct 25 one.
    expect(claimDueNotification(db, "w", T("2026-10-25T06:35:00Z"))).toBeNull();
    const left = rows(db);
    expect(left).toHaveLength(1);
    expect(left[0]!.dedupe_key).toBe("digest/2026-10-25/outbox");
    expect(members(db, left[0]!.id).map((m) => m.task_id).sort()).toEqual([a.taskId, b.taskId].sort());
    const c = claimDueNotification(db, "w", T("2026-10-25T15:00:00Z"))!;
    expect(c.tasks).toHaveLength(2);
    expect(memberCount(db)).toBe(2);
  });
});

describe("settings edits after queueing never reroute or resurrect a live message", () => {
  it("blocks (POLICY_CHANGED) when the channel or recipient changed; leaves unchanged and outbox rows alone", () => {
    const { db, config } = makeTestDb();
    const t0 = T("2026-10-24T19:00:00Z");
    patchSettings(db, { notifications: { channel: "whatsapp", recipient: "+15550001111" } }, t0);
    runToReady(db, config, "w", t0);
    const claim = claimDueNotification(db, "w", t0)!;
    expect(claim.channel).toBe("whatsapp");
    expect(claim.recipientFp).toBe(recipientFingerprint("+15550001111"));
    expect(stalePolicyProblem(claim, getSettings(db))).toBeNull();

    patchSettings(db, { notifications: { recipient: "+15550002222" } }, t0);
    expect(stalePolicyProblem(claim, getSettings(db))).toMatch(/^POLICY_CHANGED: the recipient was changed/);
    patchSettings(db, { notifications: { recipient: "+15550001111" } }, t0);
    expect(stalePolicyProblem(claim, getSettings(db))).toBeNull();
    patchSettings(db, { notifications: { channel: "outbox" } }, t0);
    expect(stalePolicyProblem(claim, getSettings(db))).toMatch(/^POLICY_CHANGED: the notification channel was changed/);
    expect(stalePolicyProblem({ channel: "outbox", recipientFp: null }, getSettings(db))).toBeNull();
    expect(JSON.stringify(claim)).not.toContain("+1555");
  });

  it("a blocked stale intent keeps the ready work and is never claimable again", () => {
    const { db, config } = makeTestDb();
    const t0 = T("2026-10-24T19:00:00Z");
    patchSettings(db, { notifications: { channel: "whatsapp", recipient: "+15550001111" } }, t0);
    const { taskId } = runToReady(db, config, "w", t0);
    const claim = claimDueNotification(db, "w", t0)!;
    completeNotification(db, claim.id, claim.ownerToken, { state: "blocked", message: "Not sent", providerMessageId: null, reason: "POLICY_CHANGED: x" }, t0);
    expect(claimDueNotification(db, "w", T("2026-10-25T19:00:00Z"))).toBeNull();
    expect(db.prepare("SELECT status FROM tasks WHERE id=?").get(taskId)).toEqual({ status: "ready" });
    expect(db.prepare("SELECT COUNT(*) n FROM artifacts WHERE task_id=?").get(taskId)).toEqual({ n: 2 });
  });

  it("queued intents keep their own schedule when quiet hours are edited; new ones use the new settings", () => {
    const { db, config } = quietSetup();
    runToReady(db, config, "a", T("2026-10-24T06:30:00Z")); // scheduled 15:00Z
    patchSettings(db, { notifications: { digestTime: "12:00" } }, T("2026-10-24T06:40:00Z"));
    expect(rows(db)[0]!.scheduled_for).toBe("2026-10-24T15:00:00.000Z");
    runToReady(db, config, "b", T("2026-10-24T06:50:00Z")); // new setting: noon digest, same local date -> joins the open digest
    expect(rows(db)).toHaveLength(1);
    expect(memberCount(db)).toBe(2);
  });
});

describe("an unusable stored schedule never fails the ready commit", () => {
  it("falls back to an immediate notification with a warning event", () => {
    const { db, config } = makeTestDb();
    // Bypasses patchSettings validation on purpose: a value that is already stored and no longer usable.
    const cur = JSON.parse((db.prepare("SELECT settings_json FROM workspace_settings").get() as { settings_json: string }).settings_json);
    cur.notifications.quietHours = { enabled: true, start: "22:00", end: "08:00", timezone: "Nope/Zone" };
    db.prepare("UPDATE workspace_settings SET settings_json=?").run(JSON.stringify(cur));
    const { taskId } = runToReady(db, config, "bad-zone", T("2026-10-24T06:30:00Z"));
    expect(db.prepare("SELECT status FROM tasks WHERE id=?").get(taskId)).toEqual({ status: "ready" });
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({ kind: "immediate", state: "queued" });
    const warn = db.prepare("SELECT message FROM task_events WHERE task_id=? AND type='warning' AND stage='notify'").all(taskId) as Array<{ message: string }>;
    expect(warn.some((w) => /could not be computed/.test(w.message))).toBe(true);
  });
});

describe("provider submission bookkeeping", () => {
  const setup = () => {
    const ctx = makeTestDb();
    patchSettings(ctx.db, { notifications: { channel: "whatsapp", recipient: null } }, new Date());
    return ctx;
  };
  const jobsAndTasks = (db: Db) => ({
    jobs: db.prepare("SELECT task_id, revision, status, attempts FROM jobs ORDER BY task_id").all(),
    tasks: db.prepare("SELECT id, status, revision FROM tasks ORDER BY id").all(),
    artifacts: db.prepare("SELECT id, sha256 FROM artifacts ORDER BY id").all(),
  });

  it("death after the submission marker -> DELIVERY_UNCERTAIN, never resent, generation untouched", () => {
    const { db, config } = setup();
    const t0 = T("2026-10-24T19:00:00Z");
    runToReady(db, config, "a", t0);
    const before = jobsAndTasks(db);
    const c = claimDueNotification(db, "dead", t0)!;
    expect(markSubmitStarted(db, c.id, c.ownerToken, t0)).toBe(true);
    // Worker dies here. A later worker recovers after the 60 s lease.
    expect(recoverNotificationLeases(db, T("2026-10-24T19:00:30Z"))).toBe(0); // lease still valid
    expect(recoverNotificationLeases(db, T("2026-10-24T19:01:01Z"))).toBe(1);
    const r = db.prepare("SELECT state, last_error, attempts FROM notifications").get() as { state: string; last_error: string; attempts: number };
    expect(r).toMatchObject({ state: "failed", attempts: 1 });
    expect(r.last_error).toMatch(/^DELIVERY_UNCERTAIN/);
    expect(claimDueNotification(db, "w2", T("2026-10-25T19:00:00Z"))).toBeNull();
    expect(jobsAndTasks(db)).toEqual(before);
    const ev = db.prepare("SELECT message FROM task_events WHERE stage='notify' AND type='warning'").all() as Array<{ message: string }>;
    expect(ev.some((e) => /DELIVERY_UNCERTAIN/.test(e.message))).toBe(true);
  });

  it("a stale worker cannot record a result after recovery decided the send was uncertain", () => {
    const { db, config } = setup();
    const t0 = T("2026-10-24T19:00:00Z");
    runToReady(db, config, "a", t0);
    const c = claimDueNotification(db, "slow", t0)!;
    markSubmitStarted(db, c.id, c.ownerToken, t0);
    recoverNotificationLeases(db, T("2026-10-24T19:02:00Z"));
    expect(completeNotification(db, c.id, c.ownerToken, { state: "accepted", message: "m", providerMessageId: "SM1", reason: null }, T("2026-10-24T19:02:05Z"))).toBe(false);
    expect(db.prepare("SELECT state, provider_message_id FROM notifications").get()).toEqual({ state: "failed", provider_message_id: null });
  });

  it("a transient rejection clears the marker so the retry is a fresh submission; a later death is uncertain again", () => {
    const { db, config } = setup();
    const t0 = T("2026-10-24T19:00:00Z");
    runToReady(db, config, "a", t0);
    const c1 = claimDueNotification(db, "w", t0)!;
    markSubmitStarted(db, c1.id, c1.ownerToken, t0);
    expect(failNotification(db, c1.id, c1.ownerToken, { message: "RATE_LIMITED: 429", retryable: true }, t0)).toBe("retry");
    expect((db.prepare("SELECT submit_started_at FROM notifications").get() as { submit_started_at: string | null }).submit_started_at).toBeNull();
    expect(claimDueNotification(db, "w", T("2026-10-24T19:00:30Z"))).toBeNull(); // backing off
    const c2 = claimDueNotification(db, "w", T("2026-10-24T19:01:01Z"))!;
    expect(c2.attempts).toBe(2);
    markSubmitStarted(db, c2.id, c2.ownerToken, T("2026-10-24T19:01:01Z"));
    recoverNotificationLeases(db, T("2026-10-24T19:03:00Z"));
    expect(db.prepare("SELECT state FROM notifications").get()).toEqual({ state: "failed" });
  });

  it("claim, release before any submission, and re-claim: not uncertain, no extra row", () => {
    const { db, config } = setup();
    const t0 = T("2026-10-24T19:00:00Z");
    runToReady(db, config, "a", t0);
    claimDueNotification(db, "dead", t0);
    recoverNotificationLeases(db, T("2026-10-24T19:02:00Z"));
    const c = claimDueNotification(db, "w2", T("2026-10-24T19:02:01Z"))!;
    expect(c.attempts).toBe(2);
    expect(rows(db)).toHaveLength(1);
    expect(db.prepare("SELECT state FROM notifications").get()).toEqual({ state: "queued" });
  });

  it("accepted is recorded as accepted (never delivered) and ends the lifecycle", () => {
    const { db, config } = setup();
    const t0 = T("2026-10-24T19:00:00Z");
    runToReady(db, config, "a", t0);
    const c = claimDueNotification(db, "w", t0)!;
    markSubmitStarted(db, c.id, c.ownerToken, t0);
    completeNotification(db, c.id, c.ownerToken, { state: "accepted", message: "Accepted by provider", providerMessageId: "SM123", reason: null }, t0);
    expect(db.prepare("SELECT state, provider_message_id FROM notifications").get()).toEqual({ state: "accepted", provider_message_id: "SM123" });
    expect(claimDueNotification(db, "w", T("2026-10-25T00:00:00Z"))).toBeNull();
  });
});

describe("migration 003 on an existing database", () => {
  it("backfills membership from the JSON columns and seals notifications that already left the queue", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { readMigrations, migrate } = await import("../src");
    const dir = mkdtempSync(path.join(tmpdir(), "mig3-"));
    const db = openDb(path.join(dir, "m.sqlite"));
    const files = readMigrations();
    migrate(db, new Date(), files.filter((f) => f.version <= 2));
    const upTo3 = files.filter((f) => f.version <= 3);
    const t = "2026-10-24T00:00:00.000Z";
    db.prepare("INSERT INTO intake_messages (id, source_key, ingestion_mode, envelope_json, received_at, created_at) VALUES ('i1','s1','demo','{}',?,?),('i2','s2','demo','{}',?,?)").run(t, t, t, t);
    for (const [id, intake] of [["t1", "i1"], ["t2", "i2"]] as const) {
      db.prepare(`INSERT INTO tasks (id, intake_id, status, revision, title, ingestion_mode, generation_mode, sender_email, subject, created_at, updated_at)
        VALUES (?,?,'ready',1,'T','demo','fixture','a@x.example','s',?,?)`).run(id, intake, t, t);
    }
    db.prepare(`INSERT INTO notifications (id, dedupe_key, channel, state, message, task_ids_json, task_revisions_json, scheduled_for, created_at, updated_at)
      VALUES ('n1','digest/2026-10-24/outbox','outbox','simulated','m','["t1","t2"]','[1,1]',?,?,?),('n2','t1/1/whatsapp','whatsapp','queued','m','["t1"]','[1]',?,?,?)`).run(t, t, t, t, t, t);
    expect(migrate(db, new Date(), upTo3)).toEqual(["003_batch5_durability.sql"]);
    expect(db.prepare("SELECT notification_id, task_id, revision, channel, ordinal FROM notification_members ORDER BY notification_id, ordinal").all()).toEqual([
      { notification_id: "n1", task_id: "t1", revision: 1, channel: "outbox", ordinal: 0 },
      { notification_id: "n1", task_id: "t2", revision: 1, channel: "outbox", ordinal: 1 },
      { notification_id: "n2", task_id: "t1", revision: 1, channel: "whatsapp", ordinal: 0 },
    ]);
    expect(db.prepare("SELECT id, kind, sealed_at IS NOT NULL AS sealed FROM notifications ORDER BY id").all()).toEqual([
      { id: "n1", kind: "digest", sealed: 1 }, { id: "n2", kind: "immediate", sealed: 0 },
    ]);
    db.close();
  });
});
