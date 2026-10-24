// Consistent backup / verify / restore of the SQLite database plus artifact files. See docs/runbook.md.
//   pnpm backup -- create <outDir>            snapshot while the app runs (SQLite backup API), then copy referenced files
//   pnpm backup -- verify <dir>               integrity + foreign keys + size/SHA-256 of every referenced file
//   pnpm backup -- restore <backupDir> <newDir>   restore into a NEW empty directory, then verify (never over live data)
import { loadConfig, loadRootEnv, openDb, createBackup, restoreBackup, verifyBackup } from "@afterhours/data";
import path from "node:path";

const [cmd, a, b] = process.argv.slice(2).filter((x) => x !== "--");
const fail = (m: string): never => { console.error(m); process.exit(1); };
process.on("uncaughtException", (e) => fail(`backup failed: ${e instanceof Error ? e.message : "unknown error"}`));

if (cmd === "create") {
  if (!a) fail("usage: backup create <outDir>");
  loadRootEnv();
  const config = loadConfig();
  const out = path.resolve(a!);
  if (out.startsWith(config.artifactsDir + path.sep) || out === config.artifactsDir) fail("Refusing: the backup destination is inside the live artifacts directory.");
  const db = openDb(config.databasePath);
  try {
    const m = await createBackup(db, config.artifactsDir, out);
    console.log(`Backup written to ${out}`);
    console.log(JSON.stringify(m.summary));
  } finally { db.close(); }
} else if (cmd === "verify") {
  if (!a) fail("usage: backup verify <dir>");
  const r = verifyBackup(path.resolve(a!));
  console.log(r.ok ? "OK" : "FAIL", JSON.stringify(r.summary));
  for (const p of r.problems) console.log(`  - ${p}`);
  process.exit(r.ok ? 0 : 1);
} else if (cmd === "restore") {
  if (!a || !b) fail("usage: backup restore <backupDir> <newEmptyDir>");
  const r = restoreBackup(path.resolve(a!), path.resolve(b!));
  console.log("Restored and verified:", JSON.stringify(r.summary));
  console.log(`Point DATABASE_PATH at ${path.join(path.resolve(b!), "afterhours.sqlite")} and ARTIFACTS_DIR at ${path.join(path.resolve(b!), "artifacts")}.`);
} else {
  fail("usage: backup create <outDir> | verify <dir> | restore <backupDir> <newEmptyDir>");
}
