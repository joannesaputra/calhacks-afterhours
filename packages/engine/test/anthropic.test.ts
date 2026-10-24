import { describe, expect, it } from "vitest";
import { EngineError } from "../src/index";
import { anthropicClientFromEnv, anthropicStatusError, createAnthropicClient } from "../src/providers/anthropic";
import { liveClientFromEnv } from "../src/providers/env";

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const signal = () => new AbortController().signal;

describe("Anthropic (Claude) provider", () => {
  it("calls the Messages API with the key in x-api-key and returns text, usage and the request id", async () => {
    let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
    const client = createAnthropicClient({ apiKey: "test-key", model: "claude-test", fetch: async (url, init) => {
      seen = { url: String(url), headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) };
      return reply({ type: "message", content: [{ type: "text", text: '{"ok":true}' }], stop_reason: "end_turn", usage: { input_tokens: 11, output_tokens: 4 } }, 200, { "request-id": "req_abc" });
    } });
    const response = await client.complete({ instructions: "SYSTEM", input: "INPUT", maxOutputTokens: 500 }, signal());
    expect(response).toEqual({ text: '{"ok":true}', status: "completed", usage: { inputTokens: 11, outputTokens: 4 }, providerRequestId: "req_abc" });
    expect(seen!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen!.headers["x-api-key"]).toBe("test-key");
    expect(seen!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(seen!.body).toMatchObject({ model: "claude-test", max_tokens: 500, messages: [{ role: "user", content: "INPUT" }] });
    expect(String(seen!.body.system)).toMatch(/^SYSTEM/);
    expect(String(seen!.body.system)).toMatch(/exactly one JSON object/);
    expect(JSON.stringify(seen!.body)).not.toContain("test-key");
  });

  it("marks a max_tokens stop as incomplete and unwraps a single code fence", async () => {
    const cut = createAnthropicClient({ apiKey: "k", model: "m", fetch: async () => reply({ content: [{ type: "text", text: "{" }], stop_reason: "max_tokens" }) });
    expect((await cut.complete({ instructions: "s", input: "i", maxOutputTokens: 1 }, signal())).status).toBe("incomplete");
    const fenced = createAnthropicClient({ apiKey: "k", model: "m", fetch: async () => reply({ content: [{ type: "text", text: '```json\n{"a":1}\n```' }], stop_reason: "end_turn" }) });
    expect((await fenced.complete({ instructions: "s", input: "i", maxOutputTokens: 1 }, signal())).text).toBe('{"a":1}');
    const empty = createAnthropicClient({ apiKey: "k", model: "m", fetch: async () => reply({ content: [], stop_reason: "end_turn" }) });
    expect((await empty.complete({ instructions: "s", input: "i", maxOutputTokens: 1 }, signal())).text).toBeNull();
  });

  it("maps HTTP failures to typed errors and never echoes the provider body or the key", async () => {
    expect([401, 403, 400, 408, 413, 429, 500, 529].map((status) => { const error = anthropicStatusError(status); return [status, error.code, error.retryable]; })).toEqual([
      [401, "MODEL_AUTHENTICATION", false], [403, "MODEL_AUTHENTICATION", false], [400, "MODEL_REQUEST_REJECTED", false], [408, "MODEL_TIMEOUT", true],
      [413, "MODEL_REQUEST_REJECTED", false], [429, "MODEL_RATE_LIMIT", true], [500, "MODEL_PROVIDER", true], [529, "MODEL_PROVIDER", true],
    ]);
    const secret = "sk-ant-SECRETSECRETSECRET";
    const client = createAnthropicClient({ apiKey: secret, model: "m", fetch: async () => reply({ error: { message: `bad key ${secret}` } }, 401) });
    const error = (await client.complete({ instructions: "s", input: "i", maxOutputTokens: 1 }, signal()).catch((e: unknown) => e)) as EngineError;
    expect(error).toBeInstanceOf(EngineError);
    expect(error.message).not.toContain(secret);
  });

  it("selects the provider from the environment and fails closed when anything is missing", () => {
    expect(liveClientFromEnv({ MODEL_PROVIDER: "anthropic", MODEL_NAME: "claude-test", ANTHROPIC_API_KEY: "k" })).toMatchObject({ provider: "anthropic", model: "claude-test" });
    for (const env of [{ MODEL_PROVIDER: "anthropic", MODEL_NAME: "m" }, { MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }, { MODEL_PROVIDER: "openai", MODEL_NAME: "m", ANTHROPIC_API_KEY: "k" }, { MODEL_PROVIDER: "fixture" }, {}]) {
      expect(() => liveClientFromEnv(env)).toThrowError(expect.objectContaining({ code: "MODEL_CONFIGURATION", retryable: false }));
    }
    expect(() => anthropicClientFromEnv({ MODEL_PROVIDER: "openai", MODEL_NAME: "m", ANTHROPIC_API_KEY: "k" })).toThrow(EngineError);
  });
});
