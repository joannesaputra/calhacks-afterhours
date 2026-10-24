import type {
  EngineProgress,
  SourceDocument,
  WorkPlan,
  WorkProduct,
  WorkQuestion,
} from "@afterhours/contracts";
import type { Db } from "./db";
import { badRequest } from "./errors";
import { createReadyNotification } from "./notifications";
import {
  LEASE_SECONDS, MAX_ATTEMPTS, RETRY_DELAY_SECONDS,
  LeaseLostError, addEvent, assertOwnedJob, setStatus, type JobRow, type TaskRow,
} from "./tasks";
import { addSeconds, iso, randomToken } from "./util";

export interface ClaimedJob {
  jobId: string;
  taskId: string;
  revision: number;
  ownerToken: string;
  attempts: number;
}

/** Atomically claim the next eligible job with a lease. Returns null when idle. */
export function claimNextJob(db: Db, workerId: string, now: Date): ClaimedJob | null {
  const tx = db.transaction((): ClaimedJob | null => {
    for (let guard = 0; guard < 20; guard++) {
      const job = db
        .prepare(
          "SELECT * FROM jobs WHERE status = 'queued' AND available_at <= ? ORDER BY available_at, created_at LIMIT 1",
        )
        .get(iso(now)) as JobRow | undefined;
      if (!job) return null;
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(job.task_id) as TaskRow;
      if (task.revision !== job.revision || task.status !== "queued") {
        db.prepare("UPDATE jobs SET status='failed', last_error=?, updated_at=? WHERE id=?").run(
          "superseded_or_invalid_task_state", iso(now), job.id,
        );
        continue;
      }
      const owner = `${workerId}:${randomToken(12)}`;
      const attempts = job.attempts + 1;
      db.prepare(
        `UPDATE jobs SET status='running', attempts=?, lease_owner=?, lease_until=?, heartbeat_at=?, updated_at=?
         WHERE id=? AND status='queued'`,
      ).run(attempts, owner, iso(addSeconds(now, LEASE_SECONDS)), iso(now), iso(now), job.id);
      setStatus(db, task, "planning", now);
      addEvent(db, task.id, task.revision, "status", "plan", `Started planning (attempt ${attempts} of ${MAX_ATTEMPTS}).`, now);
      return { jobId: job.id, taskId: task.id, revision: task.revision, ownerToken: owner, attempts };
    }
    return null;
  });
  return tx.immediate();
}

/** Cheap ownership probe: true while `ref.ownerToken` still holds the running job for this task revision. */
export function jobStillOwned(db: Db, ref: { taskId: string; revision: number; ownerToken: string }): boolean {
  try {
    assertOwnedJob(db, ref.taskId, ref.revision, ref.ownerToken);
    return true;
  } catch (e) {
    if (e instanceof LeaseLostError) return false;
    throw e;
  }
}

/** Extend the lease. Returns false when ownership was lost. */
export function heartbeatJob(db: Db, jobId: string, ownerToken: string, now: Date): boolean {
  const r = db
    .prepare(
      `UPDATE jobs SET lease_until=?, heartbeat_at=?, updated_at=?
       WHERE id=? AND lease_owner=? AND status='running'`,
    )
    .run(iso(addSeconds(now, LEASE_SECONDS)), iso(now), iso(now), jobId, ownerToken);
  return r.changes > 0;
}

function requeueOrFail(
  db: Db,
  job: JobRow,
  task: TaskRow,
  now: Date,
  reason: { code: string; message: string; retryable: boolean },
  opts: { delaySeconds: number },
): "requeued" | "failed" {
  const canRetry = reason.retryable && job.attempts < MAX_ATTEMPTS;
  if (canRetry) {
    db.prepare(
      `UPDATE jobs SET status='queued', available_at=?, lease_owner=NULL, lease_until=NULL,
         attempts=?, last_error=?, updated_at=? WHERE id=?`,
    ).run(
      iso(addSeconds(now, opts.delaySeconds)),
      job.attempts,
      reason.code, iso(now), job.id,
    );
    if (task.status === "planning" || task.status === "running") {
      setStatus(db, task, "queued", now, { recovery: true });
    }
    addEvent(db, task.id, task.revision, "warning", "plan",
      `${reason.message} Retrying automatically (attempt ${job.attempts + 1} of ${MAX_ATTEMPTS}).`, now);
    return "requeued";
  }
  db.prepare("UPDATE jobs SET status='failed', lease_owner=NULL, lease_until=NULL, last_error=?, updated_at=? WHERE id=?").run(
    reason.code, iso(now), job.id,
  );
  if (task.status === "planning" || task.status === "running") {
    setStatus(db, task, "failed", now);
    db.prepare("UPDATE tasks SET error_json=?, updated_at=? WHERE id=?").run(
      JSON.stringify({ code: reason.code, message: reason.message, retryable: reason.retryable }),
      iso(now), task.id,
    );
  }
  addEvent(db, task.id, task.revision, "error", "plan", reason.message, now);
  return "failed";
}

/** Recover jobs whose lease expired (crashed worker). Bounded by MAX_ATTEMPTS. */
export function recoverExpiredJobs(db: Db, now: Date): number {
  const expired = db
    .prepare("SELECT * FROM jobs WHERE status='running' AND lease_until <= ?")
    .all(iso(now)) as JobRow[];
  let n = 0;
  for (const j of expired) {
    db.transaction(() => {
      const cur = db.prepare("SELECT * FROM jobs WHERE id=? AND status='running' AND lease_until <= ?").get(j.id, iso(now)) as JobRow | undefined;
      if (!cur) return;
      const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(cur.task_id) as TaskRow;
      requeueOrFail(db, cur, task, now,
        { code: "LEASE_EXPIRED", message: "The worker stopped before finishing this task.", retryable: true },
        { delaySeconds: 0 });
      n++;
    }).immediate();
  }
  return n;
}

/** Safe shutdown: hand the job back without consuming an attempt. */
export function releaseJob(db: Db, taskId: string, revision: number, ownerToken: string, now: Date): boolean {
  return db.transaction(() => {
    let owned;
    try { owned = assertOwnedJob(db, taskId, revision, ownerToken); } catch { return false; }
    db.prepare("UPDATE jobs SET status='queued', lease_owner=NULL, lease_until=NULL, attempts=?, available_at=?, updated_at=? WHERE id=?").run(
      Math.max(0, owned.job.attempts - 1), iso(now), iso(now), owned.job.id,
    );
    setStatus(db, owned.task, "queued", now, { recovery: true });
    addEvent(db, taskId, revision, "warning", "plan", "Worker shut down; task returned to the queue.", now);
    return true;
  }).immediate();
}

/** Persist visible progress. Returns false (and writes nothing) if ownership was lost. */
export function appendProgress(
  db: Db,
  ref: { taskId: string; revision: number; ownerToken: string },
  progress: EngineProgress,
  now: Date,
): boolean {
  try {
    db.transaction(() => {
      const { task } = assertOwnedJob(db, ref.taskId, ref.revision, ref.ownerToken);
      if (progress.stage === "generate" || progress.stage === "verify" || progress.stage === "export") {
        if (task.status === "planning") {
          setStatus(db, task, "running", now);
          addEvent(db, task.id, task.revision, "status", progress.stage, "Generating deliverables.", now);
        }
      }
      if (progress.plan) {
        const p = progress.plan;
        db.prepare(
          "UPDATE tasks SET plan_json=?, requested_outputs_json=?, due_at=?, title=COALESCE(NULLIF(?, ''), title), updated_at=? WHERE id=?",
        ).run(JSON.stringify(p), JSON.stringify(p.requestedOutputs), p.dueAt, p.title.slice(0, 200), iso(now), task.id);
      }
      addEvent(db, task.id, task.revision, "progress", progress.stage, progress.message, now);
    }).immediate();
    return true;
  } catch (e) {
    if (e instanceof LeaseLostError) return false;
    throw e;
  }
}

export interface StoredFile {
  id: string;
  productId: string;
  format: "docx" | "pptx";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  relPath: string;
}

export type CommitInput = { taskId: string; revision: number; ownerToken: string; now: Date } & (
  | { outcome: "ready"; plan: WorkPlan; sources: SourceDocument[]; products: WorkProduct[]; warnings: string[]; files: StoredFile[] }
  | { outcome: "needs_input"; plan: WorkPlan; sources: SourceDocument[]; questions: WorkQuestion[]; warnings: string[] }
  | { outcome: "skipped"; reason: string; sources: SourceDocument[] }
);

/**
 * Atomically publish an engine result. Verifies lease owner and revision; a stale worker
 * throws LeaseLostError and writes nothing. For "ready", the manifest, status, events and the
 * notification intent commit together.
 */
export function commitEngineResult(db: Db, input: CommitInput): void {
  const { taskId, revision, ownerToken, now } = input;
  db.transaction(() => {
    const { job, task } = assertOwnedJob(db, taskId, revision, ownerToken);
    const t = iso(now);

    db.prepare("DELETE FROM task_sources WHERE task_id=? AND revision=?").run(taskId, revision);
    const insSrc = db.prepare(
      "INSERT INTO task_sources (task_id, revision, source_id, ordinal, source_json) VALUES (?,?,?,?,?)",
    );
    input.sources.forEach((s, i) => insSrc.run(taskId, revision, s.id, i, JSON.stringify(s)));

    if (input.outcome === "ready") {
      if (input.files.length === 0) throw badRequest("A ready result needs at least one file");
      if (task.status === "planning") setStatus(db, task, "running", now);
      setStatus(db, task, "ready", now);
      // Published manifests are immutable: a row for this task/revision/product/format is never replaced. The
      // lease and revision checks above already stop a stale attempt; this refuses a conflicting rewrite as well.
      const insArt = db.prepare(
        `INSERT INTO artifacts (id, task_id, revision, product_id, format, rel_path, filename, mime_type, size_bytes, sha256, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      );
      const existing = db.prepare("SELECT id, sha256 FROM artifacts WHERE task_id=? AND revision=? AND product_id=? AND format=?");
      for (const f of input.files) {
        const have = existing.get(taskId, revision, f.productId, f.format) as { id: string; sha256: string } | undefined;
        if (have) {
          if (have.sha256 !== f.sha256) throw badRequest("A published artifact for this revision cannot be replaced");
          continue;
        }
        insArt.run(f.id, taskId, revision, f.productId, f.format, f.relPath, f.filename, f.mimeType, f.sizeBytes, f.sha256, t);
      }
      const productWarnings = input.products.reduce((n, p) => n + p.warnings.length, 0);
      db.prepare(
        `UPDATE tasks SET plan_json=?, products_json=?, questions_json='[]', requested_outputs_json=?, due_at=?,
           warning_count=?, error_json=NULL, updated_at=? WHERE id=?`,
      ).run(
        JSON.stringify(input.plan), JSON.stringify(input.products), JSON.stringify(input.plan.requestedOutputs),
        input.plan.dueAt, input.warnings.length + productWarnings, t, taskId,
      );
      for (const w of input.warnings) addEvent(db, taskId, revision, "warning", "verify", w, now);
      addEvent(db, taskId, revision, "status", "export",
        `Ready for review: ${input.files.length} file${input.files.length === 1 ? "" : "s"} generated.`, now);
      createReadyNotification(db, taskId, revision, now);
    } else if (input.outcome === "needs_input") {
      setStatus(db, task, "needs_input", now);
      db.prepare(
        `UPDATE tasks SET plan_json=?, questions_json=?, requested_outputs_json=?, due_at=?, warning_count=?,
           error_json=NULL, updated_at=? WHERE id=?`,
      ).run(JSON.stringify(input.plan), JSON.stringify(input.questions), JSON.stringify(input.plan.requestedOutputs),
        input.plan.dueAt, input.warnings.length, t, taskId);
      for (const w of input.warnings) addEvent(db, taskId, revision, "warning", "plan", w, now);
      addEvent(db, taskId, revision, "status", "plan",
        `Needs your input: ${input.questions.length} question${input.questions.length === 1 ? "" : "s"}.`, now);
    } else {
      setStatus(db, task, "skipped", now);
      addEvent(db, taskId, revision, "status", "plan", `Skipped: ${input.reason}`, now);
    }
    db.prepare("UPDATE jobs SET status='done', lease_owner=NULL, lease_until=NULL, updated_at=? WHERE id=?").run(t, job.id);
  }).immediate();
}

export type FailureOutcome = { lost: true } | { lost: false; willRetry: boolean };

/** Record an execution failure: bounded transient retry or terminal task failure. */
export function recordExecutionFailure(
  db: Db,
  ref: { taskId: string; revision: number; ownerToken: string },
  error: { code: string; message: string; retryable: boolean },
  now: Date,
): FailureOutcome {
  try {
    return db.transaction((): FailureOutcome => {
      const { job, task } = assertOwnedJob(db, ref.taskId, ref.revision, ref.ownerToken);
      const r = requeueOrFail(db, job, task, now, error, { delaySeconds: RETRY_DELAY_SECONDS });
      return { lost: false, willRetry: r === "requeued" };
    }).immediate();
  } catch (e) {
    if (e instanceof LeaseLostError) return { lost: true };
    throw e;
  }
}

export function recordWorkerHeartbeat(db: Db, workerId: string, now: Date, lastError: string | null = null): void {
  db.prepare(
    `INSERT INTO worker_status (id, heartbeat_at, last_error) VALUES (?,?,?)
     ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at, last_error=excluded.last_error`,
  ).run(workerId, iso(now), lastError);
}
