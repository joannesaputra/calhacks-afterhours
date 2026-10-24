import { EngineError } from "../errors";
import { anthropicClientFromEnv } from "./anthropic";
import type { ModelClient } from "./model";
import { openAIClientFromEnv } from "./openai";

/** Picks the live provider from MODEL_PROVIDER. An unknown or missing provider fails closed; there is no fixture fallback. */
export function liveClientFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  if (env.MODEL_PROVIDER === "anthropic") return anthropicClientFromEnv(env);
  if (env.MODEL_PROVIDER === "openai") return openAIClientFromEnv(env);
  throw new EngineError("MODEL_CONFIGURATION", "Live mode requires MODEL_PROVIDER=openai or MODEL_PROVIDER=anthropic, a MODEL_NAME, and that provider's API key.", false);
}
