import { createHash } from "node:crypto";
import type { NotificationRecord, WorkspaceSettings } from "@afterhours/contracts";
import type { AppConfig } from "./config";
import type { Db } from "./db";
import { badRequest } from "./errors";
import { addEvent } from "./events";
import { computeDeliverySchedule, type DeliverySchedule } from "./schedule";
import { getSettings } from "./settings";
import { addSeconds, iso, newId, parseJson } from "./util";

export type Schedule = DeliverySchedule;

/** Decide when a ready notification may be delivered. Generation is never delayed. See schedule.ts for the policy. */
export function scheduleNotification(settings: WorkspaceSettings, now: Date): Schedule {
  return computeDeliverySchedule(
    { quietHours: settings.notifications.quietHours, digestTime: settings.notifications.digestTime },
    now,
  );
}

/** Never throws: a ready commit must not fail because a stored policy is unusable. Falls back to immediate. */
function safeSchedule(settings: WorkspaceSettings, now: Date): { sched: Schedule; error: string | null } {
  try {
    return { sched: scheduleNotification(settings, now), error: null };
  } catch (e) {
    return {
      sched: { immediate: true, scheduledFor: now, localDate: null, timezone: settings.notifications.quietHours.timezone },
      error: e instanceof Error ? e.message : "unknown scheduling error",
    };
  }
}

/**
 * Operator-side policy for a live WhatsApp send, computed from server configuration only (never from a
 * browser assertion). Returns the reason a send must be blocked, or null when the adapter may be called.
 * Live sends go only to the operator-designated test recipient (TWILIO_WHATSAPP_TO).
 */
export function whatsappPolicyProblem(
  config: AppConfig, settings: WorkspaceSettings, now: Date,
): string | null {
  const w = config.whatsapp;
  if (!w.twilioAccountSid || !w.twilioAuthToken || !w.from) return "WhatsApp is not configured on the server (Twilio credentials and sender are missing).";
  if (!w.useCaseEligible) return "The operator has not confirmed that this use case is eligible for WhatsApp (WHATSAPP_USE_CASE_ELIGIBLE=false).";
  if (!w.to) return "No operator-designated WhatsApp test recipient is configured (TWILIO_WHATSAPP_TO).";
  const recipient = settings.notifications.recipient ?? w.to;
  if (recipient !== w.to) return "The recipient in Settings is not the operator-designated test recipient; live sends are refused.";
  const windowOpen = !!w.customerServiceWindowUntil && Date.parse(w.customerServiceWindowUntil) > now.getTime();
  if (!windowOpen && !w.contentSid) return "The customer-service window is closed and no approved template (TWILIO_CONTENT_SID) is configured.";
  return null;
}

/**
 * Fingerprint of the Settings recipient, stored with a queued intent. It is a plain SHA-256 (phone numbers have
 * little entropy, so treat it as sensitive as the number itself; it lives only in the local database and is never
 * returned by the API or logged).
 */
export const recipientFingerprint = (recipient: string | null): string =>
  createHash("sha256").update(`recipient:${recipient ?? ""}`).digest("hex");

interface NotifRow {
  id: string; dedupe_key: string; task_id: string | null; revision: number | null;
  channel: "outbox" | "whatsapp"; state: NotificationRecord["state"]; message: string;
  task_ids_json: string; task_revisions_json: string; scheduled_for: string; local_date: string | null;
  timezone: string | null; provider_message_id: string | null; last_error: string | null; created_at: string;
  attempts: number; lease_until: string | null; lease_owner: string | null;
  kind: "immediate" | "digest"; sealed_at: string | null; submit_started_at: string | null; recipient_fp: string | null;
}

export const rowToNotification = (r: NotifRow): NotificationRecord => ({
  id: r.id,
  taskId: r.task_id,
  revision: r.revision,
  channel: r.channel,
  state: r.state,
  message: r.message,
  taskIds: parseJson<string[]>(r.task_ids_json, []),
  scheduledFor: r.scheduled_for,
  providerMessageId: r.provider_message_id,
  lastError: r.last_error,
  createdAt: r.created_at,
});

interface MemberRow { task_id: string; revision: number }

const membersOf = (db: Db, notificationId: string): MemberRow[] =>
  db.prepare("SELECT task_id, revision FROM notification_members WHERE notification_id=? ORDER BY ordinal").all(notificationId) as MemberRow[];

/** Keep the public task list columns in step with the member table (the member table is authoritative). */
function syncMembersJson(db: Db, notificationId: string, now: Date): void {
  const m = membersOf(db, notificationId);
  db.prepare("UPDATE notifications SET task_ids_json=?, task_revisions_json=?, updated_at=? WHERE id=?").run(
    JSON.stringify(m.map((x) => x.task_id)), JSON.stringify(m.map((x) => x.revision)), iso(now), notificationId);
}

function addMember(db: Db, notificationId: string, channel: string, taskId: string, revision: number): void {
  const n = (db.prepare("SELECT COALESCE(MAX(ordinal), -1) + 1 AS n FROM notification_members WHERE notification_id=?").get(notificationId) as { n: number }).n;
  db.prepare("INSERT INTO notification_members (notification_id, task_id, revision, channel, ordinal) VALUES (?,?,?,?,?)")
    .run(notificationId, taskId, revision, channel, n);
}

const findOpenDigest = (db: Db, channel: string, localDate: string, exceptId?: string): NotifRow | undefined =>
  db.prepare(
    `SELECT * FROM notifications WHERE kind='digest' AND channel=? AND local_date=? AND state='queued'
       AND sealed_at IS NULL AND lease_owner IS NULL AND id <> ? ORDER BY created_at, id LIMIT 1`,
  ).get(channel, localDate, exceptId ?? "") as NotifRow | undefined;

/** digest/<date>/<channel> for the first digest of a local date; a sealed or already-sent one gets /2, /3, ... */
function nextDigestKey(db: Db, localDate: string, channel: string): string {
  const base = `digest/${localDate}/${channel}`;
  for (let n = 1; ; n++) {
    const key = n === 1 ? base : `${base}/${n}`;
    if (!db.prepare("SELECT 1 FROM notifications WHERE dedupe_key=?").get(key)) return key;
  }
}

/**
 * Create (or join) the notification intent for a ready task revision. Runs inside the ready-commit transaction.
 *
 * One member row per task revision and channel across BOTH routes (UNIQUE in notification_members), so a revision
 * can never be delivered immediately and again in a digest. Immediate key: taskId/revision/channel. During quiet
 * hours a revision joins the open (unsealed) digest for the target local date; if that digest was already claimed
 * its membership is frozen, so a new arrival starts a follow-up digest (digest/<date>/<channel>/<n>) instead of
 * being appended to a message that may already be sent.
 */
export function createReadyNotification(db: Db, taskId: string, revision: number, now: Date): void {
  const settings = getSettings(db);
  const channel = settings.notifications.channel;
  if (db.prepare("SELECT 1 FROM notification_members WHERE task_id=? AND revision=? AND channel=?").get(taskId, revision, channel)) return;
  const { sched, error } = safeSchedule(settings, now);
  const t = iso(now);
  const fp = recipientFingerprint(settings.notifications.recipient);

  if (sched.immediate) {
    const id = newId();
    db.prepare(
      `INSERT INTO notifications (id, dedupe_key, task_id, revision, channel, state, message, kind,
         task_ids_json, task_revisions_json, scheduled_for, timezone, recipient_fp, created_at, updated_at)
       VALUES (?,?,?,?,?,'queued',?,'immediate',?,?,?,?,?,?,?)`,
    ).run(id, `${taskId}/${revision}/${channel}`, taskId, revision, channel, "Queued: results ready for review.",
      JSON.stringify([taskId]), JSON.stringify([revision]), iso(sched.scheduledFor), sched.timezone, fp, t, t);
    addMember(db, id, channel, taskId, revision);
    addEvent(db, taskId, revision, "progress", "notify", "Notification queued.", now);
    if (error) addEvent(db, taskId, revision, "warning", "notify", "Quiet-hours schedule could not be computed; queued for immediate delivery.", now);
    return;
  }

  const open = findOpenDigest(db, channel, sched.localDate!);
  if (open) {
    addMember(db, open.id, channel, taskId, revision);
    syncMembersJson(db, open.id, now);
  } else {
    const id = newId();
    db.prepare(
      `INSERT INTO notifications (id, dedupe_key, task_id, revision, channel, state, message, kind,
         task_ids_json, task_revisions_json, scheduled_for, local_date, timezone, recipient_fp, created_at, updated_at)
       VALUES (?,?,NULL,NULL,?,'queued',?,'digest',?,?,?,?,?,?,?,?)`,
    ).run(id, nextDigestKey(db, sched.localDate!, channel), channel, "Queued: morning digest.",
      JSON.stringify([taskId]), JSON.stringify([revision]), iso(sched.scheduledFor), sched.localDate, sched.timezone, fp, t, t);
    addMember(db, id, channel, taskId, revision);
  }
  addEvent(db, taskId, revision, "progress", "notify",
    `Quiet hours: notification scheduled for ${sched.localDate} (${sched.timezone}).`, now);
}

export const NOTIFY_LEASE_SECONDS = 60;
export const NOTIFY_MAX_ATTEMPTS = 3;

export interface ClaimedNotification {
  id: string;
  channel: "outbox" | "whatsapp";
  kind: "immediate" | "digest";
  tasks: Array<{ id: string; title: string; revision: number; artifactCount: number }>;
  ownerToken: string;
  attempts: number;
  /** Recipient fingerprint recorded when the intent was queued. */
  recipientFp: string | null;
}

/**
 * Move a due row to the next eligible time under the CURRENT policy (delivery must never happen in quiet hours,
 * including after a late worker start or a settings edit). An unsealed digest that lands on a local date that
 * already has an open digest is merged into it.
 */
function deferRow(db: Db, r: NotifRow, sched: Schedule, now: Date): void {
  const t = iso(now);
  if (r.kind === "digest" && !r.sealed_at && sched.localDate) {
    const other = findOpenDigest(db, r.channel, sched.localDate, r.id);
    if (other) {
      for (const m of membersOf(db, r.id)) {
        db.prepare("DELETE FROM notification_members WHERE notification_id=? AND task_id=? AND revision=?").run(r.id, m.task_id, m.revision);
        addMember(db, other.id, r.channel, m.task_id, m.revision);
      }
      syncMembersJson(db, other.id, now);
      db.prepare("DELETE FROM notifications WHERE id=?").run(r.id);
      return;
    }
  }
  db.prepare("UPDATE notifications SET scheduled_for=?, local_date=COALESCE(?, local_date), timezone=?, updated_at=? WHERE id=?").run(
    iso(sched.scheduledFor), r.kind === "digest" && !r.sealed_at ? sched.localDate : null, sched.timezone, t, r.id);
}

/**
 * Claim the next due notification. In one short transaction: re-evaluate quiet hours at dispatch time, then lease
 * the row and SEAL its membership (a digest's tasks are snapshotted here; later arrivals go to a follow-up row).
 */
export function claimDueNotification(db: Db, workerId: string, now: Date): ClaimedNotification | null {
  return db.transaction((): ClaimedNotification | null => {
    const settings = getSettings(db);
    for (let guard = 0; guard < 25; guard++) {
      const r = db.prepare(
        `SELECT * FROM notifications WHERE state='queued' AND scheduled_for <= ? AND lease_owner IS NULL
           ORDER BY scheduled_for, created_at, id LIMIT 1`,
      ).get(iso(now)) as NotifRow | undefined;
      if (!r) return null;
      const { sched, error } = safeSchedule(settings, now);
      if (!sched.immediate && !error) {
        deferRow(db, r, sched, now);
        continue;
      }
      const owner = `${workerId}:${newId()}`;
      db.prepare(
        "UPDATE notifications SET lease_owner=?, lease_until=?, attempts=attempts+1, sealed_at=COALESCE(sealed_at, ?), updated_at=? WHERE id=?",
      ).run(owner, iso(addSeconds(now, NOTIFY_LEASE_SECONDS)), iso(now), iso(now), r.id);
      const tasks = membersOf(db, r.id).map((m) => {
        const row = db.prepare("SELECT title FROM tasks WHERE id=?").get(m.task_id) as { title: string } | undefined;
        const c = db.prepare("SELECT COUNT(*) n FROM artifacts WHERE task_id=? AND revision=?").get(m.task_id, m.revision) as { n: number };
        return { id: m.task_id, title: row?.title ?? "(unknown task)", revision: m.revision, artifactCount: c.n };
      });
      return { id: r.id, channel: r.channel, kind: r.kind, tasks, ownerToken: owner, attempts: r.attempts + 1, recipientFp: r.recipient_fp };
    }
    return null;
  }).immediate();
}

/**
 * Reason a queued LIVE message must not go out under the current Settings, or null. Outbox rows send nothing, so
 * they never go stale. A stale intent is blocked (never rerouted): the ready work stays reviewable.
 */
export function stalePolicyProblem(
  claim: Pick<ClaimedNotification, "channel" | "recipientFp">, settings: WorkspaceSettings,
): string | null {
  if (claim.channel === "outbox") return null;
  if (settings.notifications.channel !== claim.channel) {
    return "POLICY_CHANGED: the notification channel was changed in Settings after this message was queued; it was not sent.";
  }
  if (claim.recipientFp !== null && claim.recipientFp !== recipientFingerprint(settings.notifications.recipient)) {
    return "POLICY_CHANGED: the recipient was changed in Settings after this message was queued; it was not sent to the new recipient.";
  }
  return null;
}

/** Durably record that a provider submission may begin. Returns false if this worker no longer owns the lease. */
export function markSubmitStarted(db: Db, id: string, ownerToken: string, now: Date): boolean {
  const r = db.prepare(
    "UPDATE notifications SET submit_started_at=?, updated_at=? WHERE id=? AND lease_owner=? AND state='queued'",
  ).run(iso(now), iso(now), id, ownerToken);
  return r.changes > 0;
}

export function completeNotification(
  db: Db,
  id: string,
  ownerToken: string,
  result: { state: "simulated" | "accepted" | "blocked"; message: string; providerMessageId: string | null; reason: string | null },
  now: Date,
): boolean {
  return db.transaction(() => {
    const r = db.prepare(
      `UPDATE notifications SET state=?, message=?, provider_message_id=?, last_error=?,
         lease_owner=NULL, lease_until=NULL, updated_at=? WHERE id=? AND lease_owner=? AND state='queued'`,
    ).run(result.state, result.message.slice(0, 2000), result.providerMessageId,
      result.state === "blocked" ? (result.reason ?? "Blocked by delivery policy.") : null, iso(now), id, ownerToken);
    if (r.changes === 0) return false;
    const row = db.prepare("SELECT * FROM notifications WHERE id=?").get(id) as NotifRow;
    for (const m of membersOf(db, id)) {
      addEvent(db, m.task_id, m.revision, "progress", "notify", `Notification ${result.state} (${row.channel}).`, now);
    }
    return true;
  }).immediate();
}

/** Retryable provider errors back off; everything else (including DELIVERY_UNCERTAIN) is terminal. */
export function failNotification(
  db: Db,
  id: string,
  ownerToken: string,
  error: { message: string; retryable: boolean },
  now: Date,
): "retry" | "failed" | "lost" {
  return db.transaction((): "retry" | "failed" | "lost" => {
    const row = db.prepare("SELECT * FROM notifications WHERE id=? AND lease_owner=? AND state='queued'").get(id, ownerToken) as NotifRow | undefined;
    if (!row) return "lost";
    const msg = error.message.slice(0, 500);
    if (error.retryable && row.attempts < NOTIFY_MAX_ATTEMPTS) {
      // The provider definitively did not take the message (the delivery adapter's retryable contract), so the
      // submission marker is cleared and a later attempt is a fresh, safe submission.
      db.prepare(
        "UPDATE notifications SET lease_owner=NULL, lease_until=NULL, submit_started_at=NULL, last_error=?, scheduled_for=?, updated_at=? WHERE id=?",
      ).run(msg, iso(addSeconds(now, 60 * row.attempts)), iso(now), id);
      return "retry";
    }
    db.prepare("UPDATE notifications SET state='failed', lease_owner=NULL, lease_until=NULL, last_error=?, updated_at=? WHERE id=?").run(msg, iso(now), id);
    for (const m of membersOf(db, id)) addEvent(db, m.task_id, m.revision, "warning", "notify", `Notification failed: ${msg}`, now);
    return "failed";
  }).immediate();
}

export const UNCERTAIN_MESSAGE =
  "DELIVERY_UNCERTAIN: the worker stopped after a provider submission may have begun, so the provider may have accepted it. It was not resent automatically.";

/**
 * A worker died or stalled while holding a notification lease.
 *  - Live channel, submission marker set: the provider may already have accepted the message. Recorded as
 *    failed / DELIVERY_UNCERTAIN and never resent automatically.
 *  - Live channel, marker not set: the provider was never called, so the row is released and tried again.
 *  - Outbox: nothing external can have happened; released and tried again.
 * Never touches jobs or task status: generation is not rerun and ready work stays ready.
 */
export function recoverNotificationLeases(db: Db, now: Date): number {
  return db.transaction(() => {
    const rows = db.prepare(
      "SELECT * FROM notifications WHERE state='queued' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL AND lease_until <= ?",
    ).all(iso(now)) as NotifRow[];
    for (const r of rows) {
      if (r.channel !== "outbox" && r.submit_started_at) {
        db.prepare(
          "UPDATE notifications SET state='failed', lease_owner=NULL, lease_until=NULL, last_error=?, updated_at=? WHERE id=?",
        ).run(UNCERTAIN_MESSAGE.slice(0, 500), iso(now), r.id);
        for (const m of membersOf(db, r.id)) {
          addEvent(db, m.task_id, m.revision, "warning", "notify", `Notification failed: ${UNCERTAIN_MESSAGE}`.slice(0, 500), now);
        }
      } else {
        db.prepare("UPDATE notifications SET lease_owner=NULL, lease_until=NULL, submit_started_at=NULL, updated_at=? WHERE id=?").run(iso(now), r.id);
      }
    }
    return rows.length;
  }).immediate();
}

export function listNotifications(db: Db, cursor: string | null, limit: number): { items: NotificationRecord[]; nextCursor: string | null } {
  const c = cursor ? decodeCursor(cursor) : null;
  if (cursor && !c) throw badRequest("Invalid cursor.");
  const rows = (c
    ? db.prepare(
        `SELECT * FROM notifications WHERE (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC LIMIT ?`).all(c.c, c.c, c.i, limit + 1)
    : db.prepare("SELECT * FROM notifications ORDER BY created_at DESC, id DESC LIMIT ?").all(limit + 1)) as NotifRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(rowToNotification),
    nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export const encodeCursor = (c: string, i: string): string => Buffer.from(JSON.stringify({ c, i })).toString("base64url");
export function decodeCursor(s: string): { c: string; i: string } | null {
  try {
    const v = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as { c?: unknown; i?: unknown };
    return typeof v.c === "string" && typeof v.i === "string" ? { c: v.c, i: v.i } : null;
  } catch {
    return null;
  }
}
