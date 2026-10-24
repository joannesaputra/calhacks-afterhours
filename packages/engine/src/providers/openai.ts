import { EngineError } from "../errors";
import type { ModelClient, ModelRequest, ModelResponse } from "./model";

type Fetch = typeof fetch;

function extractOutputText(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const value = response as { output_text?: unknown; output?: unknown };
  if (typeof value.output_text === "string") return value.output_text;
  if (!Array.isArray(value.output)) return null;
  for (const item of value.output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as { content?: unknown }).content)) continue;
    for (const content of (item as { content: unknown[] }).content) {
      if (content && typeof content === "object" && typeof (content as { text?: unknown }).text === "string") return (content as { text: string }).text;
    }
  }
  return null;
}

function usageOf(response: unknown): ModelResponse["usage"] {
  const usage = (response as { usage?: { input_tokens?: unknown; output_tokens?: unknown } } | null)?.usage;
  return typeof usage?.input_tokens === "number" && typeof usage.output_tokens === "number" ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : null;
}

/** Maps HTTP status to typed errors. Provider bodies are never copied into messages. */
export function openAIStatusError(status: number): EngineError {
  if (status === 401 || status === 403) return new EngineError("MODEL_AUTHENTICATION", "The OpenAI credentials were rejected.", false);
  if (status === 429) return new EngineError("MODEL_RATE_LIMIT", "The OpenAI request was rate limited.", true);
  if (status === 408) return new EngineError("MODEL_TIMEOUT", "OpenAI reported a request timeout.", true);
  if (status >= 500) return new EngineError("MODEL_PROVIDER", `OpenAI returned HTTP ${status}.`, true);
  return new EngineError("MODEL_REQUEST_REJECTED", `OpenAI rejected the request with HTTP ${status}.`, false);
}

/** Raw fetch to the Responses API: no SDK, so there are no hidden SDK retries. */
export function createOpenAIClient(options: { apiKey: string; model: string; fetch?: Fetch }): ModelClient {
  const doFetch = options.fetch ?? fetch;
  return {
    provider: "openai",
    model: options.model,
    async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
      const response = await doFetch("https://api.openai.com/v1/responses", {
        method: "POST", signal,
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: options.model, instructions: request.instructions, input: request.input, text: { format: { type: "json_object" } }, max_output_tokens: request.maxOutputTokens }),
      });
      const providerRequestId = response.headers.get("x-request-id");
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw openAIStatusError(response.status);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (signal.aborted) throw error;
        throw new EngineError("MODEL_INVALID_OUTPUT", "The live model returned an unreadable response body.", false);
      }
      const status = (body as { status?: unknown } | null)?.status === "incomplete" ? "incomplete" : "completed";
      return { text: extractOutputText(body), status, usage: usageOf(body), providerRequestId };
    },
  };
}

/** Reads validated server environment at call time; never loads .env itself. */
export function openAIClientFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  const provider = env.MODEL_PROVIDER;
  const model = env.MODEL_NAME?.trim();
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (provider !== "openai" || !model || !apiKey) throw new EngineError("MODEL_CONFIGURATION", "Live mode requires MODEL_PROVIDER=openai, MODEL_NAME, and OPENAI_API_KEY.", false);
  return createOpenAIClient({ apiKey, model });
}
