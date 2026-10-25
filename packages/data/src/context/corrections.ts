import type { ContextCorrectionBody, TaskSummary } from "@afterhours/contracts";
import type { Db } from "../db";
import { badRequest, invalidTransition, staleRevision } from "../errors";
import { getTaskSummary } from "../queries";
import { addEvent, getTaskRow, setStatus } from "../tasks";
import { iso, newId } from "../util";
import { auditContext } from "./audit";
import { getVersion } from "./files";
import { addOverride, latestRun, requirementsOf } from "./run";
import { OWNER_ID } from "./types";

const CORRECTABLE = new Set(["needs_input", "ready", "failed"]);

/**
 * Apply a user's correction (use a different file, remove a source, supply missing feedback) as a new task revision and
 * job. The new revision reuses the earlier retrieval run wherever its messages and files are still valid.
 */
export function applyContextCorrection(db: Db, taskId: string, body: ContextCorrectionBody, now: Date, ownerId: string = OWNER_ID): TaskSummary {
  db.transaction(() => {
    const task = getTaskRow(db, taskId);
    if (task.revision !== body.revision) throw staleRevision(task.revision);
    if (!CORRECTABLE.has(task.status)) throw invalidTransition(task.status, "queued");
    const run = latestRun(db, taskId);
    if (!run || run.owner_id !== ownerId) throw badRequest("This task has no retrieved context to correct.");
    const inRun = (type: "email" | "file_version", id: string) => !!db.prepare("SELECT 1 FROM retrieval_sources WHERE run_id=? AND source_type=? AND source_id=?").get(run.id, type, id);
    const next = task.revision + 1;
    let label: string;
    if (body.action === "select_file") {
      if (!inRun("file_version", body.fileVersionId)) throw badRequest("That file was not one of the candidates found for this request.");
      const v = getVersion(db, ownerId, body.fileVersionId);
      if (!v) throw badRequest("That file is no longer available.");
      addOverride(db, taskId, next, "select_file", { fileVersionId: body.fileVersionId }, now);
      label = `Use ${v.file.name}`;
    } else if (body.action === "exclude_source") {
      const known = body.sourceType === "email"
        ? inRun("email", body.sourceId)
        : (db.prepare("SELECT source_id FROM retrieval_sources WHERE run_id=? AND source_type='file_version'").all(run.id) as Array<{ source_id: string }>).some((r) => getVersion(db, ownerId, r.source_id)?.file_id === body.sourceId);
      if (!known) throw badRequest("That source was not used for this request.");
      addOverride(db, taskId, next, "exclude_source", { sourceType: body.sourceType, sourceId: body.sourceId }, now);
      label = `Remove a ${body.sourceType === "email" ? "message" : "file"}`;
    } else if (body.action === "drop_requirement") {
      if (!requirementsOf(run).some((r) => r.id === body.requirementId)) throw badRequest("That requested change was not found.");
      addOverride(db, taskId, next, "drop_requirement", { requirementId: body.requirementId }, now);
      label = "Drop a requested change";
    } else {
      addOverride(db, taskId, next, "add_feedback", { text: body.text }, now);
      label = "Add your feedback";
    }
    const t = iso(now);
    db.prepare("UPDATE tasks SET revision=?, questions_json='[]', error_json=NULL, updated_at=? WHERE id=?").run(next, t, taskId);
    setStatus(db, task, "queued", now, { correction: true });
    db.prepare(`INSERT INTO jobs (id, task_id, revision, status, attempts, available_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(newId(), taskId, next, "queued", 0, t, t, t);
    addEvent(db, taskId, next, "status", "intake", `Context corrected (${label}); queued for another pass.`, now);
    auditContext(db, ownerId, "context.corrected", { type: "task", id: taskId }, { action: body.action, revision: next }, now);
  }).immediate();
  return getTaskSummary(db, taskId);
}
