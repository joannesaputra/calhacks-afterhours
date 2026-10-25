"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Send, X } from "lucide-react";
import type { ReplyView, TaskDetail } from "@afterhours/contracts";
import { describeError } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { useReply, useSendReply } from "@/lib/hooks";
import { useToast } from "./providers";

/**
 * "Send back" after review. Marking reviewed still sends nothing; this is a separate, explicit action that emails the
 * prepared files to the original sender, from the connected Gmail account, after the user confirms the exact message.
 */
export function ReplyPanel({ detail, timeZone }: { detail: TaskDetail; timeZone?: string }) {
  const { task } = detail;
  const q = useReply(task.id, task.status === "approved");
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  if (task.status !== "approved") return null;
  const v = q.data;
  return (
    <section className="panel" aria-labelledby="reply-h" data-testid="reply-panel">
      <Send size={22} aria-hidden />
      <div className="grow">
        <h2 id="reply-h" className="h3">Send back to the sender</h2>
        {q.isPending && <p className="muted" role="status">Checking whether this can be sent…</p>}
        {q.isError && <p className="field-error" role="alert">Could not load the reply options. {describeError(q.error)}</p>}
        {v && <ReplyBody view={v} timeZone={timeZone} onOpen={(el) => { setOpener(el); setOpen(true); }} />}
      </div>
      {open && v && <ReplyDialog view={v} taskId={task.id} opener={opener} onClose={() => setOpen(false)} />}
    </section>
  );
}

function ReplyBody({ view, timeZone, onOpen }: { view: ReplyView; timeZone?: string; onOpen: (el: HTMLElement) => void }) {
  const last = view.last;
  return (
    <>
      <p className="muted">Email the reviewed {view.attachments.length === 1 ? "file" : "files"} to <strong className="wrap-anywhere">{view.to}</strong>, the person who asked. You see the exact message before anything is sent, and it sends once.</p>
      {last?.status === "sent" && (
        <p className="small good" role="status"><CheckCircle2 size={14} aria-hidden /> Sent to {last.to} on {formatDateTime(last.at, timeZone)}.</p>
      )}
      {last?.status === "failed" && last.error && <p className="small bad" role="note"><AlertTriangle size={14} aria-hidden /> The last attempt failed: {last.error}</p>}
      {last?.uncertain && (
        <p className="callout callout-warn" role="alert"><AlertTriangle size={16} aria-hidden /> An earlier attempt never finished, so it may already have gone out. Check your Sent folder before sending again.</p>
      )}
      {!view.available && view.reason && last?.status !== "sent" && <p className="muted small" role="note" data-testid="reply-reason">{view.reason}</p>}
      <div className="actions">
        {view.available && (
          <button type="button" className="btn btn-primary" onClick={(e) => onOpen(e.currentTarget)}>
            <Send size={16} aria-hidden />Send reply to {view.to}…
          </button>
        )}
        {view.needsSendPermission && (
          <a className="btn btn-secondary" href="/api/integrations/gmail/start?send=1">Allow sending replies</a>
        )}
      </div>
    </>
  );
}

function ReplyDialog({ view, taskId, opener, onClose }: { view: ReplyView; taskId: string; opener: HTMLElement | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const send = useSendReply(taskId);
  const toast = useToast();
  const [body, setBody] = useState(view.defaultBody);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(view.attachments.map((a) => a.id)));
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    return () => { if (d.open) d.close(); opener?.focus(); };
  }, [opener]);

  const total = view.attachments.filter((a) => picked.has(a.id)).reduce((n, a) => n + a.sizeBytes, 0);
  const needsConfirm = view.last?.uncertain === true;
  const canSend = picked.size > 0 && body.trim().length > 0 && body.length <= 5000 && (!needsConfirm || confirmed) && !send.isPending;

  return (
    <dialog
      ref={ref} className="dialog dialog-wide" aria-labelledby="reply-title"
      onCancel={(e) => { e.preventDefault(); if (!send.isPending) onClose(); }}
    >
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSend) return;
          setError(null);
          send.mutate(
            { revision: view.revision, body, artifactIds: [...picked], ...(needsConfirm ? { confirmResend: true } : {}) },
            {
              onSuccess: () => { toast.push("success", `Reply sent to ${view.to}.`); onClose(); },
              onError: (err) => setError(describeError(err)),
            },
          );
        }}
      >
        <div className="dialog-head">
          <h2 id="reply-title">Send reply</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={send.isPending}><X size={18} aria-hidden /></button>
        </div>
        <dl className="kv">
          <dt>From</dt><dd className="wrap-anywhere">{view.from ?? "—"}</dd>
          <dt>To</dt><dd className="wrap-anywhere">{view.to}</dd>
          <dt>Subject</dt><dd className="wrap-anywhere">{view.subject}</dd>
        </dl>
        <div className="field">
          <label htmlFor="reply-body">Message</label>
          <textarea id="reply-body" rows={7} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
        </div>
        <fieldset className="field">
          <legend>Attachments ({formatBytes(total)})</legend>
          {view.attachments.map((a) => (
            <label key={a.id} className="check">
              <input
                type="checkbox" checked={picked.has(a.id)}
                onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n; })}
              /> <span className="wrap-anywhere">{a.filename}</span> <span className="muted small">{formatBytes(a.sizeBytes)}</span>
            </label>
          ))}
        </fieldset>
        {needsConfirm && (
          <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> <span>I checked my Sent folder and still want to send this.</span></label>
        )}
        <p className="callout callout-warn" role="note"><AlertTriangle size={16} aria-hidden /> This sends a real email from {view.from ?? "your Gmail account"} to {view.to}. It cannot be recalled.</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={!canSend}>
            {send.isPending ? <><Loader2 size={16} className="spin" aria-hidden />Sending…</> : <><Send size={16} aria-hidden />Send email</>}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={send.isPending}>Cancel</button>
        </div>
      </form>
    </dialog>
  );
}
