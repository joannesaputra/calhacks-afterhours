import { EngineError, withTimeout } from "../errors";

/** Engine-internal provider boundary. Application code never sees provider response formats. */
export interface ModelRequest { instructions: string; input: string; maxOutputTokens: number }
export interface ModelResponse {
  text: string | null;
  /** "incomplete" means the provider stopped early (for example at the output-token cap). */
  status: "completed" | "incomplete";
  usage: { inputTokens: number; outputTokens: number } | null;
  providerRequestId: string | null;
}
export interface ModelClient {
  readonly provider: "anthropic" | "test";
  readonly model: string;
  /** Must honor `signal` for the network request and the body read; throws EngineError for provider failures. */
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}

export interface ModelLimits { maxCallsPerAttempt: number; callTimeoutMs: number; maxOutputTokens: number }
/** Per engine attempt. The worker separately allows two attempts per revision; there are no SDK-level retries. */
export const MODEL_LIMITS: ModelLimits = { maxCallsPerAttempt: 3, callTimeoutMs: 60_000, maxOutputTokens: 12_000 };

export interface CallRecord {
  purpose: "generate" | "repair";
  outcome: "completed" | "incomplete" | "timeout" | "cancelled" | "error";
  durationMs: number;
  usage: ModelResponse["usage"];
  providerRequestId: string | null;
}

/** Counts every logical model call, including repairs, against one per-attempt budget. */
export class CallBudget {
  readonly calls: CallRecord[] = [];
  constructor(private readonly client: ModelClient, private readonly limits: ModelLimits = MODEL_LIMITS, private readonly clock: () => number = Date.now) {}

  get remaining(): number { return this.limits.maxCallsPerAttempt - this.calls.length; }

  async call(purpose: CallRecord["purpose"], request: Omit<ModelRequest, "maxOutputTokens">, signal: AbortSignal): Promise<ModelResponse> {
    if (this.remaining <= 0) throw new EngineError("MODEL_CALL_BUDGET", `The ${this.limits.maxCallsPerAttempt}-call model budget for this attempt is exhausted.`, false);
    const started = this.clock();
    const record: CallRecord = { purpose, outcome: "error", durationMs: 0, usage: null, providerRequestId: null };
    this.calls.push(record);
    const result = await withTimeout(signal, this.limits.callTimeoutMs, (child) => this.client.complete({ ...request, maxOutputTokens: this.limits.maxOutputTokens }, child));
    record.durationMs = this.clock() - started;
    if ("value" in result) {
      record.outcome = result.value.status;
      record.usage = result.value.usage;
      record.providerRequestId = result.value.providerRequestId;
      return result.value;
    }
    if ("timedOut" in result) {
      record.outcome = "timeout";
      throw new EngineError("MODEL_TIMEOUT", `The live model call exceeded ${Math.round(this.limits.callTimeoutMs / 1000)} seconds.`, true);
    }
    if ("cancelled" in result) {
      record.outcome = "cancelled";
      throw new EngineError("ENGINE_ABORTED", "Generation was cancelled.", true);
    }
    if (result.failed instanceof EngineError) throw result.failed;
    throw new EngineError("MODEL_NETWORK", "The live model request failed before a response was received.", true);
  }
}
