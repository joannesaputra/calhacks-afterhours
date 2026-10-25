"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import type { TaskDetail } from "@afterhours/contracts";
import { describeError } from "@/lib/api";
import { isActive } from "@/lib/labels";
import { useDeleteTask } from "@/lib/hooks";
import { useToast } from "./providers";

/** Permanently deletes the task and its work after an explicit confirmation. Refused while a worker is using it. */
export function DeleteTaskControl({ detail }: { detail: TaskDetail }) {
  const { task } = detail;
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const busy = isActive(task.status);
  return (
    <>
      <button
        type="button" className="btn btn-ghost btn-danger-ghost" disabled={busy}
        title={busy ? "This task is being prepared. Delete it once it finishes." : undefined}
        onClick={(e) => { setOpener(e.currentTarget); setOpen(true); }}
      >
        <Trash2 size={16} aria-hidden />Delete task
      </button>
      {open && <DeleteDialog detail={detail} opener={opener} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeleteDialog({ detail, opener, onClose }: { detail: TaskDetail; opener: HTMLElement | null; onClose: () => void }) {
  const { task } = detail;
  const ref = useRef<HTMLDialogElement>(null);
  const del = useDeleteTask(task.id);
  const toast = useToast();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    return () => { if (d.open) d.close(); opener?.focus(); };
  }, [opener]);

  const sent = detail.events.some((e) => e.type === "review" && /^Reply sent to/.test(e.message));
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="delete-title" onCancel={(e) => { e.preventDefault(); if (!del.isPending) onClose(); }}>
      <div className="dialog-body">
        <div className="dialog-head">
          <h2 id="delete-title">Delete this task?</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={del.isPending}><X size={18} aria-hidden /></button>
        </div>
        <p className="wrap-anywhere"><strong>{task.title}</strong></p>
        <p>This permanently removes the request, the plan, {detail.artifacts.length === 1 ? "the 1 file" : `the ${detail.artifacts.length} files`}, the answers and the activity log. It cannot be undone.</p>
        <ul className="small muted">
          <li>The original email in Gmail is not touched, and AfterHours will not create this task from it again.</li>
          {sent && <li>A reply you already sent stays in your Sent folder; deleting here does not unsend it.</li>}
          <li>Email history you allowed AfterHours to read is managed separately in Settings.</li>
        </ul>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="actions">
          <button
            type="button" className="btn btn-danger" disabled={del.isPending}
            onClick={() => {
              setError(null);
              del.mutate(undefined, {
                onSuccess: () => { toast.push("success", "Task deleted."); onClose(); router.replace("/"); },
                onError: (e) => setError(describeError(e)),
              });
            }}
          >
            {del.isPending ? <><Loader2 size={16} className="spin" aria-hidden />Deleting…</> : <><AlertTriangle size={16} aria-hidden />Delete permanently</>}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>Cancel</button>
        </div>
      </div>
    </dialog>
  );
}
