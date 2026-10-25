"use client";
import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import type { TaskSummary } from "@afterhours/contracts";
import { describeError } from "@/lib/api";
import { formatElapsed, formatRelative } from "@/lib/format";
import { OUTPUT_LABEL, STAGE_LABEL, isActive, isConfigError } from "@/lib/labels";
import { useNow, useRetry, useTask } from "@/lib/hooks";
import { StatusBadge } from "./badges";
import { useShell } from "./shell";
import { useToast } from "./providers";

function ActiveProgress({ task }: { task: TaskSummary }) {
  const { workerHealthy } = useShell();
  const detail = useTask(task.id);
  const now = useNow(workerHealthy);
  const latest = [...(detail.data?.events ?? [])]
    .filter((e) => e.revision === task.revision)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .at(-1);
  if (!workerHealthy && task.status === "queued") {
    return <p className="card-note" role="status">Waiting for the worker to start. It is not reporting a heartbeat.</p>;
  }
  return (
    <p className="card-note" role="status">
      {latest ? `${STAGE_LABEL[latest.stage]}: ${latest.message}` : task.status === "queued" ? "Queued. Waiting for the worker to pick it up." : "Working…"}
      <span className="muted"> · {formatElapsed(task.createdAt, now)} elapsed</span>
    </p>
  );
}

function FailedActions({ task }: { task: TaskSummary }) {
  const retry = useRetry(task.id);
  const toast = useToast();
  const config = isConfigError(task.error?.code);
  return (
    <div className="card-actions">
      {config ? (
        <Link href="/settings" className="btn btn-secondary">Check settings</Link>
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={retry.isPending}
          onClick={() =>
            retry.mutate({ revision: task.revision }, {
              onSuccess: () => toast.push("success", "Retry queued as a new revision."),
              onError: (e) => toast.push("error", describeError(e)),
            })
          }
        >
          {retry.isPending ? "Retrying…" : "Retry preparation"}
        </button>
      )}
      <Link href={`/tasks/${encodeURIComponent(task.id)}`} className="link-inline">Details</Link>
    </div>
  );
}

export function TaskCard({ task, nowMs }: { task: TaskSummary; nowMs: number }) {
  const href = `/tasks/${encodeURIComponent(task.id)}`;
  const { workerHealthy } = useShell();
  return (
    <article className={`card task-card status-${task.status}`} aria-label={task.title}>
      <div className="card-head">
        <h2 className="card-title"><Link href={href}>{task.title}</Link></h2>
        <StatusBadge status={task.status} workerHealthy={workerHealthy} />
      </div>
      <p className="card-meta">
        <span className="muted" title="When the original email was sent (taken from the email itself)">Email sent {formatRelative(task.receivedAt, nowMs)}</span>
      </p>
      <div className="chips">
        {task.requestedOutputs.map((o) => <span key={o} className="badge badge-neutral">{OUTPUT_LABEL[o]}</span>)}
        {task.warningCount > 0 && <span className="badge badge-warn"><TriangleAlert size={14} aria-hidden />{task.warningCount} warning{task.warningCount === 1 ? "" : "s"}</span>}
      </div>

      {isActive(task.status) && <ActiveProgress task={task} />}
      {task.status === "needs_input" && <p className="card-note">Needs your answers before work can continue. The request is missing information.</p>}
      {task.status === "skipped" && <p className="card-note">No action needed. No files were prepared.</p>}
      {task.status === "failed" && (
        <p className="card-note card-note-bad" role="status">
          <strong>{task.error?.code ?? "FAILED"}:</strong> {task.error?.message ?? "Preparation failed."}
        </p>
      )}

      <div className="card-actions">
        {task.status === "ready" && <Link href={href} className="btn btn-primary">Review work<ArrowRight size={16} aria-hidden /></Link>}
        {task.status === "needs_input" && <Link href={href} className="btn btn-primary">Answer questions<ArrowRight size={16} aria-hidden /></Link>}
        {(task.status === "approved" || task.status === "dismissed" || task.status === "skipped" || isActive(task.status)) && (
          <Link href={href} className="link-inline">Open<ArrowRight size={14} aria-hidden /></Link>
        )}
      </div>
      {task.status === "failed" && <FailedActions task={task} />}
    </article>
  );
}
