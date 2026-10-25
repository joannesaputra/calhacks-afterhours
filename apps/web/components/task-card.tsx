"use client";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { TaskSummary } from "@afterhours/contracts";
import { describeError } from "@/lib/api";
import { formatElapsed, formatRelative } from "@/lib/format";
import { STAGE_LABEL, isActive, isConfigError } from "@/lib/labels";
import { senderLabel } from "@/lib/queue";
import { useNow, useRetry, useTask } from "@/lib/hooks";
import { IngestionBadge, StatusBadge } from "./badges";
import { Avatar, SenderName } from "./sender";
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
      <div className="card-row">
        <Avatar name={senderLabel(task)} email={task.senderEmail} />
        <div className="card-main">
          <h2 className="card-title"><Link href={href} className="card-link">{task.title}</Link></h2>
          <p className="card-meta"><SenderName task={task} /></p>
        </div>
        <div className="card-side">
          <span className="muted card-sent" title="When the original email was sent (taken from the email itself)">Email sent {formatRelative(task.receivedAt, nowMs)}</span>
          <div className="card-badges">
            <StatusBadge status={task.status} workerHealthy={workerHealthy} />
            <IngestionBadge mode={task.ingestionMode} />
            {task.warningCount > 0 && <span className="badge badge-warn"><TriangleAlert size={14} aria-hidden />{task.warningCount} warning{task.warningCount === 1 ? "" : "s"}</span>}
          </div>
        </div>
      </div>

      {isActive(task.status) && <ActiveProgress task={task} />}
      {task.status === "needs_input" && <p className="card-note">Needs your answers before work can continue. The request is missing information.</p>}
      {task.status === "skipped" && <p className="card-note">No action needed. No files were prepared.</p>}
      {task.status === "failed" && (
        <p className="card-note card-note-bad" role="status">
          <strong>{task.error?.code ?? "FAILED"}:</strong> {task.error?.message ?? "Preparation failed."}
        </p>
      )}
      {task.status === "failed" && <FailedActions task={task} />}
    </article>
  );
}
