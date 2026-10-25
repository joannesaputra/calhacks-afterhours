"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertTriangle, BadgeCheck, CircleHelp, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { TaskDetail, WorkAnswer } from "@afterhours/contracts";
import { ApiError, describeError, isStale } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { isConfigError } from "@/lib/labels";
import { keys, useRetry, useReview, useSubmitAnswers } from "@/lib/hooks";
import { useToast } from "./providers";

function StaleBanner({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      await qc.refetchQueries({ queryKey: keys.task(taskId) });
      await qc.invalidateQueries({ queryKey: keys.tasks });
    } finally {
      setBusy(false);
      onDone();
    }
  }
  return (
    <div className="banner banner-warn" role="alert">
      <AlertTriangle size={18} aria-hidden />
      <div>
        <strong>This task changed. Refresh to review the latest version.</strong>
        <p className="small">Your action was not applied. Review the current revision before deciding.</p>
        <button type="button" className="btn btn-secondary" onClick={refresh} disabled={busy}><RefreshCw size={16} aria-hidden />Refresh</button>
      </div>
    </div>
  );
}

function DismissControl({ detail, label = "Dismiss", onStale }: { detail: TaskDetail; label?: string; onStale: () => void }) {
  const review = useReview(detail.task.id);
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirming) {
    return <button type="button" className="btn btn-ghost" onClick={() => setConfirming(true)}>{label}</button>;
  }
  return (
    <div className="inline-confirm" role="group" aria-label="Confirm dismiss">
      <span className="small">Dismiss this task? This cannot be undone.</span>
      <button
        type="button" className="btn btn-danger" disabled={review.isPending}
        onClick={() =>
          review.mutate({ revision: detail.task.revision, action: "dismiss" }, {
            onSuccess: () => { toast.push("success", "Task dismissed."); setConfirming(false); },
            onError: (e) => { if (isStale(e)) { onStale(); setConfirming(false); } else setError(describeError(e)); },
          })
        }
      >
        {review.isPending ? "Dismissing…" : "Yes, dismiss"}
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={review.isPending}>Cancel</button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

/** Review actions for a ready revision, and the terminal state afterwards. */
export function ReviewPanel({ detail, timeZone }: { detail: TaskDetail; timeZone?: string }) {
  const { task } = detail;
  const review = useReview(task.id);
  const toast = useToast();
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (task.status === "approved") {
    const ev = [...detail.events].filter((e) => e.type === "review").at(-1);
    return (
      <section className="panel panel-good" aria-labelledby="review-h">
        <BadgeCheck size={22} aria-hidden />
        <div>
          <h2 id="review-h" className="h3">Marked reviewed</h2>
          <p>You marked revision {task.revision} as reviewed{ev ? ` on ${formatDateTime(ev.createdAt, timeZone)}` : ""}. This records your acceptance only. Nothing was sent to anyone.</p>
        </div>
      </section>
    );
  }
  if (task.status === "dismissed") {
    return (
      <section className="panel panel-empty" aria-labelledby="review-h">
        <XCircle size={22} aria-hidden />
        <div><h2 id="review-h" className="h3">Dismissed</h2><p>This task was dismissed and is closed.</p></div>
      </section>
    );
  }
  if (task.status !== "ready") return null;

  return (
    <section className="panel" aria-labelledby="review-h" id="review">
      <div className="grow">
        <h2 id="review-h" className="h3">Review revision {task.revision}</h2>
        <p className="muted">“Mark reviewed” records that you accepted this revision. It does not send the files to anyone, submit anything, or contact the sender.</p>
        {stale && <StaleBanner taskId={task.id} onDone={() => setStale(false)} />}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="actions">
          <button
            type="button" className="btn btn-primary" disabled={review.isPending || stale}
            onClick={() => {
              setError(null);
              review.mutate({ revision: task.revision, action: "approve" }, {
                onSuccess: () => toast.push("success", "Marked reviewed. Nothing was sent."),
                onError: (e) => { if (isStale(e)) setStale(true); else setError(describeError(e)); },
              });
            }}
          >
            {review.isPending ? <><Loader2 size={16} className="spin" aria-hidden />Saving…</> : "Mark reviewed"}
          </button>
          <DismissControl detail={detail} onStale={() => setStale(true)} />
        </div>
      </div>
    </section>
  );
}

/** Dismiss control for needs_input, failed, and skipped tasks. */
export function ClosePanel({ detail }: { detail: TaskDetail }) {
  const [stale, setStale] = useState(false);
  if (!["needs_input", "failed", "skipped"].includes(detail.task.status)) return null;
  return (
    <div className="actions">
      {stale && <StaleBanner taskId={detail.task.id} onDone={() => setStale(false)} />}
      <DismissControl detail={detail} label="Dismiss this task" onStale={() => setStale(true)} />
    </div>
  );
}

const MAX_ANSWER = 2000;

/** Answers the user gave in earlier rounds, shown with the question text when the current plan still carries it. */
export function EarlierAnswers({ detail, title = "Your earlier answers", all = false }: { detail: TaskDetail; title?: string; all?: boolean }) {
  const known = new Map((detail.plan?.questions ?? []).map((q) => [q.id, q.question]));
  const current = new Set(detail.questions.map((q) => q.id));
  const rows = all ? detail.answers : detail.answers.filter((a) => !current.has(a.questionId));
  if (rows.length === 0) return null;
  return (
    <div className="earlier-answers">
      <h3 className="h4">{title}</h3>
      <ul className="plain stack-sm">
        {rows.map((a) => (
          <li key={a.questionId} className="card card-flat">
            <p className="muted small">{known.get(a.questionId) ?? `Earlier question (${a.questionId})`}</p>
            <p className="wrap-anywhere">{a.answer}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NeedsInputPanel({ detail }: { detail: TaskDetail }) {
  const { task } = detail;
  const questions = detail.questions.length > 0 ? detail.questions : detail.plan?.questions ?? [];
  const submit = useSubmitAnswers(task.id);
  const toast = useToast();
  // Only what the user typed lives here. Retained server answers fill the fields the user has not touched, so a
  // background refresh or a new revision never discards unsent text.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const retained = new Map(detail.answers.map((a) => [a.questionId, a.answer]));
  const valueOf = (id: string) => edits[id] ?? retained.get(id) ?? "";
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);
  const firstRevision = useRef(task.revision);
  const revisionChanged = task.revision !== firstRevision.current;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const errs: Record<string, string> = {};
    for (const q of questions) {
      const v = valueOf(q.id).trim();
      if (q.required && !v) errs[q.id] = "This answer is required.";
      else if (v.length > MAX_ANSWER) errs[q.id] = `Keep this under ${MAX_ANSWER} characters.`;
    }
    setFieldErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length > 0) return;
    const answers: WorkAnswer[] = questions
      .map((q) => ({ questionId: q.id, answer: valueOf(q.id).trim() }))
      .filter((a) => a.answer.length > 0);
    if (answers.length === 0) { setFormError("Answer at least one question."); return; }
    inFlight.current = true;
    submit.mutate({ revision: task.revision, answers }, {
      onSuccess: () => toast.push("success", "Answers submitted. Preparation is resuming as a new revision."),
      onError: (err) => {
        if (isStale(err)) setStale(true);
        else setFormError(err instanceof ApiError && err.status === 400 ? `The server rejected the answers: ${err.message}` : describeError(err));
      },
      onSettled: () => { inFlight.current = false; },
    });
  }

  return (
    <section className="panel panel-warn" aria-labelledby="ni-h">
      <CircleHelp size={22} aria-hidden />
      <form onSubmit={onSubmit} className="grow" noValidate>
        <h2 id="ni-h" className="h3">AfterHours needs a few answers</h2>
        <p className="muted">The request is missing information that affects the work. Your answers create a new revision and preparation resumes. Earlier answers stay on record.</p>
        {revisionChanged && (
          <p className="banner banner-info" role="status">This task moved to revision {task.revision}. Check the questions below; your unsent text was kept.</p>
        )}
        {stale && <StaleBanner taskId={task.id} onDone={() => setStale(false)} />}
        {questions.length === 0 && <p>No specific questions were recorded. Open the Plan tab for details.</p>}
        {questions.map((q) => {
          const err = fieldErrors[q.id];
          return (
            <div className="field" key={q.id}>
              <label id={`q-${q.id}-l`} htmlFor={q.options?.length ? undefined : `q-${q.id}`}>{q.question} {q.required ? <span className="req">Required</span> : <span className="muted small">Optional</span>}</label>
              <p className="muted small" id={`why-${q.id}`}>Why we ask: {q.reason}</p>
              {q.options && q.options.length > 0 ? (
                <div role="radiogroup" aria-labelledby={`q-${q.id}-l`} aria-describedby={`why-${q.id}${err ? ` err-${q.id}` : ""}`} className="stack-sm">
                  {q.options.map((o) => (
                    <label key={o.id} className="card card-flat option" htmlFor={`q-${q.id}-${o.id}`}>
                      <span><input type="radio" id={`q-${q.id}-${o.id}`} name={`q-${q.id}`} value={o.id} checked={valueOf(q.id) === o.id} onChange={() => setEdits((v) => ({ ...v, [q.id]: o.id }))} /> <strong className="wrap-anywhere">{o.label}</strong></span>
                      <span className="muted small wrap-anywhere">{o.detail}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <textarea
                  id={`q-${q.id}`} rows={3} maxLength={MAX_ANSWER + 200} value={valueOf(q.id)}
                  onChange={(e) => setEdits((v) => ({ ...v, [q.id]: e.target.value }))}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={`why-${q.id}${err ? ` err-${q.id}` : ""}`}
                />
              )}
              {err && <p id={`err-${q.id}`} className="field-error" role="alert">{err}</p>}
            </div>
          );
        })}
        {formError && <p className="field-error" role="alert">{formError}</p>}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={submit.isPending || stale || questions.length === 0}>
            {submit.isPending ? <><Loader2 size={16} className="spin" aria-hidden />Submitting…</> : "Submit answers and resume"}
          </button>
        </div>
        <EarlierAnswers detail={detail} />
      </form>
    </section>
  );
}

export function FailedPanel({ detail }: { detail: TaskDetail }) {
  const { task } = detail;
  const retry = useRetry(task.id);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);
  const config = isConfigError(task.error?.code);
  return (
    <section className="panel panel-error" aria-labelledby="fail-h">
      <AlertTriangle size={22} aria-hidden />
      <div className="grow">
        <h2 id="fail-h" className="h3">Preparation failed</h2>
        <p><strong>{task.error?.code ?? "FAILED"}</strong>: {task.error?.message ?? "No further detail was recorded."}</p>
        {config && (
          <div className="callout callout-warn">
            <p>
              This is a server configuration problem, so retrying alone will not fix it. Review the model settings in{" "}
              <Link href="/settings">Settings</Link>, fix the server environment, restart the services, then retry.
            </p>
          </div>
        )}
        {!config && task.error && !task.error.retryable && <p className="muted small">This kind of failure usually repeats until the cause is fixed.</p>}
        {!config && task.error?.retryable && <p className="muted small">This looked temporary, but the automatic retries were used up. A manual retry starts a new revision.</p>}
        {stale && <StaleBanner taskId={task.id} onDone={() => setStale(false)} />}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="actions">
          <button
            type="button" className="btn btn-primary" disabled={retry.isPending || stale}
            onClick={() => {
              if (inFlight.current) return;
              inFlight.current = true;
              setError(null);
              retry.mutate({ revision: task.revision }, {
                onSuccess: () => toast.push("success", "Retry queued as a new revision."),
                onError: (e) => { if (isStale(e)) setStale(true); else setError(describeError(e)); },
                onSettled: () => { inFlight.current = false; },
              });
            }}
          >
            {retry.isPending ? <><Loader2 size={16} className="spin" aria-hidden />Retrying…</> : "Retry preparation"}
          </button>
        </div>
      </div>
    </section>
  );
}
