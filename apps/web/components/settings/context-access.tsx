"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Folder, FolderOpen, Loader2, ShieldCheck } from "lucide-react";
import type { ContextStatus, GrantView } from "@afterhours/contracts";
import { api, describeError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useContextGrants, useContextStatus } from "@/lib/hooks";
import { useToast } from "../providers";

function GrantRow({ g, tz }: { g: GrantView; tz?: string }) {
  const { revoke, purge } = useContextGrants();
  const toast = useToast();
  const [confirm, setConfirm] = useState<"revoke" | "purge" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = g.kind === "email" ? `Email history, last ${g.lookbackDays} days` : `Files: ${g.selected.map((s) => s.label).join(", ")}`;
  return (
    <li className="card card-flat" data-testid="grant-row">
      <div className="card-head">
        <strong className="wrap-anywhere">{label}</strong>
        <span className={`badge ${g.active ? "badge-good" : "badge-neutral"}`}>{g.active ? "Active" : g.revokedAt ? "Revoked" : "Expired"}</span>
      </div>
      <p className="small muted">{g.account} · shared {formatDateTime(g.createdAt, tz)}{g.expiresAt ? ` · expires ${formatDateTime(g.expiresAt, tz)}` : ""}{g.revokedAt ? ` · revoked ${formatDateTime(g.revokedAt, tz)}` : ""}</p>
      {g.active && confirm !== "revoke" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm("revoke")}>Stop sharing</button>}
      {!g.active && confirm !== "purge" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm("purge")}>Delete what was kept</button>}
      {confirm && (
        <span className="inline-confirm" role="group" aria-label={confirm === "revoke" ? "Confirm stop sharing" : "Confirm delete"}>
          <span className="small">{confirm === "revoke" ? "Stop using this now? Copies already kept stay until you delete them." : "Delete the messages, files and extracted text kept under this grant? Earlier backups are not rewritten."}</span>
          <button type="button" className="btn btn-danger btn-sm" disabled={revoke.isPending || purge.isPending}
            onClick={() => (confirm === "revoke" ? revoke : purge).mutate(g.id, {
              onSuccess: () => { toast.push("success", confirm === "revoke" ? "Sharing stopped." : "Kept data deleted."); setConfirm(null); },
              onError: (e) => setError(describeError(e)),
            })}>{confirm === "revoke" ? "Yes, stop sharing" : "Yes, delete"}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
        </span>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </li>
  );
}

function EmailGrant({ status }: { status: ContextStatus }) {
  const { create } = useContextGrants();
  const toast = useToast();
  const [days, setDays] = useState(String(status.suggestedLookbackDays));
  const [error, setError] = useState<string | null>(null);
  const mailbox = status.accounts.find((a) => a.provider === "gmail");
  const active = status.grants.find((g) => g.kind === "email" && g.active);
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 730;
  const gmail = status.providers.find((p) => p.provider === "gmail");
  return (
    <section aria-labelledby="ctx-email-h" className="stack-sm">
      <h3 id="ctx-email-h" className="h4">Email history</h3>
      <p className="muted small">Lets AfterHours find “the presentation from last week” and the feedback you discussed. Old messages are searchable context only: they never start work on their own.</p>
      {gmail && <p className="muted small">{gmail.scopeNote}</p>}
      {!mailbox || mailbox.state === "disconnected" ? (
        <p className="callout callout-warn" role="note"><AlertTriangle size={16} aria-hidden /> Connect Gmail first. Without it you can still attach the presentation to an email.</p>
      ) : (
        <>
          <p className="small" data-testid="coverage-note">{mailbox.coverage.note}{mailbox.lastError ? ` Problem: ${mailbox.lastError}` : ""}</p>
          <div className="field">
            <label htmlFor="lookback">Read mail from the last (days)</label>
            <input id="lookback" type="number" min={1} max={730} value={days} onChange={(e) => setDays(e.target.value)} aria-invalid={!valid} />
            {!valid && <p className="field-error" role="alert">Choose between 1 and 730 days.</p>}
          </div>
          <div className="actions">
            <button type="button" className="btn btn-primary btn-sm" disabled={!valid || create.isPending}
              onClick={() => create.mutate({ kind: "email", lookbackDays: n }, { onSuccess: () => { toast.push("success", `Reading the last ${n} days of mail.`); setError(null); }, onError: (e) => setError(describeError(e)) })}>
              {create.isPending ? <><Loader2 size={14} className="spin" aria-hidden />Saving…</> : active ? "Change the lookback" : `Allow reading the last ${valid ? n : "…"} days`}
            </button>
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}

function FolderGrant({ status }: { status: ContextStatus }) {
  const { create } = useContextGrants();
  const toast = useToast();
  const [parent, setParent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const folderInfo = status.providers.find((p) => p.provider === "folder");
  const drive = status.providers.find((p) => p.provider === "drive");
  const listing = useQuery({ enabled: !!folderInfo?.available, queryKey: ["context-folders", parent], queryFn: ({ signal }) => api.folders(parent, signal) });
  return (
    <section aria-labelledby="ctx-files-h" className="stack-sm">
      <h3 id="ctx-files-h" className="h4">Project files</h3>
      <p className="muted small">Optional and separate from email. Choose specific folders only; AfterHours never indexes a whole drive and never goes up to a parent folder.</p>
      {folderInfo && <p className="muted small">{folderInfo.scopeNote}</p>}
      {!folderInfo?.available && <p className="callout callout-warn" role="note"><AlertTriangle size={16} aria-hidden /> {folderInfo?.limitation}</p>}
      {drive && !drive.available && <p className="muted small">Google Drive: {drive.limitation}</p>}
      {folderInfo?.available && (
        <>
          <p className="small">Browsing: <code>/{parent}</code>{parent && <> <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParent(parent.includes("/") ? parent.slice(0, parent.lastIndexOf("/")) : "")}>Up</button></>}</p>
          {listing.isPending && <p className="muted" role="status">Loading…</p>}
          {listing.isError && <p className="field-error" role="alert">{describeError(listing.error)}</p>}
          <ul className="plain stack-sm">
            {listing.data?.entries.filter((e) => e.kind === "folder").map((e) => (
              <li key={e.id} className="card card-flat">
                <span className="wrap-anywhere"><Folder size={14} aria-hidden /> {e.name}</span>
                <span className="actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParent(e.id)}><FolderOpen size={14} aria-hidden />Open</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={create.isPending}
                    onClick={() => create.mutate({ kind: "files", provider: "folder", selected: [{ providerId: e.id, kind: "folder", label: e.name }] }, { onSuccess: () => { toast.push("success", `Sharing “${e.name}”.`); setError(null); }, onError: (er) => setError(describeError(er)) })}>Share this folder</button>
                </span>
              </li>
            ))}
            {listing.data && listing.data.entries.every((e) => e.kind !== "folder") && <li className="muted small">No folders here.</li>}
          </ul>
          {error && <p className="field-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}

export function ContextAccessSection({ timeZone }: { timeZone?: string }) {
  const q = useContextStatus();
  return (
    <section className="card settings-section" aria-labelledby="ctx-h" id="context-access">
      <h2 id="ctx-h" className="h3"><ShieldCheck size={18} aria-hidden /> Email history and files</h2>
      {q.isPending && <p className="muted" role="status">Checking…</p>}
      {q.isError && <p className="field-error" role="alert">{describeError(q.error)}</p>}
      {q.data && (
        <>
          <p className="muted small">Used only to resolve requests like “revise the presentation from last week based on what we discussed”. Nothing here sends mail, contacts anyone, or changes a source file. {q.data.uploadFallback}</p>
          <EmailGrant status={q.data} />
          <FolderGrant status={q.data} />
          {q.data.grants.length > 0 && (
            <section aria-labelledby="ctx-grants-h" className="stack-sm">
              <h3 id="ctx-grants-h" className="h4">What you have shared</h3>
              <ul className="plain stack-sm">{q.data.grants.map((g) => <GrantRow key={g.id} g={g} tz={timeZone} />)}</ul>
            </section>
          )}
          {q.data.metrics.runs > 0 && (
            <p className="muted small" data-testid="context-metrics"><CheckCircle2 size={12} aria-hidden /> {q.data.metrics.runs} lookups: {q.data.metrics.resolved} resolved, {q.data.metrics.clarified} needed a question{q.data.metrics.avgLatencyMs !== null ? `, ${Math.round(q.data.metrics.avgLatencyMs)} ms average` : ""}, {q.data.metrics.filesParsed} files read, model cost ${q.data.metrics.modelCostUsd.toFixed(2)}.</p>
          )}
        </>
      )}
    </section>
  );
}
