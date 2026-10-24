import { apiPortMismatch, bootstrapDb, loadConfig, loadRootEnv, oauthRedirectProblem } from "@afterhours/data";
import { buildApp } from "./app";

loadRootEnv();
const config = loadConfig();
const db = bootstrapDb(config);
const portProblem = apiPortMismatch(config);
const app = await buildApp({ config, db, logger: true });

const host = process.env.API_HOST ?? "127.0.0.1";
if (portProblem) app.log.warn(portProblem);
const redirectProblem = config.google.clientId ? oauthRedirectProblem(config) : null;
if (redirectProblem) app.log.warn(redirectProblem);
await app.listen({ port: config.apiPort, host });

const stop = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
