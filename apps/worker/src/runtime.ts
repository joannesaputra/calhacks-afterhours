import type { Db } from "@afterhours/data";

/** Longer than the compose `stop_grace_period` budget is wasted; shorter than it leaves room to release the lease. */
export const SHUTDOWN_GRACE_MS = 10_000;

/**
 * SIGTERM/SIGINT: stop claiming and polling, give the running job `graceMs` to finish, then abort it and return it to
 * the queue (releasing only a lease this process owns), close the database and exit. A SIGKILL cannot be handled:
 * that case is recovered by lease expiry (see docs/runbook.md).
 */
export function installShutdownHandlers(
  worker: { stop(graceMs?: number): Promise<void> },
  db: Db,
  opts: { graceMs?: number; exit?: (code: number) => void } = {},
): void {
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await worker.stop(opts.graceMs ?? SHUTDOWN_GRACE_MS);
    } finally {
      try { db.close(); } catch { /* already closed */ }
      (opts.exit ?? process.exit)(0);
    }
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}
