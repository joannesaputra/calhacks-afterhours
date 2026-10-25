import { randomUUID } from "node:crypto";
import { bootstrapDb, loadConfig, loadRootEnv } from "@afterhours/data";
import { PARSER_VERSION, extractDocument, runWork } from "@afterhours/engine";
import { sendNotification } from "@afterhours/delivery";
import { consoleLogger } from "./log";
import { installShutdownHandlers } from "./runtime";
import { createWorker } from "./worker";

loadRootEnv();
const config = loadConfig();
const db = bootstrapDb(config);
const worker = createWorker({
  db, config, workerId: `worker-${randomUUID().slice(0, 8)}`, runWork, sendNotification, log: consoleLogger,
  context: { extract: extractDocument, parserVersion: PARSER_VERSION },
});
worker.start();

installShutdownHandlers(worker, db);
