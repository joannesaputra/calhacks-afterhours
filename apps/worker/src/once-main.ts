// One-shot worker for deliberate, bounded live checks (`pnpm worker:once`). It uses the same configuration, database,
// engine, delivery adapter, job lease and result commit as `main.ts`, but starts no polling loop, so it can run one job at most.
import { randomUUID } from "node:crypto";
import { bootstrapDb, loadConfig, loadRootEnv } from "@afterhours/data";
import { PARSER_VERSION, extractDocument, runWork } from "@afterhours/engine";
import { sendNotification } from "@afterhours/delivery";
import { consoleLogger } from "./log";
import { runOnce } from "./once";
import { createWorker } from "./worker";

loadRootEnv();
const config = loadConfig();
const db = bootstrapDb(config);
const worker = createWorker({ db, config, workerId: `once-${randomUUID().slice(0, 8)}`, runWork, sendNotification, log: consoleLogger, context: { extract: extractDocument, parserVersion: PARSER_VERSION } });
const outcome = await runOnce(worker);
console.log(JSON.stringify({ event: "worker.once.done", ...outcome }));
db.close();
