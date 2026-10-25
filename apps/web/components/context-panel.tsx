"use client";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Info, Loader2, Mail, MinusCircle, Search, ShieldCheck } from "lucide-react";
import type { ContextView, TaskDetail } from "@afterhours/contracts";
import { api, describeError, isStale } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useContextCorrection } from "@/lib/hooks";
import { useToast } from "./providers";

const REASON: Record<string, string> = {
  explicit_file_reference: "Named or attached in the request",
  link_file_id_match: "Linked from the request",
  user_confirmation: "You chose it",
  thread_linkage: "Same email thread",
  project_match: "Matches the project",
  sender_relevance: "Sent to or from the requester",
  temporal_fit: "Sent in the time you described",
  outside_interval: "Outside the time you described",
  file_type_match: "A .pptx presentation",
  documented_feedback: "Feedback was written about it",
  version_lineage: "Best-supported version of this document",
  selected_folder_member: "In a folder you shared",
  different_project: "Looks like a different project",
  the_request: "This request",
  same_thread: "Same email thread",
  sender_history: "Earlier mail with the requester",
  project_terms: "Mentions the project",
  reused: "Reused from the earlier search",
  removed_by_you: "Removed by you",
};
const reason = (code: string) => REASON[code] ?? code.replace(/_/g, " ");

const STATUS_TEXT = { pending: "Not started", applied: "Applied", already_satisfied: "Already in the deck", unsupported: "Not supported", blocked: "Blocked" } as const;
const STATUS_TONE = { pending: "badge-neutral", applied: "badge-good", already_satisfied: "badge-good", unsupported: "badge-warn", blocked: "badge-warn" } as const;

/** Phase banner for the work in progress: the same persisted state the worker writes, in plain words. */
export function ContextPhase({ view }: { view: ContextView }) {
  if (view.phase === "not_applicable") return null;
  return <span className={`badge ${view.phase === "error" ? "badge-bad" : view.phase === "ready" ? "badge-good" : view.phase === "needs_input" ? "badge-warn" : "badge-info"}`} data-testid="context-phase">{view.phaseLabel}</span>;
}

function OpenEmail({ id, label }: { id: string; label: string }) {
  const [state, setState] = useState<{ text: string } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const e = await api.openEmail(id); setState({ text: e.text }); } catch (err) { setState({ error: describeError(err) }); } finally { setBusy(false); }
      }}>{busy ? "Opening…" : label}</button>
      {state && ("error" in state ? <p className="field-error" role="alert">{state.error}</p> : <pre className="email-body">{state.text}</pre>)}
    </>
  );
}

function Corrections({ detail, view }: { detail: TaskDetail; view: ContextView }) {
  const { task } = detail;
  const fix = useContextCorrection(task.id);
  const toast = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const allowed = ["needs_input", "ready", "failed"].includes(task.status);
  if (!allowed) return null;
  const run = (body: Parameters<typeof fix.mutate>[0], ok: string) => {
    setError(null);
    fix.mutate(body, {
      onSuccess: () => toast.push("success", ok),
      onError: (e) => setError(isStale(e) ? "This task changed. Refresh to see the latest version." : describeError(e)),
    });
  };
  const others = view.candidates.filter((c) => !c.selected && c.openable);
  return (
    <section className="stack-sm" aria-labelledby="ctx-fix-h">
      <h3 id="ctx-fix-h" className="h4">Correct what was used</h3>
      <p className="muted small">A correction creates a new revision. Work that is still valid, such as the search already done, is reused.</p>
      {others.length > 0 && (
        <ul className="plain stack-sm">
          {others.map((c) => (
            <li key={c.versionId} className="card card-flat">
              <span className="wrap-anywhere"><FileText size={14} aria-hidden /> {c.name}{c.date ? ` (${formatDateTime(c.date)})` : ""}</span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={fix.isPending}
                onClick={() => run({ action: "select_file", revision: task.revision, fileVersionId: c.versionId }, `Revising ${c.name} instead.`)}>Use this file instead</button>
            </li>
          ))}
        </ul>
      )}
      <div className="field">
        <label htmlFor="ctx-feedback">Add or supply the changes you want</label>
        <textarea id="ctx-feedback" rows={3} maxLength={3000} value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: change the fee from $50,000 to $45,000 on slide 2." />
        <div className="actions">
          <button type="button" className="btn btn-primary btn-sm" disabled={fix.isPending || text.trim().length < 3}
            onClick={() => run({ action: "add_feedback", revision: task.revision, text: text.trim() }, "Feedback added. Preparing a new revision.")}>
            {fix.isPending ? <><Loader2 size={14} className="spin" aria-hidden />Saving…</> : "Add and re-run"}
          </button>
        </div>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}

/** "Context used": which presentation and version, the messages relied on, the requested edits, and why. */
export function ContextUsed({ detail, view, tz }: { detail: TaskDetail; view: ContextView; tz?: string }) {
  const fix = useContextCorrection(detail.task.id);
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const t = view.target;
  const used = view.messages.filter((m) => m.included);
  const considered = view.messages.filter((m) => !m.included);
  const act = (body: Parameters<typeof fix.mutate>[0], ok: string) => {
    setErr(null);
    fix.mutate(body, { onSuccess: () => toast.push("success", ok), onError: (e) => setErr(describeError(e)) });
  };
  const canEdit = ["needs_input", "ready", "failed"].includes(detail.task.status);
  return (
    <div className="stack" data-testid="context-used">
      <p><ContextPhase view={view} /></p>
      {view.failure && view.failureDetail && view.phase !== "ready" && (
        <div className="callout callout-warn" role="note"><AlertTriangle size={16} aria-hidden /> <div><strong>{view.phase === "needs_input" ? "Why I need you" : "What happened"}</strong><p>{view.failureDetail}</p></div></div>
      )}
      {t ? (
        <section aria-labelledby="ctx-target-h" className="stack-sm">
          <h3 id="ctx-target-h" className="h4">Presentation used</h3>
          <dl className="kv">
            <dt>File</dt><dd className="wrap-anywhere"><FileText size={14} aria-hidden /> {t.name}</dd>
            <dt>Version</dt><dd className="wrap-anywhere">{t.snapshotKind === "attachment_snapshot" ? "Attachment as sent" : t.snapshotKind === "local_file" ? "Live file in a shared folder" : "Live file revision"} · <code>{t.versionKey.slice(0, 16)}</code>{t.sha256 && <> · SHA-256 <code>{t.sha256.slice(0, 12)}</code></>}</dd>
            <dt>{t.sentAt ? "Sent" : "Modified"}</dt><dd>{formatDateTime(t.sentAt ?? t.modifiedAt, tz)}</dd>
            <dt>Why this file</dt><dd>{t.reasons.length ? t.reasons.map(reason).join(" · ") : "No signals recorded."}</dd>
          </dl>
          {t.changedSinceSelection && <p className="callout callout-warn" role="note"><AlertTriangle size={16} aria-hidden /> This file changed after it was selected. The revision used the newer version shown here.</p>}
          {t.openable ? <a className="btn btn-secondary btn-sm" href={`/api/context/files/${encodeURIComponent(t.versionId)}/download`}>Download the original</a>
            : <p className="muted small"><MinusCircle size={14} aria-hidden /> You cannot open this source now: its access was revoked or it is no longer stored.</p>}
          {canEdit && <button type="button" className="btn btn-ghost btn-sm" disabled={fix.isPending}
            onClick={() => act({ action: "exclude_source", revision: detail.task.revision, sourceType: "file", sourceId: t.fileId }, "File removed. Looking again.")}>Remove this file from the search</button>}
        </section>
      ) : <p className="muted">No presentation has been chosen yet.</p>}

      {view.candidates.length > 1 && (
        <section aria-labelledby="ctx-cand-h" className="stack-sm">
          <h3 id="ctx-cand-h" className="h4">Other presentations considered</h3>
          <ul className="plain stack-sm">
            {view.candidates.filter((c) => !c.selected).map((c) => (
              <li key={c.versionId} className="card card-flat">
                <strong className="wrap-anywhere">{c.name}</strong>
                <span className="muted small">{c.date ? formatDateTime(c.date, tz) : "date unknown"} · {c.state === "ok" ? "readable" : c.state}</span>
                <span className="small">{c.reasons.length ? c.reasons.map(reason).join(" · ") : "No supporting signals."}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="ctx-msg-h" className="stack-sm">
        <h3 id="ctx-msg-h" className="h4">Messages used</h3>
        <ul className="plain stack-sm">
          {used.map((m) => (
            <li key={m.id} className="card card-flat">
              <div className="card-head">
                <strong className="wrap-anywhere"><Mail size={14} aria-hidden /> {m.subject || "(no subject)"}</strong>
                <span className="badge badge-neutral">{m.role === "request" ? "This request" : m.role === "feedback" ? "Feedback" : m.role === "deck_message" ? "Sent the presentation" : "Related"}</span>
              </div>
              <p className="muted small">{formatDateTime(m.date, tz)} · {m.direction === "outbound" ? "Sent" : "Received"} · From {m.from} · To {[...m.to, ...m.cc].join(", ") || "—"}</p>
              {m.excerpt ? <p className="wrap-anywhere">{m.excerpt}</p> : m.role !== "request" && <p className="muted small">The excerpt is hidden because access to this message is no longer granted.</p>}
              <p className="small muted">{m.reasons.map(reason).join(" · ")}</p>
              {m.openable && m.role !== "request" && <OpenEmail id={m.id} label="Open the message" />}
              {canEdit && m.role !== "request" && <button type="button" className="btn btn-ghost btn-sm" disabled={fix.isPending}
                onClick={() => act({ action: "exclude_source", revision: detail.task.revision, sourceType: "email", sourceId: m.id }, "Message removed. Looking again.")}>Do not use this message</button>}
            </li>
          ))}
        </ul>
        {considered.length > 0 && <details><summary>{considered.length} other message{considered.length === 1 ? "" : "s"} looked at but not used</summary>
          <ul className="plain stack-sm">{considered.map((m) => <li key={m.id} className="small wrap-anywhere">{m.subject} · {formatDateTime(m.date, tz)} · {m.reasons.map(reason).join(", ")}</li>)}</ul></details>}
      </section>

      <section aria-labelledby="ctx-req-h" className="stack-sm">
        <h3 id="ctx-req-h" className="h4">Requested changes</h3>
        {view.requirements.length === 0 ? <p className="muted">No written edits were found. I will not invent feedback.</p> : (
          <ul className="plain stack-sm">
            {view.requirements.map((r) => (
              <li key={r.id} className="card card-flat">
                <div className="card-head"><span className="wrap-anywhere">{r.text}</span><span className={`badge ${STATUS_TONE[r.status]}`}>{r.status === "applied" || r.status === "already_satisfied" ? <CheckCircle2 size={12} aria-hidden /> : null}{STATUS_TEXT[r.status]}</span></div>
                {r.detail && <p className="small muted">{r.detail}</p>}
                {r.source?.quote && <p className="small muted wrap-anywhere">From: “{r.source.quote}”</p>}
                {canEdit && <button type="button" className="btn btn-ghost btn-sm" disabled={fix.isPending}
                  onClick={() => act({ action: "drop_requirement", revision: detail.task.revision, requirementId: r.id }, "Change dropped. Preparing a new revision.")}>Drop this change</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.temporal && (
        <section aria-labelledby="ctx-time-h" className="stack-sm">
          <h3 id="ctx-time-h" className="h4">How “{view.temporal.phrase}” was read</h3>
          <p>{view.temporal.interpretation}: {formatDateTime(view.temporal.interval.start, view.temporal.timezone)} to {formatDateTime(view.temporal.interval.end, view.temporal.timezone)}.</p>
          <p className="muted small">{view.temporal.basis}</p>
          {view.temporal.alternatives.map((a) => <p key={a.interpretation} className="muted small">Other reading: {a.interpretation}.</p>)}
        </section>
      )}

      {view.retrieval && (
        <section aria-labelledby="ctx-cov-h" className="stack-sm">
          <h3 id="ctx-cov-h" className="h4"><Search size={14} aria-hidden /> What was searched</h3>
          <p className="small">Email history: <strong>{{ complete: "fully read", partial: "partly read", not_authorized: "not authorized", unavailable: "unavailable" }[view.retrieval.coverage.emailHistory]}</strong> · Shared files: <strong>{{ searched: "searched", not_authorized: "not authorized", unavailable: "unavailable" }[view.retrieval.coverage.files]}</strong></p>
          {view.retrieval.coverage.notes.map((n) => <p key={n} className="small muted">{n}</p>)}
          {view.retrieval.limitsReached.length > 0 && <p className="callout callout-warn" role="note"><AlertTriangle size={16} aria-hidden /> The search stopped at {view.retrieval.limitsReached.join(" and ")}. A better match may exist.</p>}
        </section>
      )}

      {view.uncertainties.filter((u) => u.kind === "assumption").length > 0 && (
        <section aria-labelledby="ctx-as-h" className="stack-sm">
          <h3 id="ctx-as-h" className="h4"><Info size={14} aria-hidden /> Assumptions</h3>
          <ul>{view.uncertainties.filter((u) => u.kind === "assumption").map((u, i) => <li key={i} className="wrap-anywhere">{u.text}</li>)}</ul>
        </section>
      )}

      {view.report && (
        <section aria-labelledby="ctx-rep-h" className="stack-sm" data-testid="change-summary">
          <h3 id="ctx-rep-h" className="h4">Change summary</h3>
          <p className="small muted">Edited in place from the original file. {view.report.slides.changed} slide{view.report.slides.changed === 1 ? "" : "s"} changed, {view.report.slides.unchanged} unchanged{view.report.slides.removed ? `, ${view.report.slides.removed} removed` : ""}. The original was not modified.</p>
          <ul>{view.report.summary.map((l, i) => <li key={i} className="wrap-anywhere">{l}</li>)}</ul>
        </section>
      )}

      {view.corrections.length > 0 && <p className="small muted"><ShieldCheck size={14} aria-hidden /> Your corrections: {view.corrections.map((c) => c.label).join(", ")}.</p>}
      {err && <p className="field-error" role="alert">{err}</p>}
      <Corrections detail={detail} view={view} />
      <section className="stack-sm"><h3 className="h4">Limits of this feature</h3><ul className="small muted">{view.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></section>
    </div>
  );
}
