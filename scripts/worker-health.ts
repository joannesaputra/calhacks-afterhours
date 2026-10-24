// Container health probe for the worker (it has no HTTP port): exit 0 when its heartbeat in the database is fresh.
// Reads the database only; makes no network or provider calls.
import { getIntegrationStatus, loadConfig, loadRootEnv, openDb } from "@afterhours/data";

loadRootEnv();
try {
  const config = loadConfig();
  const db = openDb(config.databasePath);
  const w = getIntegrationStatus(db, config, new Date()).worker;
  db.close();
  console.log(w.healthy ? `worker healthy (last heartbeat ${w.lastHeartbeatAt})` : `worker stale (last heartbeat ${w.lastHeartbeatAt ?? "never"})`);
  process.exit(w.healthy ? 0 : 1);
} catch (e) {
  console.error(`health probe failed: ${(e as Error).name}`);
  process.exit(1);
}
