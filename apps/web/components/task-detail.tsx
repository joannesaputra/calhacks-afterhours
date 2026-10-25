"use client";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CalendarClock, FileText, Hourglass, MinusCircle, Paperclip } from "lucide-react";
import type { TaskDetail, TaskEvent } from "@afterhours/contracts";
import { formatBytes, formatDateTime, formatElapsed, formatTime } from "@/lib/format";
import { OUTPUT_LABEL, STAGE_LABEL, isActive } from "@/lib/labels";
import { useNow, useSettings, useTask, useTaskContext } from "@/lib/hooks";
import { ContextPhase, ContextUsed } from "./context-panel";
import { ApiError } from "@/lib/api";
import { GenerationBadge, IngestionBadge, StatusBadge } from "./badges";
import { FileCard } from "./files";
import { NotificationRow } from "./notification-row";
import { ProductPreview } from "./preview/product-preview";
import { ClosePanel, EarlierAnswers, FailedPanel, NeedsInputPanel, ReviewPanel } from "./review-panels";
import { useShell } from "./shell";
import { ErrorPanel, NotFoundPanel, SkeletonCards } from "./states";
import { Tabs } from "./tabs";

const sortEvents = (events: TaskEvent[]) =>
  [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

function RequestTab({ detail, tz }: { detail: TaskDetail; tz?: string }) {
  const { email, sources } = detail;
  return (
    <div className="stack-sm">
      <dl className="kv">
        <dt>From</dt><dd className="wrap-anywhere">{email.from.name ? `${email.from.name} <${email.from.email}>` : email.from.email}</dd>
        <dt>To</dt><dd className="wrap-anywhere">{email.to.join(", ") || "—"}</dd>
        <dt>Subject</dt><dd className="wrap-anywhere">{email.subject}</dd>
        <dt>Original email received</dt><dd>{formatDateTime(email.receivedAt, tz)}</dd>
        <dt>Entered the system</dt><dd>{formatDateTime(detail.task.createdAt, tz)}</dd>
      </dl>
      <h3 className="h4">Message</h3>
      <pre className="email-body">{email.bodyText || "(The message had no text body.)"}</pre>
      <h3 className="h4">Attachments</h3>
      {email.attachments.length === 0 ? <p className="muted">No attachments.</p> : (
        <ul className="plain">
          {email.attachments.map((a) => {
            const src = sources.find((s) => s.kind === "attachment" && (s.filename === a.filename));
            const bad = src && src.extractionStatus !== "complete";
            return (
              <li key={a.id} className="attach">
                <Paperclip size={16} aria-hidden />
                <span className="wrap-anywhere">{a.filename}</span>
                <span className="muted small">{a.mimeType} · {formatBytes(a.sizeBytes)}</span>
                {bad && <span className="badge badge-warn"><AlertTriangle size={14} aria-hidden />{src.extractionStatus === "unsupported" ? "Could not be read (unsupported)" : "Extraction failed"}</span>}
                {src && !bad && <span className="badge badge-neutral">Read</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PlanTab({ detail, tz }: { detail: TaskDetail; tz?: string }) {
  const { plan, task } = detail;
  if (!plan) {
    return (
      <p className="muted" role="status">
        {isActive(task.status)
          ? "No plan yet. The plan appears here as soon as AfterHours has read the request."
          : "No plan was recorded for this task."}
      </p>
    );
  }
  return (
    <div className="stack-sm">
      <h3 className="h4">Request summary</h3>
      <p>{plan.requestSummary}</p>
      <h3 className="h4">Requested outputs</h3>
      <p>{plan.requestedOutputs.length ? plan.requestedOutputs.map((o) => OUTPUT_LABEL[o]).join(", ") : "None identified."}</p>
      <h3 className="h4">Due date</h3>
      <p>{plan.dueAt ? formatDateTime(plan.dueAt, tz) : "No due date was stated."}{plan.dueAtExplanation ? ` ${plan.dueAtExplanation}` : ""}</p>
      {plan.steps.length > 0 && (<><h3 className="h4">Steps</h3><ol>{plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></>)}
      {plan.assumptions.length > 0 && (<><h3 className="h4">Assumptions</h3><ul>{plan.assumptions.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
      {detail.answers.length > 0 && task.status !== "needs_input" && <EarlierAnswers detail={detail} title="Your answers" all />}
      {plan.questions.length > 0 && (
        <>
          <h3 className="h4">Questions</h3>
          <ul>{plan.questions.map((q) => <li key={q.id}><strong>{q.question}</strong>{q.required ? " (required)" : ""}<span className="muted block small">{q.reason}</span></li>)}</ul>
        </>
      )}
    </div>
  );
}

function SourcesTab({ detail }: { detail: TaskDetail }) {
  if (detail.sources.length === 0) return <p className="muted">No sources have been read yet.</p>;
  return (
    <ul className="plain stack-sm">
      {detail.sources.map((s) => (
        <li key={s.id} className="card card-flat">
          <div className="card-head">
            <strong className="wrap-anywhere">{s.title}</strong>
            {s.extractionStatus === "complete"
              ? <span className="badge badge-neutral">Read</span>
              : <span className="badge badge-warn"><AlertTriangle size={14} aria-hidden />{s.extractionStatus === "unsupported" ? "Unsupported, not read" : "Extraction failed"}</span>}
          </div>
          <p className="muted small">
            {s.kind === "email" ? "Email" : s.kind === "attachment" ? "Attachment" : s.kind === "organization" ? "Organization profile" : "Your answer"}
            {s.filename ? ` · ${s.filename}` : ""} · {s.mimeType}
          </p>
          {s.warnings.length > 0 && <ul className="small">{s.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {s.extractionStatus === "complete" && s.text && (
            <details><summary>Show extracted text</summary><pre className="email-body">{s.text}</pre></details>
          )}
        </li>
      ))}
    </ul>
  );
}

function ActivityTab({ detail, tz }: { detail: TaskDetail; tz?: string }) {
  const events = sortEvents(detail.events);
  if (events.length === 0) return <p className="muted">No activity has been recorded yet.</p>;
  return (
    <ol className="timeline">
      {events.map((e) => (
        <li key={e.id} className={`tl tl-${e.type}`}>
          <span className="tl-time">{formatTime(e.createdAt, tz)}</span>
          <span className="tl-body">
            <strong>{STAGE_LABEL[e.stage]}</strong>
            {e.type === "warning" && <span className="badge badge-warn"><AlertTriangle size={12} aria-hidden />Warning</span>}
            {e.type === "error" && <span className="badge badge-bad"><AlertTriangle size={12} aria-hidden />Error</span>}
            <span className="muted small"> · revision {e.revision}</span>
            <span className="block wrap-anywhere">{e.message}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** When the files were prepared, from the persisted event written at the ready commit. Null when no such event exists. */
export function preparedAtOf(detail: TaskDetail): string | null {
  const ready = sortEvents(detail.events.filter((e) => e.revision === detail.task.revision && e.type === "status" && e.stage === "export")).at(-1);
  return ready?.createdAt ?? null;
}

function NotificationsTab({ detail, tz }: { detail: TaskDetail; tz?: string }) {
  if (detail.notifications.length === 0) return <p className="muted">No notification has been created for this task yet.</p>;
  const preparedAt = ["ready", "approved", "dismissed"].includes(detail.task.status) ? preparedAtOf(detail) : undefined;
  return (
    <div className="stack-sm">
      <p className="muted small">Preparing the files and notifying you are separate. A notification problem never removes the files above.</p>
      {detail.notifications.map((n) => <NotificationRow key={n.id} record={n} timeZone={tz} preparedAt={preparedAt} />)}
    </div>
  );
}

function ActiveProgress({ detail, tz, phaseLabel }: { detail: TaskDetail; tz?: string; phaseLabel?: string | null }) {
  const { workerHealthy } = useShell();
  const now = useNow(workerHealthy);
  const latest = sortEvents(detail.events.filter((e) => e.revision === detail.task.revision)).at(-1);
  return (
    <section className="panel" aria-labelledby="prog-h" aria-live="polite">
      <Hourglass size={22} aria-hidden />
      <div>
        <h2 id="prog-h" className="h3">{!workerHealthy ? "Waiting for the worker" : phaseLabel ?? "AfterHours is preparing this work"}</h2>
        {!workerHealthy && <p>The worker is not reporting a heartbeat, so this task will not progress until it starts.</p>}
        {latest && <p><strong>{STAGE_LABEL[latest.stage]}:</strong> {latest.message} <span className="muted small">({formatTime(latest.createdAt, tz)})</span></p>}
        <p className="muted small">{formatElapsed(detail.task.createdAt, now)} since the request arrived. Progress comes from the persisted activity log; no estimate is shown.</p>
      </div>
    </section>
  );
}

export function TaskDetailView({ id }: { id: string }) {
  const q = useTask(id);
  const ctxQuery = useTaskContext(id, !q.data || isActive(q.data.task.status));
  const ctx = ctxQuery.data ?? null;
  const { workerHealthy } = useShell();
  const settings = useSettings();
  const tz = settings.data?.organization.timezone;

  if (q.isPending) return <SkeletonCards count={2} />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundPanel />;
    return <ErrorPanel error={q.error} title="Could not load this task" onRetry={() => void q.refetch()} />;
  }
  const detail = q.data;
  const { task } = detail;
  const revisionEvents = detail.events.filter((e) => e.revision === task.revision);
  const warnings = [
    ...detail.products.flatMap((p) => p.warnings),
    ...revisionEvents.filter((e) => e.type === "warning").map((e) => e.message),
    ...detail.sources.filter((s) => s.extractionStatus !== "complete").map((s) => `${s.title} could not be read (${s.extractionStatus}).`),
  ].filter((w, i, a) => a.indexOf(w) === i);
  const hasFiles = detail.artifacts.length > 0;
  const showResult = detail.products.length > 0 && ["ready", "approved", "dismissed"].includes(task.status);
  const due = detail.plan?.dueAt ?? task.dueAt;

  return (
    <>
      <p><Link href="/" className="link-inline"><ArrowLeft size={16} aria-hidden />Back to the work queue</Link></p>
      <div className="page-head">
        <div className="grow">
          <h1 className="wrap-anywhere">{task.title}</h1>
          <p className="muted small" data-testid="task-times">
            Revision {task.revision} · <span>Entered the system {formatDateTime(task.createdAt, tz)}</span> · <span>Original email received {formatDateTime(detail.email.receivedAt, tz)}</span>
          </p>
        </div>
      </div>
      <div className="chips">
        <StatusBadge status={task.status} workerHealthy={workerHealthy} />
        {ctx && ctx.phase !== "not_applicable" && <ContextPhase view={ctx} />}
        <IngestionBadge mode={task.ingestionMode} />
        <GenerationBadge mode={task.generationMode} />
      </div>

      <dl className="summary">
        <div><dt>Requested outputs</dt><dd>{task.requestedOutputs.length ? task.requestedOutputs.map((o) => OUTPUT_LABEL[o]).join(", ") : "None identified"}</dd></div>
        <div><dt><CalendarClock size={14} aria-hidden /> Due</dt><dd>{due ? formatDateTime(due, tz) : "Not stated"}{detail.plan?.dueAtExplanation ? <span className="muted small block">{detail.plan.dueAtExplanation}</span> : null}</dd></div>
        <div><dt><FileText size={14} aria-hidden /> Files</dt><dd>{task.artifactCount}</dd></div>
        <div><dt><AlertTriangle size={14} aria-hidden /> Warnings</dt><dd>{warnings.length}{task.warningCount > warnings.length ? ` (${task.warningCount} recorded)` : ""}</dd></div>
      </dl>

      {warnings.length > 0 && (
        <div className="callout callout-warn" role="note">
          <AlertTriangle size={16} aria-hidden />
          <div><strong>Check before relying on this result</strong><ul>{warnings.slice(0, 6).map((w, i) => <li key={i} className="wrap-anywhere">{w}</li>)}</ul></div>
        </div>
      )}

      {isActive(task.status) && <ActiveProgress detail={detail} tz={tz} phaseLabel={ctx && ctx.phase !== "not_applicable" ? ctx.phaseLabel : null} />}
      {ctx && ctx.phase === "error" && task.status === "failed" && <p className="muted small" role="note">{ctx.failureDetail}</p>}
      {task.status === "needs_input" && <NeedsInputPanel detail={detail} />}
      {task.status === "failed" && <FailedPanel detail={detail} />}
      {task.status === "skipped" && (
        <section className="panel panel-empty">
          <MinusCircle size={22} aria-hidden />
          <div>
            <h2 className="h3">No action needed</h2>
            <p>{sortEvents(revisionEvents).at(-1)?.message ?? "AfterHours did not find work to prepare in this message."} No files were prepared and nothing was sent.</p>
          </div>
        </section>
      )}
      <ClosePanel detail={detail} />

      {hasFiles && (
        <section aria-labelledby="files-h" className="stack-sm">
          <h2 id="files-h" className="h3">Files</h2>
          {detail.artifacts.map((a) => <FileCard key={a.id} artifact={a} revision={a.revision} />)}
          {task.status === "ready" && <p className="small"><a href="#review">Jump to review actions</a></p>}
        </section>
      )}
      {!hasFiles && showResult && (
        <p className="callout callout-warn" role="note"><AlertTriangle size={16} aria-hidden /> The content is shown below, but no downloadable files are recorded for this revision.</p>
      )}

      {showResult && <ProductPreview key={`${task.id}-${task.revision}`} products={detail.products} sources={detail.sources} />}
      <ReviewPanel detail={detail} timeZone={tz} />

      <section aria-label="Details" className="details-tabs">
        <Tabs
          label="Task details"
          items={[
            { id: "request", label: "Original request", content: <RequestTab detail={detail} tz={tz} /> },
            ...(ctx && ctx.phase !== "not_applicable" ? [{ id: "context", label: "Context used", content: <ContextUsed detail={detail} view={ctx} tz={tz} /> }] : []),
            { id: "plan", label: "Plan", content: <PlanTab detail={detail} tz={tz} /> },
            { id: "sources", label: `Sources (${detail.sources.length})`, content: <SourcesTab detail={detail} /> },
            { id: "activity", label: `Activity (${detail.events.length})`, content: <ActivityTab detail={detail} tz={tz} /> },
            { id: "notifications", label: `Notifications (${detail.notifications.length})`, content: <NotificationsTab detail={detail} tz={tz} /> },
          ]}
        />
      </section>
    </>
  );
}
