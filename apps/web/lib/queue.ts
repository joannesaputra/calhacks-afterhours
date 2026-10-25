import type { TaskSummary } from "@afterhours/contracts";
import { sortForQueue } from "./labels";

export type SortKey = "recent" | "oldest" | "urgent" | "sender";
export const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "recent", label: "Most recent" },
  { id: "oldest", label: "Oldest first" },
  { id: "urgent", label: "Urgent first" },
  { id: "sender", label: "Sender (A to Z)" },
];
export const parseSort = (v: string | null): SortKey => SORTS.find((s) => s.id === v)?.id ?? "recent";

export const senderLabel = (t: Pick<TaskSummary, "senderName" | "senderEmail">) => t.senderName?.trim() || t.senderEmail;
export const sourceLabel = (mode: TaskSummary["ingestionMode"]) => (mode === "gmail" ? "Gmail" : "Demo email");

/** Urgent = failed, then waiting on your answers, then the nearest due date, then newest. A plan for ordering, not a deadline promise. */
const urgency = (t: TaskSummary) => (t.status === "failed" ? 0 : t.status === "needs_input" ? 1 : 2);

export function sortTasks(tasks: TaskSummary[], key: SortKey): TaskSummary[] {
  const byRecent = (a: TaskSummary, b: TaskSummary) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id);
  const copy = [...tasks];
  switch (key) {
    case "oldest": return copy.sort((a, b) => -byRecent(a, b));
    case "urgent":
      return copy.sort((a, b) => urgency(a) - urgency(b) || (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || byRecent(a, b));
    case "sender":
      return copy.sort((a, b) => senderLabel(a).localeCompare(senderLabel(b)) || a.senderEmail.localeCompare(b.senderEmail) || byRecent(a, b));
    default: return copy.sort(byRecent);
  }
}
export { sortForQueue };
