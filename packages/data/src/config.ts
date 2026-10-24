import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/** Walk up from `start` until pnpm-workspace.yaml is found. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Repository root (pnpm-workspace.yaml) not found from ${start}`);
    dir = parent;
  }
}

/** Load the root .env if present. Never overrides variables already set. */
export function loadRootEnv(root: string = findRepoRoot()): void {
  const file = path.join(root, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optStr = z.preprocess(blank, z.string().optional());
const bool = (def: boolean) =>
  z.preprocess(blank, z.enum(["true", "false"]).optional()).transform((v) => (v === undefined ? def : v === "true"));

const EnvSchema = z.object({
  NODE_ENV: z.preprocess(blank, z.enum(["development", "test", "production"]).default("development")),
  PUBLIC_APP_URL: z.preprocess(blank, z.string().url().default("http://localhost:3000")),
  API_ORIGIN: z.preprocess(blank, z.string().url().default("http://127.0.0.1:4000")),
  API_PORT: z.preprocess(blank, z.coerce.number().int().min(1).max(65535).default(4000)),
  DATABASE_PATH: z.preprocess(blank, z.string().default("./var/afterhours.sqlite")),
  ARTIFACTS_DIR: z.preprocess(blank, z.string().default("./var/artifacts")),
  SESSION_SECRET: z.preprocess(blank, z.string().min(16, "must be at least 16 characters")),
  APP_PASSWORD: z.preprocess(blank, z.string().min(8, "must be at least 8 characters")),
  TOKEN_ENCRYPTION_KEY: z.preprocess(blank, z.string()),
  DEMO_ENABLED: bool(false),
  DEMO_CLI_TOKEN: optStr,
  GENERATION_MODE: z.preprocess(blank, z.enum(["fixture", "live"]).default("fixture")),
  MODEL_PROVIDER: z.preprocess(blank, z.enum(["fixture", "openai", "anthropic"]).default("fixture")),
  MODEL_NAME: optStr,
  OPENAI_API_KEY: optStr,
  ANTHROPIC_API_KEY: optStr,
  GOOGLE_CLIENT_ID: optStr,
  GOOGLE_CLIENT_SECRET: optStr,
  GOOGLE_REDIRECT_URI: z.preprocess(blank, z.string().default("http://localhost:3000/api/integrations/gmail/callback")),
  GMAIL_POLL_INTERVAL_SECONDS: z.preprocess(blank, z.coerce.number().int().min(5).max(3600).default(15)),
  NOTIFICATION_CHANNEL: z.preprocess(blank, z.enum(["outbox", "whatsapp"]).default("outbox")),
  WHATSAPP_USE_CASE_ELIGIBLE: bool(false),
  WHATSAPP_CUSTOMER_SERVICE_WINDOW_UNTIL: optStr,
  TWILIO_ACCOUNT_SID: optStr,
  TWILIO_AUTH_TOKEN: optStr,
  TWILIO_WHATSAPP_FROM: optStr,
  TWILIO_WHATSAPP_TO: optStr,
  TWILIO_CONTENT_SID: optStr,
});

export interface AppConfig {
  repoRoot: string;
  nodeEnv: "development" | "test" | "production";
  publicAppUrl: string;
  apiOrigin: string;
  apiPort: number;
  databasePath: string;
  artifactsDir: string;
  sessionSecret: string;
  appPassword: string;
  tokenEncryptionKey: Buffer;
  demoEnabled: boolean;
  demoCliToken: string | null;
  generationMode: "fixture" | "live";
  modelProvider: "fixture" | "openai" | "anthropic";
  modelName: string | null;
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  google: { clientId: string | null; clientSecret: string | null; redirectUri: string };
  gmailPollIntervalSeconds: number;
  notificationChannel: "outbox" | "whatsapp";
  whatsapp: {
    useCaseEligible: boolean;
    customerServiceWindowUntil: string | null;
    twilioAccountSid: string | null;
    twilioAuthToken: string | null;
    from: string | null;
    to: string | null;
    contentSid: string | null;
  };
}

export class ConfigError extends Error {}

/**
 * Validate core runtime configuration. Throws ConfigError for invalid core settings
 * (database/session/encryption). Missing optional provider settings never throw.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, repoRoot: string = findRepoRoot()): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid configuration (run "pnpm setup:local" to generate secrets):\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const key = Buffer.from(e.TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new ConfigError(
      'Invalid configuration: TOKEN_ENCRYPTION_KEY must be base64 for exactly 32 bytes (run "pnpm setup:local").',
    );
  }
  const abs = (p: string) => (path.isAbsolute(p) ? p : path.resolve(repoRoot, p));
  return {
    repoRoot,
    nodeEnv: e.NODE_ENV,
    publicAppUrl: e.PUBLIC_APP_URL.replace(/\/$/, ""),
    apiOrigin: e.API_ORIGIN,
    apiPort: e.API_PORT,
    databasePath: abs(e.DATABASE_PATH),
    artifactsDir: abs(e.ARTIFACTS_DIR),
    sessionSecret: e.SESSION_SECRET,
    appPassword: e.APP_PASSWORD,
    tokenEncryptionKey: key,
    demoEnabled: e.DEMO_ENABLED,
    demoCliToken: e.DEMO_CLI_TOKEN ?? null,
    generationMode: e.GENERATION_MODE,
    modelProvider: e.GENERATION_MODE === "fixture" ? "fixture" : e.MODEL_PROVIDER,
    modelName: e.MODEL_NAME ?? null,
    openaiApiKey: e.OPENAI_API_KEY ?? null,
    anthropicApiKey: e.ANTHROPIC_API_KEY ?? null,
    google: {
      clientId: e.GOOGLE_CLIENT_ID ?? null,
      clientSecret: e.GOOGLE_CLIENT_SECRET ?? null,
      redirectUri: e.GOOGLE_REDIRECT_URI,
    },
    gmailPollIntervalSeconds: e.GMAIL_POLL_INTERVAL_SECONDS,
    notificationChannel: e.NOTIFICATION_CHANNEL,
    whatsapp: {
      useCaseEligible: e.WHATSAPP_USE_CASE_ELIGIBLE,
      customerServiceWindowUntil: e.WHATSAPP_CUSTOMER_SERVICE_WINDOW_UNTIL ?? null,
      twilioAccountSid: e.TWILIO_ACCOUNT_SID ?? null,
      twilioAuthToken: e.TWILIO_AUTH_TOKEN ?? null,
      from: e.TWILIO_WHATSAPP_FROM ?? null,
      to: e.TWILIO_WHATSAPP_TO ?? null,
      contentSid: e.TWILIO_CONTENT_SID ?? null,
    },
  };
}

/**
 * Why live generation cannot run with this server configuration, or null when it can. Mirrors the engine's
 * own checks (docs/engine-handoff.md): only MODEL_PROVIDER=openai is implemented and it needs MODEL_NAME and
 * OPENAI_API_KEY. Used for the status endpoint and as a pre-check so an unconfigured live task fails with a
 * typed nonretryable error. There is never a fixture fallback.
 */
export function liveModelProblem(c: AppConfig): { code: string; message: string } | null {
  if (c.modelProvider === "anthropic") {
    return { code: "MODEL_PROVIDER_UNSUPPORTED", message: "Live generation with MODEL_PROVIDER=anthropic is not implemented. Configure MODEL_PROVIDER=openai on the server." };
  }
  if (c.modelProvider !== "openai") {
    return { code: "MODEL_NOT_CONFIGURED", message: "Live generation is selected but MODEL_PROVIDER is not set to a supported provider (openai) on the server." };
  }
  if (!c.openaiApiKey || !c.modelName) {
    return { code: "MODEL_NOT_CONFIGURED", message: "Live generation is selected but the server is missing the OpenAI API key or MODEL_NAME. Set both in the server environment, or switch GENERATION_MODE=fixture for new tasks." };
  }
  return null;
}

/** Live model configuration status. Fixture mode is always "configured". */
export function modelStatus(c: AppConfig) {
  if (c.generationMode === "fixture") {
    return { mode: "fixture" as const, provider: "fixture" as const, configured: true, model: null };
  }
  return {
    mode: "live" as const,
    provider: c.modelProvider,
    configured: liveModelProblem(c) === null,
    model: c.modelName,
  };
}

/**
 * Google must redirect the browser to the public web origin (PUBLIC_APP_URL), whose Next proxy forwards
 * /api/* to the API. The session cookie lives on that origin, so a callback on any other host or port can
 * never be bound to the session. Returns a problem description, or null when consistent.
 */
export function oauthRedirectProblem(c: Pick<AppConfig, "publicAppUrl" | "google">): string | null {
  const expected = `${c.publicAppUrl}/api/integrations/gmail/callback`;
  if (c.google.redirectUri !== expected) {
    return `GOOGLE_REDIRECT_URI must be exactly ${expected} (PUBLIC_APP_URL + /api/integrations/gmail/callback); it is ${c.google.redirectUri}.`;
  }
  return null;
}

export function whatsappConfigured(c: AppConfig): boolean {
  const w = c.whatsapp;
  return !!(w.twilioAccountSid && w.twilioAuthToken && w.from);
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * The API listens on API_PORT; the web proxy (apps/web/next.config.mjs) and the demo CLI call API_ORIGIN.
 * For a loopback origin the two must agree. Returns a human-readable problem, or null when consistent.
 * Non-loopback origins (e.g. http://api:4000 in Docker Compose) are not checked.
 */
export function apiPortMismatch(config: Pick<AppConfig, "apiOrigin" | "apiPort">): string | null {
  const url = new URL(config.apiOrigin);
  if (!LOOPBACK.has(url.hostname)) return null;
  const originPort = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (originPort === config.apiPort) return null;
  return `API_PORT is ${config.apiPort} but API_ORIGIN points at port ${originPort}; the web proxy and demo CLI would call the wrong port. Set both to the same port.`;
}
