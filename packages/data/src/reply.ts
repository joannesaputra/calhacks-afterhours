import { readFileSync } from "node:fs";
import type { ReplySendBody, ReplyView } from "@afterhours/contracts";
import { resolveArtifactPath, sha256Bytes } from "./artifacts";
import type { AppConfig } from "./config";
import type { Db } from "./db";
import { DomainError, notFound, staleRevision } from "./errors";
import { getGmailRow, getGmailTokens, isCurrentGmailConnection, updateGmailTokens, type GmailTokens } from "./integrations";
import { GMAIL_SEND_SCOPE, hasSendScope, type GmailApi } from "./gmail/api";
import { headerValue } from "./gmail/mime";
import { describeGmailError } from "./gmail/poll";
import { buildReplyMime, isPlainAddress, replySubject } from "./gmail/replyMime";
import { addEvent, getTaskRow, type TaskRow } from "./tasks";
import { iso, newId, parseJson } from "./util";

/** An attempt still "sending" after this long never finished: the outcome is unknown. */
export const SEND_STALE_MS = 2 * 60_000;
/** Gmail rejects messages above 25 MB once encoded; stay well under it. */
export const MAX_REPLY_BYTES = 18 * 1024 * 1024;

interface SendRow {
  id: string; task_id: string; revision: number; status: "sending" | "sent" | "failed"; to_email: string; subject: string;
  error: string | null; created_at: string; updated_at: string; sent_at: string | null; artifact_ids_json: string;
}
interface ArtifactRowLite { id: string; filename: string; mime_type: string; size_bytes: number; sha256: string; rel_path: string; format: string }

function artifactsOf(db: Db, task: TaskRow): ArtifactRowLite[] {
  return db.prepare("SELECT id, filename, mime_type, size_bytes, sha256, rel_path, format FROM artifacts WHERE task_id=? AND revision=? ORDER BY format, filename")
    .all(task.id, task.revision) as ArtifactRowLite[];
}

function lastSend(db: Db, taskId: string, revision: number): SendRow | null {
  return (db.prepare("SELECT * FROM reply_sends WHERE task_id=? AND revision=? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(taskId, revision) as SendRow | undefined) ?? null;
}

const firstName = (name: string | null): string => (name ?? "").trim().split(/\s+/)[0] ?? "";

function defaultBody(task: TaskRow, files: ArtifactRowLite[]): string {
  const hi = firstName(task.sender_name);
  const list = files.map((f) => `- ${f.filename}`).join("\n");
  return `Hi${hi ? ` ${hi}` : ""},\n\nHere ${files.length === 1 ? "is the file" : "are the files"} you asked for. ${files.length === 1 ? "It is a draft" : "They are drafts"} for your review, so tell me what to change.\n\n${list}\n\nThanks`;
}

/** What the reply panel shows: who it would go to, what would be attached, and, when it cannot be sent, why. */
export function getReplyView(db: Db, config: AppConfig, taskId: string, now: Date): ReplyView {
  const task = getTaskRow(db, taskId);
  const files = artifactsOf(db, task);
  const row = getGmailRow(db);
  let scope: string | null = null;
  if (row?.credentials_enc) { try { scope = getGmailTokens(db, config.tokenEncryptionKey)?.scope ?? null; } catch { /* unreadable: treated as no permission */ } }
  const connected = !!row && row.state !== "disconnected" && !!row.credentials_enc;
  const sendOk = connected && hasSendScope(scope);
  const last = lastSend(db, task.id, task.revision);
  const uncertain = !!last && last.status === "sending" && now.getTime() - Date.parse(last.updated_at) > SEND_STALE_MS;

  let reason: string | null = null;
  let needsSendPermission = false;
  if (task.status !== "approved") {
    reason = task.status === "ready" ? "Mark this task reviewed first. Sending is only offered after review." : "Only a reviewed task can be sent back.";
  } else if (task.ingestion_mode !== "gmail") {
    reason = "This task came from a demo message, not a real email, so there is nobody to reply to.";
  } else if (!isPlainAddress(task.sender_email)) {
    reason = "The original sender's address could not be read, so a reply cannot be addressed.";
  } else if (files.length === 0) {
    reason = "This revision has no files to send.";
  } else if (!connected) {
    reason = "Gmail is not connected.";
  } else if (!sendOk) {
    needsSendPermission = true;
    reason = "Gmail is connected read-only. Allow sending replies in Settings; Google asks for a separate permission to send.";
  } else if (last?.status === "sent") {
    reason = `Already sent to ${last.to_email}. Edit the task to make a new revision if you need to send again.`;
  } else if (last?.status === "sending" && !uncertain) {
    reason = "A send is already in progress.";
  }
  return {
    taskId: task.id,
    revision: task.revision,
    available: reason === null,
    reason,
    needsSendPermission,
    from: row?.account ?? null,
    to: task.sender_email,
    subject: replySubject(task.subject),
    defaultBody: defaultBody(task, files),
    attachments: files.map((f) => ({ id: f.id, filename: f.filename, sizeBytes: f.size_bytes })),
    last: last
      ? { id: last.id, status: last.status, to: last.to_email, at: last.sent_at ?? last.updated_at, error: last.error, uncertain }
      : null,
  };
}

export interface ReplyDeps {
  db: Db;
  config: AppConfig;
  now: () => Date;
  makeApi: (tokens: GmailTokens, onTokens: (t: GmailTokens) => void) => GmailApi;
}

const conflict = (code: string, message: string) => new DomainError(code, message, 409);

/**
 * Send the reviewed files to the original sender, once. The recipient is read from the stored task, never from the
 * request. Every precondition is re-checked here (the panel's state is not trusted), the attempt is recorded before
 * anything leaves the machine, and a partial unique index makes a second concurrent attempt impossible.
 */
export async function sendReply(deps: ReplyDeps, taskId: string, body: ReplySendBody): Promise<ReplyView> {
  const { db, config } = deps;
  const task = getTaskRow(db, taskId);
  if (task.revision !== body.revision) throw staleRevision(task.revision);
  const view = getReplyView(db, config, taskId, deps.now());
  const resendConfirmed = body.confirmResend === true && view.last?.uncertain === true;
  if (!view.available && !resendConfirmed) {
    const code = view.needsSendPermission ? "SEND_PERMISSION_MISSING" : view.last?.status === "sent" ? "ALREADY_SENT" : "REPLY_NOT_AVAILABLE";
    throw conflict(code, view.reason ?? "This reply cannot be sent.");
  }
  if (view.last?.uncertain && !resendConfirmed) {
    throw conflict("SEND_OUTCOME_UNKNOWN", "An earlier attempt never finished, so it may have been sent. Check your Sent folder, then confirm if you still want to send.");
  }

  const files = artifactsOf(db, task);
  const chosen = [...new Set(body.artifactIds)].map((id) => files.find((f) => f.id === id));
  if (chosen.some((f) => !f)) throw new DomainError("VALIDATION_ERROR", "One of the selected files does not belong to this revision.", 400);
  const picked = chosen as ArtifactRowLite[];
  const total = picked.reduce((n, f) => n + f.size_bytes, 0);
  if (total > MAX_REPLY_BYTES) throw new DomainError("REPLY_TOO_LARGE", "The selected files are too large to email together. Deselect one and send it separately.", 413);

  const root = config.artifactsDir;
  const attachments = picked.map((f) => {
    const full = resolveArtifactPath(root, f.rel_path);
    if (!full) throw new DomainError("ARTIFACT_MISSING", `${f.filename} is missing from storage, so nothing was sent.`, 409);
    const bytes = readFileSync(full);
    if (bytes.byteLength !== f.size_bytes || sha256Bytes(bytes) !== f.sha256) {
      throw new DomainError("ARTIFACT_MISMATCH", `${f.filename} does not match its recorded checksum, so nothing was sent.`, 409);
    }
    return { filename: f.filename, mimeType: f.mime_type, bytes };
  });

  const gmail = getGmailRow(db);
  if (!gmail?.connection_token || !gmail.account) throw conflict("GMAIL_NOT_CONNECTED", "Gmail is not connected.");
  const conn = gmail.connection_token;
  const tokens = getGmailTokens(db, config.tokenEncryptionKey);
  if (!tokens || !hasSendScope(tokens.scope)) throw conflict("SEND_PERMISSION_MISSING", "Gmail is connected read-only. Allow sending replies in Settings.");

  const attemptId = newId();
  const t0 = iso(deps.now());
  const interrupted = view.last?.uncertain ? view.last.id : null;
  try {
    db.transaction(() => {
      if (interrupted) {
        db.prepare("UPDATE reply_sends SET status='failed', error=?, updated_at=? WHERE id=?")
          .run("Interrupted before it finished; the outcome was unknown and the user chose to send again.", t0, interrupted);
      }
      db.prepare(
        `INSERT INTO reply_sends (id, task_id, revision, status, to_email, from_account, subject, artifact_ids_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(attemptId, task.id, task.revision, "sending", task.sender_email, gmail.account, view.subject, JSON.stringify(picked.map((f) => f.id)), t0, t0);
    }).immediate();
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) throw conflict("SEND_IN_PROGRESS", "This reply was just sent or is being sent. Refresh to see its status.");
    throw e;
  }

  const fail = (message: string, status = 502): never => {
    db.prepare("UPDATE reply_sends SET status='failed', error=?, updated_at=? WHERE id=?").run(message.slice(0, 300), iso(deps.now()), attemptId);
    throw new DomainError("SEND_FAILED", message, status);
  };

  let sent: { id: string; threadId: string | null };
  try {
    const api = deps.makeApi(tokens, (t) => { updateGmailTokens(db, config.tokenEncryptionKey, t, deps.now(), conn); });
    if (!api.sendMessage) return fail("This Gmail connection cannot send mail.", 409);
    if (!isCurrentGmailConnection(db, conn)) return fail("Gmail was disconnected before the reply was sent. Nothing was sent.", 409);

    // Thread the reply under the original message when Google lets us read its Message-ID; otherwise send a plain reply.
    const intake = db.prepare("SELECT envelope_json FROM intake_messages WHERE id=?").get(task.intake_id) as { envelope_json: string } | undefined;
    const env = parseJson<{ providerMessageId?: string; providerThreadId?: string | null }>(intake?.envelope_json ?? "{}", {});
    let inReplyTo: string | null = null;
    let references: string | null = null;
    if (env.providerMessageId) {
      try {
        const original = await api.getMessage(env.providerMessageId);
        inReplyTo = headerValue(original.payload, "message-id") ?? null;
        const refs = headerValue(original.payload, "references");
        references = inReplyTo ? [refs, inReplyTo].filter(Boolean).join(" ") : null;
      } catch { /* threading is best effort */ }
    }
    const raw = buildReplyMime({
      from: gmail.account, to: task.sender_email, subject: view.subject, text: body.body, inReplyTo, references, attachments,
    });
    sent = await api.sendMessage(raw, env.providerThreadId ?? null);
  } catch (e) {
    if (e instanceof DomainError) throw e;
    // An HTTP answer from Google means the message was not accepted. No answer (timeout, dropped connection) means it
    // may have gone out, so the attempt stays "sending" and shows as uncertain instead of inviting a duplicate.
    if (answeredByGoogle(e)) return fail(describeSendError(e));
    db.prepare("UPDATE reply_sends SET error=?, updated_at=? WHERE id=?").run("No answer from Gmail; the message may have been sent.", iso(deps.now()), attemptId);
    throw new DomainError("SEND_OUTCOME_UNKNOWN", "Gmail did not answer, so the reply may or may not have been sent. Check your Sent folder before trying again.", 504);
  }

  const done = iso(deps.now());
  db.transaction(() => {
    db.prepare("UPDATE reply_sends SET status='sent', provider_message_id=?, provider_thread_id=?, error=NULL, updated_at=?, sent_at=? WHERE id=?")
      .run(sent.id, sent.threadId, done, done, attemptId);
    addEvent(db, task.id, task.revision, "review", "review", `Reply sent to ${task.sender_email} with ${picked.length} file${picked.length === 1 ? "" : "s"}.`, deps.now());
  }).immediate();
  return getReplyView(db, config, taskId, deps.now());
}

function answeredByGoogle(e: unknown): boolean {
  const o = e as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  const n = Number(o?.response?.status ?? o?.status ?? o?.code);
  return Number.isInteger(n) && n >= 400 && n < 600;
}

/** A user-safe sentence for a failed send. Never includes tokens, headers or the message. */
function describeSendError(e: unknown): string {
  const msg = describeGmailError(e);
  if (/Reconnect Gmail/.test(msg)) return "Gmail rejected the saved permission. Reconnect Gmail and allow sending replies, then try again. Nothing was sent.";
  if (/quota|rate/i.test(msg)) return "Gmail's sending limit was reached. Nothing was sent; try again later.";
  const raw = e instanceof Error ? e.message : "";
  if (/insufficient|scope|forbidden|403/i.test(raw)) return `Gmail refused to send: the connection does not include permission to send mail (${GMAIL_SEND_SCOPE.split("/").pop()}). Allow sending replies in Settings.`;
  return "Gmail could not send the reply, and it was not recorded as sent. You can try again.";
}

export function replyHistory(db: Db, taskId: string): SendRow[] {
  if (!db.prepare("SELECT 1 FROM tasks WHERE id=?").get(taskId)) throw notFound("Task");
  return db.prepare("SELECT * FROM reply_sends WHERE task_id=? ORDER BY created_at DESC").all(taskId) as SendRow[];
}
