import {
  EmailEnvelopeSchema,
  type EmailEnvelope,
  type FixtureScenario,
  type GenerationMode,
  type IngestionMode,
} from "@afterhours/contracts";
import type { Db } from "./db";
import { addEvent } from "./events";
import { getGmailRow } from "./integrations";
import { decideSender } from "./senderPolicy";
import { getSettings, normalizeEmail } from "./settings";
import { iso, newId } from "./util";

export const LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxFiles: 5,
  maxTextChars: 60_000,
  auditRetention: 500,
} as const;

export interface IngestAttachment {
  id: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface IngestInput {
  /** Globally unique source identity; used for dedupe. e.g. gmail:<integration>:<msgId>, demo:<id> */
  sourceKey: string;
  mode: IngestionMode;
  integrationId: string | null;
  envelope: EmailEnvelope;
  attachments: IngestAttachment[];
  generationMode: GenerationMode;
  fixtureScenario: FixtureScenario | null;
}

export type IngestOutcome =
  | { kind: "task"; taskId: string; deduplicated: boolean }
  | { kind: "ignored"; reason: string };

/** Demo fixtures are authorized by namespace: fictional `.example` addresses only. */
export const isDemoSender = (email: string): boolean => /@([^@]+\.)?example$/i.test(email.trim());

/** Bounded intake audit row: reason + short source ref only, never message content. */
export function auditIntake(db: Db, reason: string, sourceRef: string, now: Date): void {
  db.prepare("INSERT INTO intake_audit (reason, source_ref, created_at) VALUES (?,?,?)").run(
    reason.slice(0, 200),
    sourceRef.slice(0, 120),
    iso(now),
  );
  db.prepare(
    "DELETE FROM intake_audit WHERE id <= (SELECT COALESCE(MAX(id),0) - ? FROM intake_audit)",
  ).run(LIMITS.auditRetention);
}

/** Transactionally normalize, authorize, dedupe, and enqueue one message. No network. */
export function ingestMessage(db: Db, input: IngestInput, now: Date): IngestOutcome {
  const envelope = EmailEnvelopeSchema.parse(input.envelope);
  const run = db.transaction((): IngestOutcome => {
    const existing = db
      .prepare(
        "SELECT t.id FROM intake_messages m JOIN tasks t ON t.intake_id = m.id WHERE m.source_key = ?",
      )
      .get(input.sourceKey) as { id: string } | undefined;
    if (existing) return { kind: "task", taskId: existing.id, deduplicated: true };
    // A task the user deleted from this email stays deleted: only its message key is remembered.
    if (db.prepare("SELECT 1 FROM deleted_intake WHERE source_key = ?").get(input.sourceKey)) {
      return { kind: "ignored", reason: "previously_deleted" };
    }

    const settings = getSettings(db);
    const sender = normalizeEmail(envelope.from.email);
    const safeRef = `${input.mode}:${input.sourceKey.slice(-24)}`;

    if (input.mode === "gmail") {
      if (!settings.automationEnabled) {
        auditIntake(db, "automation_disabled", safeRef, now);
        return { kind: "ignored", reason: "automation_disabled" };
      }
      if (decideSender(settings, sender, getGmailRow(db)?.account) === "no") {
        auditIntake(db, "sender_not_allowed", safeRef, now);
        return { kind: "ignored", reason: "sender_not_allowed" };
      }
      if (!settings.autoPrepare) {
        auditIntake(db, "auto_prepare_disabled", safeRef, now);
        return { kind: "ignored", reason: "auto_prepare_disabled" };
      }
    } else if (!isDemoSender(sender)) {
      auditIntake(db, "demo_sender_not_fictional", safeRef, now);
      return { kind: "ignored", reason: "demo_sender_not_fictional" };
    }

    const intakeId = newId();
    const taskId = newId();
    const t = iso(now);
    const warnings: string[] = [];
    let body = envelope.bodyText;
    if (body.length > LIMITS.maxTextChars) {
      body = body.slice(0, LIMITS.maxTextChars);
      warnings.push(`Email body was truncated to ${LIMITS.maxTextChars} characters.`);
    }
    const stored: EmailEnvelope = { ...envelope, bodyText: body };

    db.prepare(
      `INSERT INTO intake_messages (id, source_key, ingestion_mode, integration_id, envelope_json, received_at, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(intakeId, input.sourceKey, input.mode, input.integrationId, JSON.stringify(stored), envelope.receivedAt, t);

    db.prepare(
      `INSERT INTO tasks (id, intake_id, status, revision, title, ingestion_mode, generation_mode, fixture_scenario,
         sender_name, sender_email, subject, organization_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      taskId, intakeId, "queued", 1,
      envelope.subject.trim().slice(0, 200) || "(no subject)",
      input.mode, input.generationMode, input.fixtureScenario,
      // Snapshot: generation mode and organization context are fixed at ingestion for every revision.
      envelope.from.name, sender, envelope.subject, JSON.stringify(settings.organization), t, t,
    );

    const ins = db.prepare(
      "INSERT INTO task_attachments (task_id, attachment_id, filename, mime_type, size_bytes, bytes) VALUES (?,?,?,?,?,?)",
    );
    // Intake is the one enforcement point for attachment limits, whatever the source. A file that is
    // not stored is reported as a visible warning; the worker then refuses to treat the input as complete.
    const keptIds = new Set<string>();
    let keptBytes = 0;
    const reasonFor = new Map<string, string>();
    const warnedIds = new Set<string>();
    const drop = (a: IngestAttachment, why: string) => {
      reasonFor.set(a.id, why);
      warnedIds.add(a.id);
      warnings.push(`Attachment "${a.filename}" was not read: ${why}.`);
    };
    for (const a of input.attachments) {
      const size = a.bytes.byteLength;
      if (keptIds.has(a.id)) drop(a, "its id repeats an earlier attachment");
      else if (keptIds.size >= LIMITS.maxFiles) drop(a, `only the first ${LIMITS.maxFiles} files per email are read`);
      else if (size > LIMITS.maxFileBytes) drop(a, `it is larger than ${LIMITS.maxFileBytes / (1024 * 1024)} MB`);
      else if (keptBytes + size > LIMITS.maxTotalBytes) drop(a, `attachments together may not exceed ${LIMITS.maxTotalBytes / (1024 * 1024)} MB`);
      else {
        ins.run(taskId, a.id, a.filename, a.mimeType, size, Buffer.from(a.bytes));
        keptIds.add(a.id);
        keptBytes += size;
      }
    }
    for (const meta of envelope.attachments) {
      if (keptIds.has(meta.id) || warnedIds.has(meta.id)) continue;
      const why = meta.sizeBytes > LIMITS.maxFileBytes
          ? `it is larger than ${LIMITS.maxFileBytes / (1024 * 1024)} MB`
          : "it was not provided to the intake step (over the file-count or total-size limit, or it could not be fetched)";
      warnings.push(`Attachment "${meta.filename}" was not read: ${why}.`);
    }

    db.prepare(
      `INSERT INTO jobs (id, task_id, revision, status, attempts, available_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(newId(), taskId, 1, "queued", 0, t, t, t);

    addEvent(db, taskId, 1, "status", "intake",
      input.mode === "demo" ? "Demo email received and queued." : "Gmail message received and queued.", now);
    for (const w of warnings) addEvent(db, taskId, 1, "warning", "intake", w, now);
    return { kind: "task", taskId, deduplicated: false };
  });
  try {
    return run.immediate();
  } catch (e) {
    // Concurrent identical source key from another connection: unique violation -> dedupe.
    if (e instanceof Error && /UNIQUE constraint failed: intake_messages.source_key/.test(e.message)) {
      const row = db
        .prepare("SELECT t.id FROM intake_messages m JOIN tasks t ON t.intake_id = m.id WHERE m.source_key = ?")
        .get(input.sourceKey) as { id: string } | undefined;
      if (row) return { kind: "task", taskId: row.id, deduplicated: true };
    }
    throw e;
  }
}
