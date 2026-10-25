import { rmSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config";
import type { Db } from "./db";
import { DomainError, notFound } from "./errors";
import { auditIntake } from "./ingest";
import { iso } from "./util";

/** Statuses a worker may be using right now. Deleting under it would race the job, so it is refused until it settles. */
const ACTIVE = new Set(["queued", "planning", "running"]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface TaskDeletion { deleted: true; files: number }

/**
 * Permanently delete one task and its work. Everything tied to the task goes in one transaction (cascade), then its
 * stored files are removed. Mailbox tasks leave a message-key tombstone so the same email is not ingested again.
 * Context copied from email history under a grant is separate and is managed by that grant's purge.
 */
export function deleteTask(db: Db, config: Pick<AppConfig, "artifactsDir">, taskId: string, now: Date): TaskDeletion {
  const files = db.transaction((): number => {
    const task = db.prepare("SELECT id, status, intake_id, ingestion_mode FROM tasks WHERE id = ?").get(taskId) as
      | { id: string; status: string; intake_id: string; ingestion_mode: "demo" | "gmail" } | undefined;
    if (!task) throw notFound("Task");
    if (ACTIVE.has(task.status)) {
      throw new DomainError("TASK_ACTIVE", `This task is ${task.status === "queued" ? "waiting to start" : "being prepared"}. Wait for it to finish, then delete it.`, 409);
    }
    const intake = db.prepare("SELECT source_key FROM intake_messages WHERE id = ?").get(task.intake_id) as { source_key: string } | undefined;
    const count = (db.prepare("SELECT COUNT(*) n FROM artifacts WHERE task_id = ?").get(taskId) as { n: number }).n;
    // Digest notifications can name several tasks. Drop one only when this task was its last member.
    const digestIds = db.prepare("SELECT DISTINCT notification_id FROM notification_members WHERE task_id = ?").all(taskId) as { notification_id: string }[];
    db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId); // cascades to every task-owned table
    for (const { notification_id } of digestIds) {
      const left = db.prepare("SELECT COUNT(*) n FROM notification_members WHERE notification_id = ?").get(notification_id) as { n: number };
      if (left.n === 0) db.prepare("DELETE FROM notifications WHERE id = ?").run(notification_id);
    }
    db.prepare("DELETE FROM intake_messages WHERE id = ?").run(task.intake_id);
    if (intake && task.ingestion_mode === "gmail") {
      db.prepare("INSERT OR IGNORE INTO deleted_intake (source_key, deleted_at) VALUES (?, ?)").run(intake.source_key, iso(now));
    }
    auditIntake(db, "task_deleted", `task:${taskId.slice(-12)}`, now);
    return count;
  }).immediate();

  // Files are removed after the rows are gone. A crash in between leaves unreferenced files, never a task without them.
  if (SAFE_ID.test(taskId)) {
    try { rmSync(path.join(config.artifactsDir, taskId), { recursive: true, force: true }); } catch { /* unreferenced leftovers are harmless */ }
  }
  return { deleted: true, files };
}
