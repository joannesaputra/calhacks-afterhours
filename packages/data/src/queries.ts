import type {
  Artifact, EmailEnvelope, IntegrationStatus, SourceDocument, TaskDetail, TaskEvent,
  TaskStatus, TaskSummary, WorkAnswer, WorkPlan, WorkProduct, WorkQuestion,
} from "@afterhours/contracts";
import type { AppConfig } from "./config";
import { modelStatus, oauthRedirectProblem, whatsappConfigured } from "./config";
import type { Db } from "./db";
import { badRequest, notFound } from "./errors";
import { decodeCursor, encodeCursor, rowToNotification, whatsappPolicyProblem } from "./notifications";
import { getSettings } from "./settings";
import type { TaskRow } from "./tasks";
import { iso, parseJson } from "./util";

export const WORKER_STALE_SECONDS = 45;

function summaryOf(db: Db, r: TaskRow): TaskSummary {
  const art = db.prepare("SELECT COUNT(*) n FROM artifacts WHERE task_id=? AND revision=?").get(r.id, r.revision) as { n: number };
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    revision: r.revision,
    ingestionMode: r.ingestion_mode,
    generationMode: r.generation_mode,
    senderName: r.sender_name,
    senderEmail: r.sender_email,
    subject: r.subject,
    requestedOutputs: parseJson(r.requested_outputs_json, []),
    dueAt: r.due_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    warningCount: r.warning_count,
    artifactCount: art.n,
    error: parseJson(r.error_json, null),
  };
}

export function getTaskSummary(db: Db, id: string): TaskSummary {
  const r = db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as TaskRow | undefined;
  if (!r) throw notFound("Task");
  return summaryOf(db, r);
}

export function listTasks(
  db: Db, opts: { status?: TaskStatus; cursor?: string; limit?: number },
): { items: TaskSummary[]; nextCursor: string | null } {
  const limit = Math.min(opts.limit ?? 30, 100);
  const c = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (opts.cursor && !c) throw badRequest("Invalid cursor.");
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.status) { where.push("status = ?"); args.push(opts.status); }
  if (c) { where.push("(created_at < ? OR (created_at = ? AND id < ?))"); args.push(c.c, c.c, c.i); }
  const sql = `SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...args, limit + 1) as TaskRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => summaryOf(db, r)),
    nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export function getTaskDetail(db: Db, id: string): TaskDetail {
  const r = db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as TaskRow | undefined;
  if (!r) throw notFound("Task");
  const intake = db.prepare("SELECT envelope_json FROM intake_messages WHERE id=?").get(r.intake_id) as { envelope_json: string };

  const srcRev = db.prepare("SELECT MAX(revision) rev FROM task_sources WHERE task_id=?").get(id) as { rev: number | null };
  const sources = srcRev.rev == null ? [] : (db
    .prepare("SELECT source_json FROM task_sources WHERE task_id=? AND revision=? ORDER BY ordinal")
    .all(id, srcRev.rev) as { source_json: string }[]).map((s) => JSON.parse(s.source_json) as SourceDocument);

  const artifacts = (db
    .prepare("SELECT * FROM artifacts WHERE task_id=? AND revision=? ORDER BY format DESC, id")
    .all(id, r.revision) as ArtifactRow[]).map(rowToArtifact);

  const events = (db
    .prepare("SELECT * FROM task_events WHERE task_id=? ORDER BY seq")
    .all(id) as EventRow[]).map((e): TaskEvent => ({
      id: e.id, taskId: e.task_id, revision: e.revision, type: e.type, stage: e.stage, message: e.message, createdAt: e.created_at,
    }));

  const notifications = (db
    .prepare(
      `SELECT * FROM notifications n WHERE n.task_id = ?
         OR EXISTS (SELECT 1 FROM json_each(n.task_ids_json) WHERE value = ?) ORDER BY created_at, id`)
    .all(id, id) as Parameters<typeof rowToNotification>[0][]).map(rowToNotification);

  return {
    task: summaryOf(db, r),
    email: JSON.parse(intake.envelope_json) as EmailEnvelope,
    plan: parseJson<WorkPlan | null>(r.plan_json, null),
    sources,
    products: parseJson<WorkProduct[]>(r.products_json, []),
    artifacts,
    questions: parseJson<WorkQuestion[]>(r.questions_json, []),
    answers: parseJson<WorkAnswer[]>(r.answers_json, []),
    events,
    notifications,
  };
}

interface ArtifactRow {
  id: string; task_id: string; revision: number; product_id: string; format: "docx" | "pptx";
  rel_path: string; filename: string; mime_type: string; size_bytes: number; sha256: string; created_at: string;
}
interface EventRow {
  id: string; task_id: string; revision: number; type: TaskEvent["type"]; stage: TaskEvent["stage"]; message: string; created_at: string;
}

const rowToArtifact = (a: ArtifactRow): Artifact => ({
  id: a.id, taskId: a.task_id, revision: a.revision, productId: a.product_id, format: a.format,
  filename: a.filename, mimeType: a.mime_type, sizeBytes: a.size_bytes, sha256: a.sha256,
  downloadPath: `/api/artifacts/${a.id}/download`, createdAt: a.created_at,
});

export function getArtifactForDownload(db: Db, id: string): (ArtifactRow & { relPath: string }) | null {
  const a = db.prepare("SELECT * FROM artifacts WHERE id=?").get(id) as ArtifactRow | undefined;
  return a ? { ...a, relPath: a.rel_path } : null;
}

export function getIntegrationStatus(db: Db, config: AppConfig, now: Date): IntegrationStatus {
  const g = db.prepare("SELECT * FROM integrations WHERE provider='gmail'").get() as
    | { state: "disconnected" | "connected" | "error"; account: string | null; connected_at: string | null; last_poll_at: string | null; last_error: string | null }
    | undefined;
  const w = db.prepare("SELECT MAX(heartbeat_at) hb FROM worker_status").get() as { hb: string | null };
  const settingsRow = db.prepare("SELECT settings_json FROM workspace_settings WHERE id=1").get() as { settings_json: string } | undefined;
  const channel = (settingsRow ? JSON.parse(settingsRow.settings_json).notifications.channel : config.notificationChannel) as "outbox" | "whatsapp";
  const err = db.prepare(
    "SELECT last_error FROM notifications WHERE channel=? AND state IN ('blocked','failed') ORDER BY updated_at DESC LIMIT 1",
  ).get(channel) as { last_error: string | null } | undefined;
  const healthy = !!w.hb && now.getTime() - new Date(w.hb).getTime() <= WORKER_STALE_SECONDS * 1000;
  const gmailState = g?.state ?? "disconnected";
  // While disconnected, explain what stops the operator from connecting (no secrets in the text).
  const setupProblem = !config.google.clientId || !config.google.clientSecret
    ? "Google OAuth is not configured on the server (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)."
    : oauthRedirectProblem(config);
  const policy = channel === "whatsapp" && settingsRow ? whatsappPolicyProblem(config, getSettings(db), now) : null;
  return {
    gmail: {
      state: gmailState,
      email: g?.account ?? null,
      connectedAt: g?.connected_at ?? null,
      lastPollAt: g?.last_poll_at ?? null,
      lastError: g?.last_error ?? (gmailState === "disconnected" ? setupProblem : null),
    },
    model: modelStatus(config),
    notifications: {
      channel,
      configured: channel === "outbox" ? true : whatsappConfigured(config),
      eligible: channel === "whatsapp" && config.whatsapp.useCaseEligible,
      lastError: policy ?? err?.last_error ?? null,
    },
    worker: { lastHeartbeatAt: w.hb, healthy },
  };
}

export const nowIso = (d: Date) => iso(d);
