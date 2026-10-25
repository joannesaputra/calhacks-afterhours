// Intake-only Gmail check (`pnpm gmail:poll-once`): one real poll cycle, no engine, no delivery, no job claim.
// See docs/runbook.md ("Controlled Gmail intake check"). Prints counts and task ids only, never message content.
import { bootstrapDb, clientWithTokens, createGmailApi, loadConfig, loadRootEnv } from "@afterhours/data";
import { pollIntakeOnce } from "./poll-once";

loadRootEnv();
const config = loadConfig();
const db = bootstrapDb(config);
try {
  const report = await pollIntakeOnce({
    db, config, now: () => new Date(),
    makeApi: (tokens, onTokens) => createGmailApi(clientWithTokens(config, tokens, onTokens)),
  });
  console.log(JSON.stringify({ event: "gmail.poll_once.done", ...report }, null, 2));
  if (report.workerHealthy && report.queuedJobsAfter > 0) {
    console.log("WARNING: a worker is running against this database and will process the queued job(s). Stop it if generation is not authorized.");
  }
  process.exitCode = report.status === "error" ? 1 : 0;
} finally {
  db.close();
}
