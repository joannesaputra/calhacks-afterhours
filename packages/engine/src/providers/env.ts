import { EngineError } from "../errors";
import { anthropicClientFromEnv } from "./anthropic";
import type { ModelClient } from "./model";

/** Live generation uses Claude (Anthropic) only. Any other or missing provider fails closed; there is no fixture fallback. */
export function liveClientFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  if (env.MODEL_PROVIDER === "anthropic") return anthropicClientFromEnv(env);
  throw new EngineError("MODEL_CONFIGURATION", "Live mode requires MODEL_PROVIDER=anthropic, a MODEL_NAME, and ANTHROPIC_API_KEY.", false);
}
