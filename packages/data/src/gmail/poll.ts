import type { EmailEnvelope } from "@afterhours/contracts";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import { auditIntake, ingestMessage, LIMITS, type IngestAttachment } from "../ingest";
import {
  getGmailCheckpoint, getGmailRow, getGmailTokens, isCurrentGmailConnection, recordGmailPoll, updateGmailTokens,
  type GmailCheckpoint, type GmailTokens,
} from "../integrations";
import { getSettings, normalizeEmail } from "../settings";
import type { GmailApi, GmailMessage } from "./api";
import { headerValue, parseAddress, parseAddressList, parseGmailPayload } from "./mime";

/** Listing overlap behind the checkpoint, for clock and poll races. Dedupe makes it idempotent. */
export const POLL_OVERLAP_SECONDS = 120;
/**
 * Messages whose Gmail internalDate is earlier than connectedAt minus this skew are history and are
 * never ingested, even though the listing overlap may return them.
 */
export const CONNECT_SKEW_SECONDS = 30;
export const PAGE_SIZE = 50;
export const MAX_PAGES = 5;
export const MAX_MESSAGES_PER_CYCLE = 10;
const HANDLED_KEEP = 300;
/** Below this window width the listing is processed even if truncated (dedupe covers repeats). */
const MIN_WINDOW_MS = 2_000;

export interface PollDeps {
  db: Db;
  config: AppConfig;
  now: () => Date;
  /** Build a Gmail client from stored credentials; must call onTokens when tokens refresh. */
  makeApi: (tokens: GmailTokens, onTokens: (t: GmailTokens) => void) => GmailApi;
}

export interface PollResult {
  status: "disconnected" | "disabled" | "paused" | "ok" | "error" | "superseded";
  ingested: number;
  ignored: number;
  /** The open window did not fit in the page cap; it was narrowed and nothing was processed. */
  narrowed?: boolean;
  error?: string;
}

const AUTH_RE = /invalid_grant|invalid_client|unauthorized|\b401\b|\b403\b|insufficient|token has been (expired|revoked)/i;

/** HTTP status of a Google client error (gaxios sets `status`; older shapes only `response.status`). */
function httpStatus(e: unknown): number | null {
  const err = e as { status?: unknown; response?: { status?: unknown } } | null;
  const status = Number(err?.status ?? err?.response?.status);
  return Number.isInteger(status) ? status : null;
}

export function isGmailAuthError(e: unknown): boolean {
  // Google's 401 text ("Invalid Credentials", "invalid authentication credentials") matches none of the words
  // below, so the status decides. A 403 stays text-based: rate limits and a disabled API also return 403.
  if (httpStatus(e) === 401) return true;
  return AUTH_RE.test(e instanceof Error ? e.message : String(e));
}

export function describeGmailError(e: unknown): string {
  if (isGmailAuthError(e)) {
    return "Gmail rejected the saved credentials (revoked, expired test token, or missing consent). Reconnect Gmail in Settings.";
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/has not been used in project|accessNotConfigured/i.test(msg)) {
    return "The Gmail API is not enabled in the Google Cloud project. The operator must enable it; polling will retry.";
  }
  if (/429|quota|rate/i.test(msg)) return "Gmail quota or rate limit reached. Polling will retry automatically.";
  return "Gmail polling failed. It will retry automatically.";
}

const toSec = (ms: number) => Math.max(0, Math.floor(ms / 1000));

/**
 * One bounded poll cycle. Safe to call repeatedly; dedupes by checkpoint overlap + DB uniqueness.
 *
 * Listing is newest-first and capped at MAX_PAGES x PAGE_SIZE ids. If the window [floor, end) does not
 * fit, the end is halved and persisted, and nothing is processed this cycle, so the checkpoint never moves
 * past messages that were not listed. Once a window fits, up to MAX_MESSAGES_PER_CYCLE of its oldest
 * unhandled messages are processed in internalDate order and the checkpoint advances only to the newest
 * processed one. A window that is fully handled is reopened.
 */
export async function pollGmailOnce(deps: PollDeps): Promise<PollResult> {
  const { db, config } = deps;
  const row = getGmailRow(db);
  if (!row || row.state === "disconnected" || !row.credentials_enc || !row.connection_token) {
    return { status: "disconnected", ingested: 0, ignored: 0 };
  }
  if (row.auth_failed_at) return { status: "paused", ingested: 0, ignored: 0 };
  if (!getSettings(db).automationEnabled) return { status: "disabled", ingested: 0, ignored: 0 };
  const conn = row.connection_token;

  let ingested = 0;
  let ignored = 0;
  try {
    const tokens = getGmailTokens(db, config.tokenEncryptionKey);
    if (!tokens) return { status: "disconnected", ingested, ignored };
    const api = deps.makeApi(tokens, (t) => { updateGmailTokens(db, config.tokenEncryptionKey, t, deps.now(), conn); });
    const cp = getGmailCheckpoint(db);
    const connectedMs = row.connected_at ? Date.parse(row.connected_at) : cp.afterMs;
    const historyCutoffMs = connectedMs - CONNECT_SKEW_SECONDS * 1000;
    const floorMs = Math.max(cp.afterMs, connectedMs) - POLL_OVERLAP_SECONDS * 1000;
    const endMs = cp.windowEndMs ?? null;
    const query = `in:inbox after:${toSec(floorMs)}${endMs ? ` before:${toSec(endMs) + 1}` : ""}`;

    const ids: string[] = [];
    let token: string | undefined;
    let truncated = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await api.listInbox(query, token, PAGE_SIZE);
      ids.push(...r.ids);
      if (!r.nextPageToken) break;
      token = r.nextPageToken;
      if (page === MAX_PAGES - 1) truncated = true;
    }

    const windowTop = endMs ?? deps.now().getTime();
    // Never narrow into the already-handled range, or a fitted window could drain without progress.
    const candidateEnd = Math.max(floorMs + Math.floor((windowTop - floorMs) / 2), cp.afterMs + MIN_WINDOW_MS);
    if (truncated && candidateEnd < windowTop) {
      const narrowed: GmailCheckpoint = { ...cp, windowEndMs: candidateEnd };
      if (!recordGmailPoll(db, deps.now(), conn, { checkpoint: narrowed })) return { status: "superseded", ingested, ignored };
      return { status: "ok", ingested, ignored, narrowed: true };
    }

    const handled = new Set(cp.handled);
    // List is newest-first; take the oldest unhandled so the checkpoint can only move forward safely.
    const unhandled = ids.filter((id) => !handled.has(id)).reverse();
    const todo = unhandled.slice(0, MAX_MESSAGES_PER_CYCLE);
    const fetched: GmailMessage[] = [];
    for (const id of todo) fetched.push(await api.getMessage(id));
    fetched.sort((a, b) => Number(a.internalDate) - Number(b.internalDate));

    const settings = getSettings(db);
    const allowed = new Set(settings.allowedSenders.map(normalizeEmail));
    let afterMs = cp.afterMs;
    const newHandled = [...cp.handled];

    for (const msg of fetched) {
      // Stop as soon as the connection is disconnected or replaced: no ingestion for a dead connection.
      if (!isCurrentGmailConnection(db, conn)) return { status: "superseded", ingested, ignored };
      const internalMs = Number(msg.internalDate);
      if (!Number.isFinite(internalMs) || internalMs < historyCutoffMs) {
        newHandled.push(msg.id);
        continue;
      }
      const outcome = await ingestFromGmail(deps, api, row.id, msg, allowed);
      if (outcome === "task") ingested++;
      else ignored++;
      newHandled.push(msg.id);
      afterMs = Math.max(afterMs, internalMs);
    }

    // A listing that is still truncated (cannot be narrowed further) may hide older messages: ingest what
    // was listed (dedupe covers repeats) but do not move the checkpoint past anything unlisted.
    // A fully listed window that is drained is reopened from its end.
    const drained = unhandled.length <= MAX_MESSAGES_PER_CYCLE;
    const checkpoint: GmailCheckpoint = {
      afterMs: truncated ? cp.afterMs : afterMs,
      handled: newHandled.slice(-HANDLED_KEEP),
      windowEndMs: endMs && !drained ? endMs : null,
    };
    if (endMs && drained && !truncated) checkpoint.afterMs = Math.max(afterMs, Math.min(endMs, deps.now().getTime()));
    if (!recordGmailPoll(db, deps.now(), conn, { checkpoint })) return { status: "superseded", ingested, ignored };
    return { status: "ok", ingested, ignored };
  } catch (e) {
    const message = describeGmailError(e);
    const authFailed = isGmailAuthError(e);
    recordGmailPoll(db, deps.now(), conn, { error: message, authFailed });
    return { status: "error", ingested, ignored, error: message };
  }
}

/** DMARC result Gmail recorded for the message, if any. Only an explicit failure is acted on. */
function dmarcFailed(msg: GmailMessage): boolean {
  const ar = headerValue(msg.payload, "authentication-results") ?? "";
  return /\bdmarc=fail\b/i.test(ar);
}

async function ingestFromGmail(
  deps: PollDeps, api: GmailApi, integrationId: string, msg: GmailMessage, allowed: Set<string>,
): Promise<"task" | "ignored"> {
  const { db, config } = deps;
  const safeRef = `gmail:${msg.id.slice(-24)}`;
  let parsed: ReturnType<typeof parseGmailPayload>;
  let from: ReturnType<typeof parseAddress>;
  try {
    parsed = parseGmailPayload(msg.payload);
    from = parseAddress(headerValue(msg.payload, "from"));
  } catch {
    // A malformed message must not block the inbox: record it and move on.
    auditIntake(db, "malformed_message", safeRef, deps.now());
    return "ignored";
  }
  const sender = from ? normalizeEmail(from.email) : "";

  // Unknown senders and spoofed (DMARC-failed) mail: no attachment download, no task, no model call.
  if (sender && allowed.has(sender) && dmarcFailed(msg)) {
    auditIntake(db, "sender_authentication_failed", safeRef, deps.now());
    return "ignored";
  }
  const senderAllowed = !!sender && allowed.has(sender);
  const attachments: IngestAttachment[] = [];
  let total = 0;
  if (senderAllowed) {
    for (const a of parsed.attachments.slice(0, LIMITS.maxFiles)) {
      if (a.sizeBytes > LIMITS.maxFileBytes || total + a.sizeBytes > LIMITS.maxTotalBytes) continue;
      const bytes = a.inlineData ?? (a.attachmentId ? await api.getAttachment(msg.id, a.attachmentId) : null);
      if (!bytes) continue;
      if (bytes.byteLength > LIMITS.maxFileBytes) continue;
      total += bytes.byteLength;
      attachments.push({ id: a.id, filename: a.filename, mimeType: a.mimeType, bytes: new Uint8Array(bytes) });
    }
  }

  try {
    const envelope: EmailEnvelope = {
      providerMessageId: msg.id,
      providerThreadId: msg.threadId,
      from: { name: from?.name ?? null, email: sender || "unknown@invalid" },
      to: parseAddressList(headerValue(msg.payload, "to")),
      subject: headerValue(msg.payload, "subject") ?? "(no subject)",
      // Gmail internalDate (server receipt time) is the email's receivedAt. Ingestion time is tasks.created_at.
      receivedAt: new Date(Number(msg.internalDate)).toISOString(),
      bodyText: parsed.text,
      // Full attachment list. Any part missing from task_attachments (too large / over the cap)
      // makes the worker fail the task with a clear message instead of a silent partial result.
      attachments: parsed.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
    };
    const out = ingestMessage(db, {
      sourceKey: `gmail:${integrationId}:${msg.id}`,
      mode: "gmail",
      integrationId,
      envelope,
      attachments,
      generationMode: config.generationMode,
      fixtureScenario: null,
    }, deps.now());
    return out.kind === "task" ? "task" : "ignored";
  } catch (e) {
    if (e instanceof Error && /SQLITE_BUSY|database is locked/i.test(e.message)) throw e;
    auditIntake(db, "malformed_message", safeRef, deps.now());
    return "ignored";
  }
}
