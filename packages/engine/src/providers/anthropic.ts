import { EngineError } from "../errors";
import type { ModelClient, ModelRequest, ModelResponse } from "./model";

type Fetch = typeof fetch;

const JSON_ONLY = "Respond with exactly one JSON object and nothing else: no prose before or after it and no code fences.";

/** The Messages API has no JSON mode, so models occasionally wrap the object in a fence; unwrap that one case only. */
function unfence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1]! : text;
}

function extractText(body: unknown): string | null {
  const content = (body as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return null;
  const parts = content.flatMap((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string" ? [(block as { text: string }).text] : []);
  return parts.length ? unfence(parts.join("")) : null;
}

function usageOf(body: unknown): ModelResponse["usage"] {
  const usage = (body as { usage?: { input_tokens?: unknown; output_tokens?: unknown } } | null)?.usage;
  return typeof usage?.input_tokens === "number" && typeof usage.output_tokens === "number" ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : null;
}

/** Maps HTTP status to typed errors. Provider bodies are never copied into messages. */
export function anthropicStatusError(status: number): EngineError {
  if (status === 401 || status === 403) return new EngineError("MODEL_AUTHENTICATION", "The Anthropic credentials were rejected.", false);
  if (status === 429) return new EngineError("MODEL_RATE_LIMIT", "The Anthropic request was rate limited.", true);
  if (status === 408) return new EngineError("MODEL_TIMEOUT", "Anthropic reported a request timeout.", true);
  if (status >= 500) return new EngineError("MODEL_PROVIDER", `Anthropic returned HTTP ${status}.`, true);
  return new EngineError("MODEL_REQUEST_REJECTED", `Anthropic rejected the request with HTTP ${status}.`, false);
}

/** Raw fetch to the Messages API: no SDK, so there are no hidden SDK retries. */
export function createAnthropicClient(options: { apiKey: string; model: string; fetch?: Fetch }): ModelClient {
  const doFetch = options.fetch ?? fetch;
  return {
    provider: "anthropic",
    model: options.model,
    async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
      const response = await doFetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal,
        headers: { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: options.model, max_tokens: request.maxOutputTokens, system: `${request.instructions}\n\n${JSON_ONLY}`, messages: [{ role: "user", content: request.input }] }),
      });
      const providerRequestId = response.headers.get("request-id");
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw anthropicStatusError(response.status);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (signal.aborted) throw error;
        throw new EngineError("MODEL_INVALID_OUTPUT", "The live model returned an unreadable response body.", false);
      }
      const status = (body as { stop_reason?: unknown } | null)?.stop_reason === "max_tokens" ? "incomplete" : "completed";
      return { text: extractText(body), status, usage: usageOf(body), providerRequestId };
    },
  };
}

/** Reads validated server environment at call time; never loads .env itself. */
export function anthropicClientFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  const model = env.MODEL_NAME?.trim();
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (env.MODEL_PROVIDER !== "anthropic" || !model || !apiKey) throw new EngineError("MODEL_CONFIGURATION", "Live mode with Claude requires MODEL_PROVIDER=anthropic, MODEL_NAME, and ANTHROPIC_API_KEY.", false);
  return createAnthropicClient({ apiKey, model });
}
