// Re-checking access and the exact source version before a read, before generation and before a result is committed.
import type { ContextBundle, ContextFile } from "@afterhours/contracts";
import type { Db } from "../db";
import { iso, parseJson } from "../util";
import { activeGrants, emailCutoff, getAccount, selectedOf } from "./accounts";
import { auditContext } from "./audit";
import { loadVersionBytes, getVersion, registerVersion, scopeDecision, storeVersionBytes, type ProviderRegistry } from "./files";
import { finishRun, getRun, bundleOf, type RunRow } from "./run";

export type AccessProblem =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "access_revoked" | "source_deleted" | "source_unavailable" | "provider_temporary"; detail: string };

export interface AccessDeps { artifactsDir: string; providers: ProviderRegistry }

/**
 * True only if every message and file in the run's snapshot is still readable under a currently active grant. A grant
 * that was revoked or expired, a message that was deleted, a file that left the selected folder or was deleted all stop
 * the task. A live file whose version moved on is not a failure here; use captureCurrentVersion() for it.
 */
export async function checkAccess(db: Db, deps: AccessDeps, ownerId: string, taskId: string, revision: number, now: Date): Promise<AccessProblem> {
  const run = getRun(db, taskId, revision);
  const bundle = run ? bundleOf(run) : null;
  if (!run || !bundle) return { ok: true, changed: false };
  const cutoff = run.account_id ? emailCutoff(db, ownerId, run.account_id, now) : null;
  let changed = false;
  for (const s of bundle.snapshot.sources) {
    if (s.type === "email") {
      const e = db.prepare("SELECT received_at, invalidated_at FROM emails WHERE id=? AND owner_id=?").get(s.id, ownerId) as { received_at: string; invalidated_at: string | null } | undefined;
      if (!e || e.invalidated_at) return { ok: false, reason: "source_deleted", detail: "A message used as evidence was deleted or is no longer stored." };
      if (!cutoff || e.received_at < cutoff) return { ok: false, reason: "access_revoked", detail: "Access to email history was revoked or has expired." };
      continue;
    }
    const v = getVersion(db, ownerId, s.id);
    if (!v || v.invalidated_at) return { ok: false, reason: "source_deleted", detail: "The source file was deleted or is no longer available." };
    if (v.file.provider === "gmail") {
      const e = v.file.parent_email_id ? (db.prepare("SELECT received_at, invalidated_at FROM emails WHERE id=? AND owner_id=?").get(v.file.parent_email_id, ownerId) as { received_at: string; invalidated_at: string | null } | undefined) : undefined;
      if (!e || e.invalidated_at) return { ok: false, reason: "source_deleted", detail: "The message that carried the file was deleted." };
      if (!cutoff || e.received_at < cutoff) return { ok: false, reason: "access_revoked", detail: "Access to email history was revoked or has expired." };
    } else if (v.file.provider === "folder" || v.file.provider === "drive") {
      const acct = getAccount(db, ownerId, v.file.account_id);
      const grants = acct ? activeGrants(db, ownerId, acct.id, "files", now) : [];
      if (!grants.length) return { ok: false, reason: "access_revoked", detail: "Access to the selected files was revoked or has expired." };
      const provider = deps.providers.files[v.file.provider];
      if (!provider || !provider.available) return { ok: false, reason: "source_unavailable", detail: provider?.limitation ?? "The file source is not available." };
      let inScope = false;
      for (const g of grants) if ((await scopeDecision(provider, v.file.provider_file_id, selectedOf(g))).ok) { inScope = true; break; }
      if (!inScope) {
        const st = await provider.stat(v.file.provider_file_id);
        if ("missing" in st && st.reason === "deleted") return { ok: false, reason: "source_deleted", detail: "The source file was deleted." };
        if ("missing" in st && st.reason === "temporary") return { ok: false, reason: "provider_temporary", detail: st.message };
        return { ok: false, reason: "access_revoked", detail: "The file is no longer inside the files you chose to share." };
      }
      const st = await provider.stat(v.file.provider_file_id);
      if ("missing" in st) return st.reason === "temporary" ? { ok: false, reason: "provider_temporary", detail: st.message } : { ok: false, reason: st.reason === "deleted" ? "source_deleted" : "access_revoked", detail: st.message };
      const target = st.shortcutTargetId ? await provider.stat(st.shortcutTargetId) : st;
      if ("missing" in target) return { ok: false, reason: "source_deleted", detail: target.message };
      if (target.versionKey && target.versionKey !== v.version_key) changed = true;
    }
  }
  return { ok: true, changed };
}

export interface Captured { bundle: ContextBundle; files: ContextFile[]; previousVersionKey: string; newVersionKey: string }

/**
 * A live file changed after it was selected. Read the version that exists now, record it as its own immutable version, and
 * update the run's snapshot so what was used is exactly what is on record. Never claims to recover an older version.
 */
export async function captureCurrentVersion(db: Db, deps: AccessDeps, ownerId: string, taskId: string, revision: number, now: Date): Promise<Captured | null> {
  const run = getRun(db, taskId, revision) as RunRow | null;
  const bundle = run ? bundleOf(run) : null;
  if (!run || !bundle) return null;
  const tv = getVersion(db, ownerId, bundle.resolvedTarget.versionId);
  if (!tv || (tv.file.provider !== "folder" && tv.file.provider !== "drive")) return null;
  const provider = deps.providers.files[tv.file.provider];
  if (!provider?.available) return null;
  const opened = await provider.open(tv.file.provider_file_id);
  if (!opened.ok || (opened.entry.versionKey ?? tv.version_key) === tv.version_key) return null;
  const nv = registerVersion(db, { ownerId, fileId: tv.file_id, versionKey: opened.entry.versionKey!, snapshotKind: tv.snapshot_kind, sizeBytes: opened.bytes.byteLength, modifiedAt: opened.entry.modifiedAt }, now);
  const stored = nv.blob_rel_path ? nv : storeVersionBytes(db, deps.artifactsDir, ownerId, nv.id, opened.bytes);
  const updated: ContextBundle = {
    ...bundle,
    resolvedTarget: { ...bundle.resolvedTarget, versionId: stored.id, versionKey: stored.version_key, sha256: stored.checksum_sha256!, sizeBytes: stored.size_bytes, modifiedAt: stored.modified_at },
    snapshot: { ...bundle.snapshot, sources: bundle.snapshot.sources.map((s) => (s.type === "file_version" && s.id === tv.id ? { ...s, id: stored.id, versionKey: stored.version_key, sha256: stored.checksum_sha256 } : s)) },
    uncertainties: [...bundle.uncertainties, { kind: "assumption", text: `The file changed after it was selected (version ${tv.version_key.slice(0, 12)} to ${stored.version_key.slice(0, 12)}). The revision was prepared from the newer version; its slide numbers and text may differ from what the feedback described.` }],
  };
  db.prepare("UPDATE retrieval_sources SET source_id=?, version_key=?, sha256=? WHERE run_id=? AND source_id=?").run(stored.id, stored.version_key, stored.checksum_sha256, run.id, tv.id);
  finishRun(db, run.id, { bundle_json: updated, metrics_json: { ...parseJson<Record<string, unknown>>(run.metrics_json, {}), changedSinceSelection: true } }, new Date(run.finished_at ?? iso(now)));
  auditContext(db, ownerId, "retrieval.version_changed", { type: "task", id: taskId }, { from: tv.version_key, to: stored.version_key }, now);
  const bytes = loadVersionBytes(db, deps.artifactsDir, ownerId, stored.id);
  if (!bytes) return null;
  return { bundle: updated, files: [{ versionId: stored.id, filename: bundle.resolvedTarget.filename, mimeType: bundle.resolvedTarget.mimeType, bytes: new Uint8Array(bytes) }], previousVersionKey: tv.version_key, newVersionKey: stored.version_key };
}

export function markGenerationStarted(db: Db, taskId: string, revision: number, now: Date): void {
  db.prepare("UPDATE retrieval_runs SET generation_started_at=COALESCE(generation_started_at, ?) WHERE task_id=? AND revision=?").run(iso(now), taskId, revision);
}
