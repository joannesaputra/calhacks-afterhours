export interface OnceWorker {
  processNextJob(): Promise<boolean>;
  processNextNotification(): Promise<boolean>;
}

/**
 * Test-run control, never used by the normal worker: claim and run at most ONE engine job through the real job lease and
 * terminal commit, then deliver at most one notification. There is no loop and no timer, so a retryable failure is
 * requeued by the normal policy but is never executed a second time by this process.
 */
export async function runOnce(worker: OnceWorker): Promise<{ job: boolean; notification: boolean }> {
  const job = await worker.processNextJob();
  const notification = job ? await worker.processNextNotification() : false;
  return { job, notification };
}
