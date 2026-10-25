import { getIntegrationStatus, pollGmailOnce, type PollDeps, type PollResult } from "@afterhours/data";

export interface PollOnceReport extends PollResult {
  /** Tasks this cycle created, with what the queue will run later. Nothing here has been generated. */
  newTasks: Array<{ id: string; ingestionMode: string; generationMode: string; status: string; receivedAt: string }>;
  queuedJobsBefore: number;
  queuedJobsAfter: number;
  /** A running worker would take the queued jobs (and may bill a live model); reported so the operator can stop it. */
  workerHealthy: boolean;
}

/**
 * Intake-only check (`pnpm gmail:poll-once`): exactly one bounded Gmail poll cycle through the same `pollGmailOnce`
 * the worker uses, with the stored encrypted connection and the current settings. It does not import the engine or
 * the delivery adapter, claims no job and sends nothing: any new task stays queued until a worker runs it.
 */
export async function pollIntakeOnce(deps: PollDeps): Promise<PollOnceReport> {
  const { db } = deps;
  const queued = () => (db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='queued'").get() as { n: number }).n;
  const ids = () => new Set((db.prepare("SELECT id FROM tasks").all() as Array<{ id: string }>).map((row) => row.id));
  const queuedJobsBefore = queued();
  const before = ids();
  const result = await pollGmailOnce(deps);
  const created = [...ids()].filter((id) => !before.has(id));
  const newTasks = created.map((id) => db.prepare(
    `SELECT t.id, t.ingestion_mode AS ingestionMode, t.generation_mode AS generationMode, t.status, m.received_at AS receivedAt
     FROM tasks t JOIN intake_messages m ON m.id = t.intake_id WHERE t.id=?`,
  ).get(id) as PollOnceReport["newTasks"][number]);
  return {
    ...result, newTasks, queuedJobsBefore, queuedJobsAfter: queued(),
    workerHealthy: getIntegrationStatus(db, deps.config, deps.now()).worker.healthy,
  };
}
