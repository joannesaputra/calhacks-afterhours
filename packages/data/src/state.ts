import type { TaskStatus } from "@afterhours/contracts";
import { invalidTransition } from "./errors";

/** The only place task status transitions are defined. */
const ALLOWED: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["planning"],
  planning: ["running", "needs_input", "skipped", "failed"],
  running: ["ready", "needs_input", "failed"],
  needs_input: ["queued", "dismissed"],
  failed: ["queued", "dismissed"],
  ready: ["approved", "dismissed"],
  skipped: ["dismissed"],
  approved: [],
  dismissed: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus, opts?: { recovery?: boolean; correction?: boolean }): boolean {
  if (opts?.recovery && (from === "planning" || from === "running") && to === "queued") return true;
  // A context correction (different file, removed source, added feedback) re-runs a task that was already ready.
  // Approved and dismissed tasks stay closed.
  if (opts?.correction && from === "ready" && to === "queued") return true;
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus, opts?: { recovery?: boolean; correction?: boolean }): void {
  if (!canTransition(from, to, opts)) throw invalidTransition(from, to);
}
