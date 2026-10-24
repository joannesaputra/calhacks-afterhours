// Child process for batch5.test.ts: a REAL worker process (real signal handlers, real SQLite file) with a fake engine.
// usage: worker-child <block|freeze-after-promote> [graceMs]
//  block                 the engine starts and waits (until aborted by shutdown).
//  freeze-after-promote  the engine returns a ready result; after the files are promoted the process freezes before
//                        the DB commit, so the parent can SIGKILL it exactly at that boundary.
import { bootstrapDb, findRepoRoot, loadConfig } from "@afterhours/data";
import { officeBytes, readyResult, testPlan } from "@afterhours/data/testing";
import { consoleLogger } from "../../src/log";
import { installShutdownHandlers } from "../../src/runtime";
import { createWorker } from "../../src/worker";

const mode = process.argv[2] ?? "block";
const graceMs = Number(process.argv[3] ?? 300);
const config = loadConfig(process.env, findRepoRoot(import.meta.dirname));
const db = bootstrapDb(config);
const worker = createWorker({
  db, config, workerId: `child-${process.pid}`, log: consoleLogger,
  sendNotification: async () => ({ state: "simulated", message: "child", providerMessageId: null, reason: null }),
  runWork: async (input, deps) => {
    await deps.onProgress({ stage: "plan", message: "child: engine started", plan: testPlan() });
    if (mode === "block") {
      await new Promise<void>((_, reject) => deps.signal.addEventListener("abort", () => reject(new Error("aborted by shutdown"))));
    }
    await deps.onProgress({ stage: "generate", message: "child: generating" });
    const r = readyResult(input);
    return { ...r, files: r.files.map((f) => ({ ...f, bytes: officeBytes(f.format, "child-attempt") })) };
  },
  testHooks: mode === "freeze-after-promote" ? { afterPromote: () => new Promise<void>(() => undefined) } : undefined,
});
worker.start();
installShutdownHandlers(worker, db, { graceMs });
console.log(JSON.stringify({ event: "child.ready", pid: process.pid, mode }));
