import { useId } from "react";
import type { TaskSummary } from "@afterhours/contracts";
import { senderLabel } from "@/lib/queue";

const TINTS = ["#3B3560", "#27493A", "#5A3A2A", "#27405E", "#5A2D3C", "#4D4727"];
function initials(name: string): string {
  const parts = name.replace(/<.*>/, "").trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1]![0]! : "")).toUpperCase();
}
function tint(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length]!;
}

/** The sender's picture slot. We have no photo for a sender, so it shows initials; pass `src` to show a real picture when one exists. */
export function Avatar({ name, email, src, size = 44 }: { name: string; email: string; src?: string | null; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="avatar" src={src} alt="" width={size} height={size} />
  ) : (
    <span className="avatar avatar-initials" aria-hidden style={{ width: size, height: size, background: tint(email.toLowerCase()) }}>{initials(name)}</span>
  );
}

/** "From Name". The address appears when you hover or focus the name; with no name the address is shown directly. */
export function SenderName({ task }: { task: Pick<TaskSummary, "senderName" | "senderEmail"> }) {
  const id = useId();
  if (!task.senderName?.trim()) return <span className="sender-name">From {task.senderEmail}</span>;
  return (
    <span className="sender-name sender-hover" tabIndex={0} aria-describedby={id}>
      From {senderLabel(task)}
      <span role="tooltip" id={id} className="sender-tip">{task.senderEmail}</span>
    </span>
  );
}
