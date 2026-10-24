import { describe, expect, it } from "vitest";
import {
  claimDueNotification, completeNotification, failNotification, getSettings, inQuietHours, markSubmitStarted, openDb,
  patchSettings, recoverNotificationLeases, scheduleNotification,
} from "../src";
import { makeTestDb, runToReady } from "../src/testing";

const quiet = { enabled: true, start: "22:00", end: "07:00", timezone: "America/Los_Angeles" };

describe("quiet hours", () => {
  it("handles windows crossing midnight", () => {
    // 2026-03-02 is PST (UTC-8).
    expect(inQuietHours(quiet, new Date("2026-03-03T07:30:00Z"))).toBe(true);  // 23:30 local
    expect(inQuietHours(quiet, new Date("2026-03-02T14:59:00Z"))).toBe(true);  // 06:59 local
    expect(inQuietHours(quiet, new Date("2026-03-02T15:00:00Z"))).toBe(false); // 07:00 local
    expect(inQuietHours(quiet, new Date("2026-03-02T20:00:00Z"))).toBe(false); // 12:00 local
    expect(inQuietHours({ ...quiet, enabled: false }, new Date("2026-03-03T07:30:00Z"))).toBe(false);
    expect(inQuietHours({ ...quiet, start: "09:00", end: "17:00" }, new Date("2026-03-02T20:00:00Z"))).toBe(true);
  });

  it("schedules a 23:30 result for the next local morning digest", () => {
    const { db } = makeTestDb();
    const s = patchSettings(db, { notifications: { quietHours: quiet, digestTime: "08:00" } }, new Date());
    const sched = scheduleNotification(s, new Date("2026-03-03T07:30:00Z")); // Mar 2, 23:30 PST
    expect(sched.immediate).toBe(false);
    expect(sched.localDate).toBe("2026-03-03");
    expect(sched.scheduledFor.toISOString()).toBe("2026-03-03T16:00:00.000Z"); // 08:00 PST
  });

  it("keeps the digest in the local morning across the spring-forward DST change", () => {
    const { db } = makeTestDb();
    const s = patchSettings(db, { notifications: { quietHours: quiet, digestTime: "08:00" } }, new Date());
    // Sat Mar 7 2026 23:30 PST; DST starts Sun Mar 8 at 02:00.
    const sched = scheduleNotification(s, new Date("2026-03-08T07:30:00Z"));
    expect(sched.localDate).toBe("2026-03-08");
    expect(sched.scheduledFor.toISOString()).toBe("2026-03-08T15:00:00.000Z"); // 08:00 PDT
  });

  it("resolves a nonexistent local digest time forward, and never before quiet hours end", () => {
    const { db } = makeTestDb();
    const s1 = patchSettings(db, { notifications: { quietHours: { ...quiet, end: "01:00" }, digestTime: "02:30" } }, new Date());
    // 02:30 on Mar 8 does not exist in Los Angeles; Luxon moves it to 03:30 PDT.
    expect(scheduleNotification(s1, new Date("2026-03-08T07:30:00Z")).scheduledFor.toISOString()).toBe("2026-03-08T10:30:00.000Z");
    const s2 = patchSettings(db, { notifications: { quietHours: quiet, digestTime: "06:00" } }, new Date());
    // Digest time falls inside quiet hours -> delivered at quiet-hours end (07:00 PST).
    expect(scheduleNotification(s2, new Date("2026-03-03T07:30:00Z")).scheduledFor.toISOString()).toBe("2026-03-03T15:00:00.000Z");
  });

  it("groups same-night results into one persisted digest that survives restart", () => {
    const { db, config } = makeTestDb();
    patchSettings(db, { notifications: { quietHours: quiet, digestTime: "08:00" } }, new Date());
    const a = runToReady(db, config, "a", new Date("2026-03-03T07:30:00Z"));
    const b = runToReady(db, config, "b", new Date("2026-03-03T09:10:00Z")); // 01:10 local, same night
    const db2 = openDb(config.databasePath); // "restarted" process
    const rows = db2.prepare("SELECT dedupe_key, task_ids_json, scheduled_for, state FROM notifications").all() as Array<Record<string, string>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupe_key).toBe("digest/2026-03-03/outbox");
    expect(JSON.parse(rows[0]!.task_ids_json!)).toEqual([a.taskId, b.taskId]);
    expect(claimDueNotification(db2, "w", new Date("2026-03-03T15:59:00Z"))).toBeNull();
    const c = claimDueNotification(db2, "w", new Date("2026-03-03T16:00:00Z"));
    expect(c?.tasks.map((t) => t.id)).toEqual([a.taskId, b.taskId]);
    db2.close();
  });
});

describe("notification outbox", () => {
  it("sends immediately outside quiet hours and is unique per task revision", () => {
    const { db, config } = makeTestDb();
    const now = new Date("2026-03-02T20:00:00Z");
    const { taskId } = runToReady(db, config, "k", now);
    const rows = db.prepare("SELECT dedupe_key, scheduled_for FROM notifications").all() as Array<Record<string, string>>;
    expect(rows).toEqual([{ dedupe_key: `${taskId}/1/outbox`, scheduled_for: now.toISOString() }]);
    expect(getSettings(db).notifications.channel).toBe("outbox");
  });

  it("records blocked as final; retries retryable errors with backoff; fails non-retryable", () => {
    const { db, config } = makeTestDb();
    const t0 = new Date("2026-03-02T20:00:00Z");
    runToReady(db, config, "a", t0);
    const c1 = claimDueNotification(db, "w", t0)!;
    expect(completeNotification(db, c1.id, c1.ownerToken, { state: "blocked", message: "m", providerMessageId: null, reason: "Not eligible" }, t0)).toBe(true);
    expect(claimDueNotification(db, "w", new Date(t0.getTime() + 3600_000))).toBeNull();
    expect(db.prepare("SELECT state, last_error FROM notifications WHERE id=?").get(c1.id)).toEqual({ state: "blocked", last_error: "Not eligible" });

    runToReady(db, config, "b", t0);
    const c2 = claimDueNotification(db, "w", t0)!;
    expect(failNotification(db, c2.id, c2.ownerToken, { message: "503", retryable: true }, t0)).toBe("retry");
    expect(claimDueNotification(db, "w", new Date(t0.getTime() + 30_000))).toBeNull();
    const c3 = claimDueNotification(db, "w", new Date(t0.getTime() + 61_000))!;
    expect(c3.id).toBe(c2.id);
    expect(failNotification(db, c3.id, c3.ownerToken, { message: "DELIVERY_UNCERTAIN: timeout", retryable: false }, t0)).toBe("failed");
    expect(db.prepare("SELECT state FROM notifications WHERE id=?").get(c2.id)).toEqual({ state: "failed" });
  });

  it("does not resend a live send interrupted after submission began; unsubmitted and outbox rows are safe to repeat", () => {
    const { db, config } = makeTestDb();
    const t0 = new Date("2026-03-02T20:00:00Z");
    patchSettings(db, { notifications: { channel: "whatsapp" } }, t0);
    runToReady(db, config, "w", t0);
    const c = claimDueNotification(db, "w", t0)!;
    expect(markSubmitStarted(db, c.id, c.ownerToken, t0)).toBe(true);
    recoverNotificationLeases(db, new Date(t0.getTime() + 120_000));
    const r = db.prepare("SELECT state, last_error FROM notifications").get() as { state: string; last_error: string };
    expect(r.state).toBe("failed");
    expect(r.last_error).toMatch(/DELIVERY_UNCERTAIN/);
    expect(claimDueNotification(db, "w", new Date(t0.getTime() + 3600_000))).toBeNull();

    // Worker died after claiming but BEFORE the provider could have been called: nothing external happened.
    runToReady(db, config, "x", t0);
    const c2 = claimDueNotification(db, "w", t0)!;
    recoverNotificationLeases(db, new Date(t0.getTime() + 120_000));
    expect(db.prepare("SELECT state FROM notifications WHERE id=?").get(c2.id)).toEqual({ state: "queued" });
    expect(claimDueNotification(db, "w2", new Date(t0.getTime() + 121_000))?.id).toBe(c2.id);
  });
});
