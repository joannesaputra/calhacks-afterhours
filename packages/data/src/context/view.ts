// What the dashboard shows about retrieved context, and the checks that decide whether a source may be opened.
import type { ContextStatus, ContextView, GrantView, RetrievalFailureClass, RetrievalSummary, RevisionReport, Uncertainty } from "@afterhours/contracts";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import { notFound } from "../errors";
import { clip } from "./text";
import { iso, parseJson } from "../util";
import { activeGrants, emailCutoff, listAccounts, selectedOf, type AccountRow, type GrantRow } from "./accounts";
import { describeProviders } from "./providers";
import { getVersion } from "./files";
import { loadVersionBytes } from "./files";
import { parseRequest } from "./request";
import { bundleOf, getRun, latestRun, overridesFor } from "./run";
import { coverageOf } from "./sync";
import type { PhraseInterpretation } from "./temporal";
import { toTemporal } from "./resolve";
import { OWNER_ID } from "./types";
import { getEmail, type EmailView } from "./mail";
import type { EmailEnvelope, TaskStatus } from "@afterhours/contracts";

export const PHASE_LABEL = {
  finding: "Finding the presentation and feedback",
  preparing: "Preparing your revision",
  needs_input: "Needs your input",
  ready: "Ready for review",
  error: "Something went wrong. You can retry.",
  not_applicable: "",
} as const;

const LIMITATIONS = [
  "Only .pptx presentations are revised, and only by editing the original file: replace text, add a bullet to an existing bulleted text area, or remove a slide. Other requested changes are listed as not supported and are never guessed at.",
  "Charts, images, layouts and every untouched slide keep the original file's bytes. Slides that were edited keep their formatting where the edit allows.",
  "Requested changes are read from the written email text by fixed rules, not by a model. Feedback phrased loosely is kept as written and reported as not supported.",
  "The source file is never modified. The revision is a separate file that you review before anything is sent.",
];

export function emailOpenable(db: Db, ownerId: string, accountId: string, e: Pick<EmailView, "received_at" | "invalidated_at" | "account_id">, now: Date): boolean {
  if (e.invalidated_at) return false;
  const cutoff = emailCutoff(db, ownerId, e.account_id || accountId, now);
  return !!cutoff && e.received_at >= cutoff;
}

/** Whether a stored file version may be read right now under the grants in force. */
export function fileOpenable(db: Db, ownerId: string, versionId: string, now: Date): boolean {
  const v = getVersion(db, ownerId, versionId);
  if (!v || v.invalidated_at || v.file.state !== "active") return false;
  if (v.file.provider === "task") return true;
  if (v.file.provider === "gmail") {
    const e = v.file.parent_email_id ? getEmail(db, ownerId, v.file.parent_email_id) : null;
    return !!e && emailOpenable(db, ownerId, e.account_id, e, now);
  }
  return activeGrants(db, ownerId, v.file.account_id, "files", now).length > 0;
}

export function getOpenableEmail(db: Db, ownerId: string, emailId: string, now: Date): { subject: string; from: string; to: string[]; cc: string[]; date: string; text: string; direction: string } {
  const e = getEmail(db, ownerId, emailId);
  if (!e || !emailOpenable(db, ownerId, e.account_id, e, now)) throw notFound("Message");
  return { subject: e.subject, from: e.from_address, to: e.to, cc: e.cc, date: e.received_at, text: e.new_text || e.body_text, direction: e.direction };
}

export function getOpenableFile(db: Db, artifactsDir: string, ownerId: string, versionId: string, now: Date): { filename: string; mimeType: string; bytes: Buffer } {
  if (!fileOpenable(db, ownerId, versionId, now)) throw notFound("File");
  const v = getVersion(db, ownerId, versionId)!;
  const bytes = loadVersionBytes(db, artifactsDir, ownerId, versionId);
  if (!bytes) throw notFound("File");
  return { filename: v.file.name, mimeType: v.file.mime_type, bytes };
}

interface TaskLite { id: string; status: TaskStatus; revision: number; intake_id: string; organization_json: string | null; error_json: string | null }

export function getContextView(db: Db, taskId: string, now: Date, ownerId: string = OWNER_ID): ContextView | null {
  const task = db.prepare("SELECT id, status, revision, intake_id, organization_json, error_json FROM tasks WHERE id=?").get(taskId) as TaskLite | undefined;
  if (!task) throw notFound("Task");
  const run = latestRun(db, taskId);
  if (run && run.owner_id !== ownerId) return null;
  const envelope = JSON.parse((db.prepare("SELECT envelope_json FROM intake_messages WHERE id=?").get(task.intake_id) as { envelope_json: string }).envelope_json) as EmailEnvelope;
  if (!run && !parseRequest(envelope).inferred.applicable) return null;
  const tz = parseJson<{ timezone?: string }>(task.organization_json, {}).timezone ?? "UTC";
  const currentRun = getRun(db, taskId, task.revision);
  const phase: ContextView["phase"] =
    task.status === "queued" || task.status === "planning" ? "finding" : task.status === "running" ? "preparing" : task.status === "needs_input" ? "needs_input"
    : task.status === "failed" ? "error" : task.status === "skipped" ? "not_applicable" : "ready";
  const phaseLabel = task.status === "approved" ? "Reviewed. Nothing was sent." : task.status === "dismissed" ? "Dismissed" : PHASE_LABEL[phase];
  const decision = parseJson<{ kind?: string; target?: string | null; failure?: RetrievalFailureClass; failureDetail?: string | null }>(run?.decision_json, {});
  const bundle = run ? bundleOf(run) : null;
  const sources = run ? (db.prepare("SELECT * FROM retrieval_sources WHERE run_id=? ORDER BY ordinal").all(run.id) as Array<{ source_type: string; source_id: string; role: string; score: number | null; reasons_json: string; selected: number }>) : [];
  const overrides = overridesFor(db, taskId, task.revision);
  const excludedEmails = new Set(overrides.filter((o) => o.kind === "exclude_source" && o.value.sourceType === "email").map((o) => String(o.value.sourceId)));

  // candidates
  const candRows = parseJson<Array<{ versionId: string; fileId: string; name: string; score: number; reasons: string[]; state: string; sentAt: string | null; dominated: boolean }>>(run?.candidates_json, []);
  const targetVersionId = bundle?.resolvedTarget.versionId ?? decision.target ?? null;
  const candidates = candRows.filter((c) => !c.dominated || c.versionId === targetVersionId).map((c) => {
    const v = getVersion(db, ownerId, c.versionId);
    return { fileId: c.fileId, versionId: c.versionId, name: c.name, date: c.sentAt ?? v?.modified_at ?? null, provider: v?.file.provider ?? "gmail", score: c.score, reasons: c.reasons, selected: c.versionId === targetVersionId, openable: fileOpenable(db, ownerId, c.versionId, now), state: v?.invalidated_at ? "unavailable" : c.state };
  }).sort((a, b) => b.score - a.score);

  // target
  let target: ContextView["target"] = null;
  if (targetVersionId) {
    const v = getVersion(db, ownerId, targetVersionId);
    if (v) {
      const reasons = bundle?.resolvedTarget.reasonCodes ?? candRows.find((c) => c.versionId === targetVersionId)?.reasons ?? [];
      const metrics = parseJson<{ changedSinceSelection?: boolean }>(run?.metrics_json, {});
      target = {
        fileId: v.file_id, versionId: v.id, name: v.file.name, versionKey: v.version_key, sha256: v.checksum_sha256 ?? "", provider: v.file.provider,
        snapshotKind: v.snapshot_kind, modifiedAt: v.modified_at, sentAt: v.sent_at, reasons, openable: fileOpenable(db, ownerId, v.id, now), changedSinceSelection: !!metrics.changedSinceSelection,
      };
    }
  }

  // messages
  const messages: ContextView["messages"] = [{
    id: `current-${taskId}`, subject: envelope.subject, from: envelope.from.email, to: envelope.to, cc: [], date: envelope.receivedAt, direction: "inbound", role: "request",
    excerpt: clip(envelope.bodyText.replace(/\s+/g, " "), 240), included: true, openable: false, reasons: ["the_request"],
  }];
  for (const s of sources) {
    if (s.source_type !== "email" || s.source_id.startsWith("current-")) continue;
    const e = getEmail(db, ownerId, s.source_id);
    if (!e) continue;
    const open = emailOpenable(db, ownerId, e.account_id, e, now);
    const role = s.role === "feedback" ? "feedback" : s.role === "deck_message" ? "deck_message" : "related";
    messages.push({
      id: e.id, subject: e.subject, from: e.from_address, to: e.to, cc: e.cc, date: e.received_at, direction: e.direction, role,
      excerpt: open ? clip((e.new_text || e.body_text).replace(/\s+/g, " "), 240) : "", included: s.selected === 1 && !excludedEmails.has(e.id), openable: open,
      reasons: [...parseJson<string[]>(s.reasons_json, []), ...(excludedEmails.has(e.id) ? ["removed_by_you"] : [])],
    });
  }

  // requirements
  const reqRows = db.prepare("SELECT * FROM task_requirements WHERE task_id=? AND revision=? ORDER BY ordinal").all(taskId, run?.revision ?? task.revision) as Array<{ id: string; text: string; support_json: string; status: ContextView["requirements"][number]["status"]; detail: string | null }>;
  const requirements = (reqRows.length ? reqRows : []).map((r) => ({ id: r.id, text: r.text, status: r.status, detail: r.detail, source: parseJson<Array<{ sourceId: string; quote: string | null }>>(r.support_json, [])[0] ?? null }));

  const phrase = parseJson<{ phrase?: PhraseInterpretation; chosen?: string | null } | null>(run?.temporal_json, null);
  const chosen = phrase?.phrase ? [phrase.phrase.primary, ...phrase.phrase.alternatives].find((i) => i.id === phrase.chosen) ?? phrase.phrase.primary : null;
  const temporal = bundle?.temporalInterpretation ?? (phrase?.phrase && chosen ? toTemporal(phrase.phrase, chosen, tz) : null);

  const retrieval: RetrievalSummary | null = run ? {
    stages: parseJson(run.stages_json, []),
    coverage: parseJson(run.coverage_json, { emailHistory: "not_authorized", files: "not_authorized", notes: [] }),
    limitsReached: parseJson<string[]>(run.limits_hit_json, []),
    failure: decision.failure ?? "none", failureDetail: decision.failureDetail ?? null,
  } : null;
  const uncertainties: Uncertainty[] = [...parseJson<Uncertainty[]>(run?.uncertainties_json, [])];
  if (task.status === "needs_input") for (const q of parseJson<Array<{ question: string }>>(run?.questions_json, [])) uncertainties.unshift({ kind: "blocking", text: q.question });

  const reportRow = db.prepare("SELECT report_json FROM output_revisions WHERE task_id=? ORDER BY revision DESC LIMIT 1").get(taskId) as { report_json: string } | undefined;
  const corrections = overrides.map((o) => ({
    id: String(o.id), kind: o.kind, createdAt: o.created_at,
    label: o.kind === "select_file" ? "You chose a different file" : o.kind === "exclude_source" ? `You removed a ${o.value.sourceType === "email" ? "message" : "file"}` : o.kind === "drop_requirement" ? "You dropped a requested change" : "You added feedback",
  }));
  const err = parseJson<{ message?: string } | null>(task.error_json, null);
  return {
    phase, phaseLabel, outcome: currentRun?.outcome ?? run?.outcome ?? null,
    failure: decision.failure && decision.failure !== "none" ? decision.failure : null,
    failureDetail: phase === "error" ? err?.message ?? decision.failureDetail ?? null : decision.failureDetail ?? null,
    target, candidates, messages, requirements, temporal, retrieval, uncertainties, corrections,
    report: reportRow ? (JSON.parse(reportRow.report_json) as RevisionReport) : null,
    limitations: [...LIMITATIONS, ...(retrieval?.coverage.notes ?? [])],
  };
}

// ---- settings surface ----
const grantView = (db: Db, g: GrantRow, accounts: Map<string, AccountRow>, now: Date): GrantView => ({
  id: g.id, kind: g.kind, provider: accounts.get(g.account_id)?.provider ?? "gmail", account: accounts.get(g.account_id)?.account_ref ?? "",
  lookbackDays: g.lookback_days, selected: selectedOf(g), createdAt: g.created_at, expiresAt: g.expires_at, revokedAt: g.revoked_at,
  active: !g.revoked_at && (!g.expires_at || g.expires_at > iso(now)),
});

export function getContextStatus(db: Db, config: AppConfig, now: Date, ownerId: string = OWNER_ID): ContextStatus {
  const accounts = listAccounts(db, ownerId);
  const map = new Map(accounts.map((a) => [a.id, a]));
  const grants = (db.prepare("SELECT * FROM context_grants WHERE owner_id=? ORDER BY created_at DESC LIMIT 50").all(ownerId) as GrantRow[]).map((g) => grantView(db, g, map, now));
  return {
    suggestedLookbackDays: config.context.suggestedLookbackDays,
    accounts: accounts.map((a) => {
      const c = coverageOf(db, ownerId, a.id, now);
      return {
        id: a.id, provider: a.provider, account: a.account_ref, state: a.state, syncStatus: a.sync_status, lastSyncAt: a.last_sync_at, lastError: a.last_error,
        coverage: { complete: c.complete, oldestSyncedAt: c.oldestSyncedAt, lookbackFrom: c.lookbackFrom, messages: c.messages, note: c.note },
      };
    }),
    grants,
    providers: describeProviders(config),
    metrics: contextMetrics(db, ownerId),
    uploadFallback: "If a source is unavailable you can always attach the presentation to a new email; nothing about that route depends on history or file access.",
  };
}

export function contextMetrics(db: Db, ownerId: string): ContextStatus["metrics"] {
  const runs = db.prepare("SELECT outcome, decision_json, metrics_json, task_id FROM retrieval_runs WHERE owner_id=? AND outcome IS NOT NULL AND outcome<>'not_applicable' AND status='complete'").all(ownerId) as Array<{ outcome: string; decision_json: string | null; metrics_json: string; task_id: string }>;
  const asked = new Set(["ambiguous", "needs_requirements", "no_match", "incomplete", "unavailable", "unsupported"]);
  const resolved = runs.filter((r) => r.outcome === "resolved").length;
  const clarified = runs.filter((r) => asked.has(r.outcome)).length;
  const auto = runs.filter((r) => r.outcome === "resolved" && parseJson<{ target?: string | null }>(r.decision_json, {}).target);
  const corrected = auto.filter((r) => {
    const t = parseJson<{ target?: string | null }>(r.decision_json, {}).target;
    return (db.prepare("SELECT value_json FROM task_context_overrides WHERE task_id=? AND kind='select_file'").all(r.task_id) as Array<{ value_json: string }>).some((o) => parseJson<{ fileVersionId?: string }>(o.value_json, {}).fileVersionId !== t);
  }).length;
  const reqs = db.prepare("SELECT status, COUNT(*) n FROM task_requirements GROUP BY status").all() as Array<{ status: string; n: number }>;
  const reqTotal = reqs.reduce((a, r) => a + r.n, 0);
  const reqDone = reqs.filter((r) => r.status === "applied" || r.status === "already_satisfied").reduce((a, r) => a + r.n, 0);
  const ver = db.prepare("SELECT extraction_status s, COUNT(*) n FROM file_versions WHERE owner_id=? AND extraction_status<>'pending' GROUP BY extraction_status").all(ownerId) as Array<{ s: string; n: number }>;
  const verTotal = ver.reduce((a, r) => a + r.n, 0);
  const verBad = ver.filter((r) => r.s !== "complete").reduce((a, r) => a + r.n, 0);
  const m = runs.map((r) => parseJson<{ latencyMs?: number; filesParsed?: number; modelCostUsd?: number }>(r.metrics_json, {}));
  const lat = m.map((x) => x.latencyMs).filter((x): x is number => typeof x === "number");
  return {
    runs: runs.length, resolved, clarified,
    clarificationRate: runs.length ? clarified / runs.length : null,
    resolutionAccuracy: auto.length ? 1 - corrected / auto.length : null,
    requirementCoverage: reqTotal ? reqDone / reqTotal : null,
    unsupportedSourceRate: verTotal ? verBad / verTotal : null,
    avgLatencyMs: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null,
    filesParsed: m.reduce((a, x) => a + (x.filesParsed ?? 0), 0),
    modelCostUsd: m.reduce((a, x) => a + (x.modelCostUsd ?? 0), 0),
  };
}

