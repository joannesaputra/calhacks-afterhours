import type { TaskStatus } from "@afterhours/contracts";
import type { Db } from "./db";
import { addEvent } from "./events";
import { notFound } from "./errors";
import { assertTransition } from "./state";
import { iso } from "./util";

export interface TaskRow {
  id: string;
  intake_id: string;
  status: TaskStatus;
  revision: number;
  title: string;
  ingestion_mode: "demo" | "gmail";
  generation_mode: "fixture" | "live";
  fixture_scenario: string | null;
  sender_name: string | null;
  sender_email: string;
  subject: string;
  requested_outputs_json: string;
  due_at: string | null;
  plan_json: string | null;
  products_json: string;
  questions_json: string;
  answers_json: string;
  /** Organization profile captured at ingestion (null for tasks created before migration 002). */
  organization_json: string | null;
  warning_count: number;
  error_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobRow {
  id: string;
  task_id: string;
  revision: number;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  available_at: string;
  lease_until: string | null;
  lease_owner: string | null;
  heartbeat_at: string | null;
  last_error: string | null;
}

export const MAX_ATTEMPTS = 2;
export const LEASE_SECONDS = 90;
export const RETRY_DELAY_SECONDS = 30;

export function getTaskRow(db: Db, id: string): TaskRow {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  if (!row) throw notFound("Task");
  return row;
}

/** Move a task along the state machine. Must run inside a transaction. */
export function setStatus(
  db: Db,
  task: Pick<TaskRow, "id" | "status">,
  to: TaskStatus,
  now: Date,
  opts?: { recovery?: boolean; correction?: boolean },
): void {
  assertTransition(task.status, to, opts);
  db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?").run(
    to,
    iso(now),
    task.id,
    task.status,
  );
  task.status = to;
}

export class LeaseLostError extends Error {
  constructor() {
    super("Job lease was lost or the task revision changed");
    this.name = "LeaseLostError";
  }
}

/** Throws LeaseLostError unless `owner` currently holds the job for task/revision and the revision is current. */
export function assertOwnedJob(db: Db, taskId: string, revision: number, owner: string): { job: JobRow; task: TaskRow } {
  const job = db
    .prepare("SELECT * FROM jobs WHERE task_id = ? AND revision = ?")
    .get(taskId, revision) as JobRow | undefined;
  if (!job || job.status !== "running" || job.lease_owner !== owner) throw new LeaseLostError();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
  if (!task || task.revision !== revision) throw new LeaseLostError();
  return { job, task };
}

export { addEvent };
