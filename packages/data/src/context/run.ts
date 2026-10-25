// Persistence for retrieval runs, the user's corrections, and requirement outcomes.
import type { ContextBundle, ContextRequirement, RequirementStatus, RevisionReport, WorkAnswer } from "@afterhours/contracts";
import type { Db } from "../db";
import { iso, newId, parseJson } from "../util";

export type RunOutcome = "resolved" | "ambiguous" | "no_match" | "needs_requirements" | "unavailable" | "unsupported" | "incomplete" | "access_revoked" | "retryable_error" | "not_applicable";

export interface RunRow {
  id: string; owner_id: string; task_id: string; revision: number; account_id: string; status: "running" | "complete" | "failed"; outcome: RunOutcome | null;
  request_json: string; temporal_json: string | null; stages_json: string; coverage_json: string; limits_json: string; limits_hit_json: string;
  candidates_json: string; decision_json: string | null; requirements_json: string; uncertainties_json: string; questions_json: string;
  bundle_json: string | null; metrics_json: string; reused_from_revision: number | null; generation_started_at: string | null; started_at: string; finished_at: string | null;
}

export function beginRun(db: Db, ownerId: string, taskId: string, revision: number, accountId: string, now: Date): RunRow {
  const existing = db.prepare("SELECT * FROM retrieval_runs WHERE task_id=? AND revision=?").get(taskId, revision) as RunRow | undefined;
  if (existing) {
    // A retry of the same revision starts clean; the previous attempt's evidence is replaced, never duplicated.
    db.prepare("DELETE FROM retrieval_sources WHERE run_id=?").run(existing.id);
    db.prepare(`UPDATE retrieval_runs SET status='running', outcome=NULL, bundle_json=NULL, decision_json=NULL, finished_at=NULL, started_at=?, account_id=?, owner_id=? WHERE id=?`).run(iso(now), accountId, ownerId, existing.id);
    return db.prepare("SELECT * FROM retrieval_runs WHERE id=?").get(existing.id) as RunRow;
  }
  const id = newId();
  db.prepare("INSERT INTO retrieval_runs (id, owner_id, task_id, revision, account_id, status, started_at) VALUES (?,?,?,?,?,'running',?)").run(id, ownerId, taskId, revision, accountId, iso(now));
  return db.prepare("SELECT * FROM retrieval_runs WHERE id=?").get(id) as RunRow;
}

export const getRun = (db: Db, taskId: string, revision: number): RunRow | null =>
  (db.prepare("SELECT * FROM retrieval_runs WHERE task_id=? AND revision=?").get(taskId, revision) as RunRow | undefined) ?? null;

export const latestRun = (db: Db, taskId: string): RunRow | null =>
  (db.prepare("SELECT * FROM retrieval_runs WHERE task_id=? ORDER BY revision DESC LIMIT 1").get(taskId) as RunRow | undefined) ?? null;

export const priorRun = (db: Db, taskId: string, revision: number): RunRow | null =>
  (db.prepare("SELECT * FROM retrieval_runs WHERE task_id=? AND revision<? AND status='complete' AND candidates_json<>'[]' ORDER BY revision DESC LIMIT 1").get(taskId, revision) as RunRow | undefined) ?? null;

export interface RunSourceInput { type: "email" | "file_version"; id: string; role: "request" | "target" | "candidate" | "feedback" | "deck_message" | "related" | "excluded"; score?: number | null; reasons?: string[]; versionKey?: string | null; sha256?: string | null; selected?: boolean }

export function writeRunSources(db: Db, runId: string, rows: RunSourceInput[]): void {
  const ins = db.prepare("INSERT OR REPLACE INTO retrieval_sources (run_id, source_type, source_id, role, score, reasons_json, version_key, sha256, selected, ordinal) VALUES (?,?,?,?,?,?,?,?,?,?)");
  rows.forEach((r, i) => ins.run(runId, r.type, r.id, r.role, r.score ?? null, JSON.stringify(r.reasons ?? []), r.versionKey ?? null, r.sha256 ?? null, r.selected ? 1 : 0, i));
}

export function finishRun(db: Db, runId: string, patch: Partial<Record<keyof RunRow, unknown>>, now: Date): void {
  const cols = Object.keys(patch);
  const sets = cols.map((c) => `${c}=?`).join(", ");
  db.prepare(`UPDATE retrieval_runs SET ${sets ? `${sets}, ` : ""}finished_at=? WHERE id=?`).run(...cols.map((c) => { const v = patch[c as keyof RunRow]; return typeof v === "object" && v !== null ? JSON.stringify(v) : v ?? null; }) as never[], iso(now), runId);
}

export function saveRequirements(db: Db, taskId: string, revision: number, reqs: ContextRequirement[]): void {
  db.prepare("DELETE FROM task_requirements WHERE task_id=? AND revision=?").run(taskId, revision);
  const ins = db.prepare(`INSERT INTO task_requirements (task_id, revision, ordinal, id, text, edit_json, support_json, scope, conflicts_json) VALUES (?,?,?,?,?,?,?,?,?)`);
  reqs.forEach((r, i) => ins.run(taskId, revision, i, r.id, r.text, r.edit ? JSON.stringify(r.edit) : null, JSON.stringify(r.support), r.scope, JSON.stringify(r.conflictsWith)));
}

export function setRequirementOutcomes(db: Db, taskId: string, revision: number, edits: Array<{ requirementId: string; status: RequirementStatus; detail: string }>): void {
  const up = db.prepare("UPDATE task_requirements SET status=?, detail=? WHERE task_id=? AND revision=? AND id=?");
  for (const e of edits) up.run(e.status, e.detail.slice(0, 500), taskId, revision, e.requirementId);
}

/** Called inside the ready commit: the requirement outcomes, the output revision record and the run's generation stamp. */
export function recordRevisionOutcome(db: Db, ownerId: string, taskId: string, revision: number, report: RevisionReport, now: Date): void {
  setRequirementOutcomes(db, taskId, revision, report.edits);
  const run = getRun(db, taskId, revision);
  db.prepare(`INSERT INTO output_revisions (id, owner_id, task_id, revision, run_id, base_file_version_id, base_sha256, fidelity, report_json, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id, revision) DO NOTHING`).run(newId(), ownerId, taskId, revision, run?.id ?? null, report.baseVersionId, report.baseSha256, report.fidelity, JSON.stringify(report), iso(now));
}

// ---- corrections and answers ----
export interface OverrideRow { id: number; kind: "select_file" | "exclude_source" | "add_feedback" | "drop_requirement"; value: Record<string, unknown>; effective_revision: number; created_at: string }

export function addOverride(db: Db, taskId: string, effectiveRevision: number, kind: OverrideRow["kind"], value: Record<string, unknown>, now: Date): void {
  db.prepare("INSERT INTO task_context_overrides (task_id, effective_revision, kind, value_json, created_at) VALUES (?,?,?,?,?)").run(taskId, effectiveRevision, kind, JSON.stringify(value), iso(now));
}

export function overridesFor(db: Db, taskId: string, revision: number): OverrideRow[] {
  return (db.prepare("SELECT * FROM task_context_overrides WHERE task_id=? AND effective_revision<=? ORDER BY id").all(taskId, revision) as Array<{ id: number; kind: OverrideRow["kind"]; value_json: string; effective_revision: number; created_at: string }>)
    .map((r) => ({ id: r.id, kind: r.kind, value: parseJson<Record<string, unknown>>(r.value_json, {}), effective_revision: r.effective_revision, created_at: r.created_at }));
}

export interface ResolvedOverrides {
  selectedVersionId: string | null;
  selectedAnswer: string | null;
  excludeEmails: Set<string>;
  excludeFiles: Set<string>;
  dropRequirements: Set<string>;
  feedback: Array<{ id: string; text: string }>;
  intervalChoice: string | null;
  conflictChoice: string | null;
}

/** Combine stored corrections with answers to the clarification questions this feature asks. */
export function resolveOverrides(db: Db, taskId: string, revision: number, answers: WorkAnswer[]): ResolvedOverrides {
  const o: ResolvedOverrides = { selectedVersionId: null, selectedAnswer: null, excludeEmails: new Set(), excludeFiles: new Set(), dropRequirements: new Set(), feedback: [], intervalChoice: null, conflictChoice: null };
  for (const row of overridesFor(db, taskId, revision)) {
    if (row.kind === "select_file") o.selectedVersionId = String(row.value.fileVersionId ?? "") || o.selectedVersionId;
    else if (row.kind === "exclude_source") (row.value.sourceType === "email" ? o.excludeEmails : o.excludeFiles).add(String(row.value.sourceId));
    else if (row.kind === "add_feedback") o.feedback.push({ id: `note-${row.id}`, text: String(row.value.text ?? "") });
    else if (row.kind === "drop_requirement") o.dropRequirements.add(String(row.value.requirementId));
  }
  for (const a of answers) {
    if (a.questionId === "context_target") o.selectedAnswer = a.answer.trim();
    else if (a.questionId === "context_changes" || a.questionId === "context_changes_unusable") o.feedback.push({ id: `answer-${a.questionId}`, text: a.answer.trim() });
    else if (a.questionId === "context_interval") o.intervalChoice = a.answer.trim();
    else if (a.questionId === "context_conflict") o.conflictChoice = a.answer.trim();
  }
  return o;
}

export const requirementsOf = (run: RunRow): ContextRequirement[] => parseJson<ContextRequirement[]>(run.requirements_json, []);
export const bundleOf = (run: RunRow): ContextBundle | null => parseJson<ContextBundle | null>(run.bundle_json, null);
