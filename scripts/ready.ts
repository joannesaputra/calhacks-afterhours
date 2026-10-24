// Startup readiness check. Makes no paid provider calls and no network calls.
import net from "node:net";
import {
  apiPortMismatch, bootstrapDb, liveModelProblem, loadConfig, loadRootEnv, oauthRedirectProblem, pendingMigrations,
} from "@afterhours/data";

loadRootEnv();
let failed = false;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const info = (label: string, detail: string) => console.log(`INFO ${label} — ${detail}`);

const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });

try {
  const config = loadConfig();
  check(true, "core configuration valid");
  const db = bootstrapDb(config);
  check(pendingMigrations(db).length === 0, "database migrated", config.databasePath.replace(config.repoRoot, "."));
  db.close();
  const mismatch = apiPortMismatch(config);
  check(mismatch === null, "API_PORT matches API_ORIGIN", mismatch ?? `${config.apiOrigin}`);
  check(await portFree(config.apiPort), `API port ${config.apiPort} available`, "FAIL here may just mean the API is already running");
  const webUrl = new URL(config.publicAppUrl);
  const webPort = Number(webUrl.port || (webUrl.protocol === "https:" ? 443 : 80));
  check(await portFree(webPort), `web port ${webPort} available`, "FAIL here may just mean the web app is already running");
  // Optional integrations: missing setup is reported, never fatal. Only an inconsistent configured value fails.
  if (config.google.clientId && config.google.clientSecret) {
    const redirect = oauthRedirectProblem(config);
    check(redirect === null, "GOOGLE_REDIRECT_URI matches PUBLIC_APP_URL", redirect ?? config.google.redirectUri);
  } else {
    info("Gmail", "not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET empty); Settings will show Gmail disconnected");
  }
  if (config.generationMode === "live") {
    const p = liveModelProblem(config);
    info("Live model", p ? `NOT configured: ${p.code}. Live tasks will fail with this code; no fixture fallback.` : `configured (${config.modelProvider}, ${config.modelName})`);
  }
  const engine = await import("@afterhours/engine");
  check(typeof engine.runWork === "function" && typeof engine.EngineError === "function", "@afterhours/engine exports load");
  const delivery = await import("@afterhours/delivery");
  check(typeof delivery.sendNotification === "function" && typeof delivery.composeNotification === "function", "@afterhours/delivery exports load");
  console.log(`Mode: generation=${config.generationMode}, notifications=${config.notificationChannel}, demo=${config.demoEnabled}`);
} catch (e) {
  check(false, "configuration/startup", e instanceof Error ? e.message : String(e));
}
process.exit(failed ? 1 : 0);
