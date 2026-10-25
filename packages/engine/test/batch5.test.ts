import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineInput, EngineProgress, EngineResult } from "@afterhours/contracts";
import { calculateSales, createEngine, EngineError, runWork, type ModelClient, type ModelResponse } from "../src/index";
import { deckLayoutIssues } from "../src/layout";
import { anthropicStatusError, createAnthropicClient } from "../src/providers/anthropic";
import { listItems } from "../src/proposalFacts";
import { officeText } from "../src/text";
import { inputFor } from "./fixtures";
import { syntheticInputs, syntheticRejections } from "./synthetic";

const deps = (signal = new AbortController().signal, progress: EngineProgress[] = []) => ({ signal, onProgress: async (item: EngineProgress) => { progress.push(item); } });
const ok = (text: string | null, status: ModelResponse["status"] = "completed"): ModelResponse => ({ text, status, usage: { inputTokens: 100, outputTokens: 50 }, providerRequestId: "req_test" });

/** Scripted fake provider: each call takes the next step. Records the signal it was given. */
function scripted(steps: Array<(signal: AbortSignal) => Promise<ModelResponse>>): ModelClient & { calls: AbortSignal[] } {
  const calls: AbortSignal[] = [];
  return { provider: "test", model: "fake-model", calls, complete: async (_request, signal) => { calls.push(signal); const step = steps[calls.length - 1]; if (!step) throw new Error("unexpected extra model call"); return step(signal); } };
}
const hang = (signal: AbortSignal) => new Promise<ModelResponse>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));

/** A live-mode input plus a model response built from the fixture engine's own validated content. */
async function liveCase(scenario: "proposal" | "report" = "proposal", revision = 1): Promise<{ input: EngineInput; valid: string; ready: Extract<EngineResult, { outcome: "ready" }> }> {
  const fixture = await inputFor(scenario, { revision });
  const ready = await runWork(fixture, deps());
  if (ready.outcome !== "ready") throw new Error("fixture not ready");
  const input = { ...fixture, mode: "live" as const, fixtureScenario: null };
  return { input, ready, valid: JSON.stringify({ outcome: "ready", plan: ready.plan, products: ready.products }) };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("cancellation and deadlines", () => {
  it("stops at the next stage after the parent aborts during progress and emits nothing afterwards", async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    const run = runWork(await inputFor("proposal"), { signal: controller.signal, onProgress: async (item) => { seen.push(item.stage); if (item.stage === "plan") controller.abort(); } });
    await expect(run).rejects.toMatchObject({ code: "ENGINE_ABORTED" });
    expect(seen).toEqual(["extract", "plan"]);
  });

  it("never returns ready when ownership is lost after export", async () => {
    const controller = new AbortController();
    const run = runWork(await inputFor("proposal"), { signal: controller.signal, onProgress: async (item) => { if (item.stage === "export") controller.abort(); } });
    await expect(run).rejects.toMatchObject({ code: "ENGINE_ABORTED" });
  }, 20_000);

  it("propagates parent cancellation into an in-flight cooperative model request", async () => {
    const { input } = await liveCase();
    const controller = new AbortController();
    const client = scripted([hang]);
    const run = createEngine({ modelClient: client }).runWork(input, deps(controller.signal));
    setTimeout(() => controller.abort(), 20);
    await expect(run).rejects.toMatchObject({ code: "ENGINE_ABORTED", retryable: true });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.aborted).toBe(true);
  });

  it("times out a cooperative call at the per-call limit and aborts its signal", async () => {
    const { input } = await liveCase();
    const client = scripted([hang]);
    await expect(createEngine({ modelClient: client, limits: { maxCallsPerAttempt: 3, callTimeoutMs: 30, maxOutputTokens: 100 } }).runWork(input, deps()))
      .rejects.toMatchObject({ code: "MODEL_TIMEOUT", retryable: true });
    expect(client.calls[0]!.aborted).toBe(true);
  });

  it("returns MODEL_TIMEOUT even when a noncooperative client ignores the signal (its promise may still run)", async () => {
    const { input } = await liveCase();
    let settled = false;
    const client = scripted([() => new Promise((resolve) => setTimeout(() => { settled = true; resolve(ok("{}")); }, 200))]);
    const started = Date.now();
    await expect(createEngine({ modelClient: client, limits: { maxCallsPerAttempt: 3, callTimeoutMs: 30, maxOutputTokens: 100 } }).runWork(input, deps()))
      .rejects.toMatchObject({ code: "MODEL_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(150);
    expect(settled).toBe(false);
  });

  it("releases the per-call timer and parent abort listener after every call", async () => {
    const { input } = await liveCase();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const needsInput = JSON.stringify({ outcome: "needs_input", plan: { title: "Proposal", requestSummary: "Needs a fee", requestedOutputs: ["proposal", "presentation"], dueAt: null, dueAtExplanation: null, steps: ["Ask"], assumptions: [], questions: [{ id: "fee", question: "What fee is authorized?", reason: "No fee was stated.", required: true }], sourcesUsed: [] } });
    for (let index = 0; index < 5; index += 1) {
      const result = await createEngine({ modelClient: scripted([async () => ok(needsInput)]) }).runWork(input, deps(controller.signal));
      expect(result.outcome).toBe("needs_input");
    }
    expect(vi.getTimerCount()).toBe(0);
    const added = add.mock.calls.filter(([type]) => type === "abort").length;
    expect(added).toBe(5);
    expect(remove.mock.calls.filter(([type]) => type === "abort").length).toBe(added);
  });

  it("keeps the worker heartbeat responsive: the worst synthetic export blocks the event loop briefly", async () => {
    const inputs = await syntheticInputs();
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    const started = performance.now();
    for (const input of Object.values(inputs)) expect((await runWork(input, deps())).outcome).toBe("ready");
    histogram.disable();
    const maxBlockMs = histogram.max / 1e6;
    console.info(`[batch5] 4 synthetic exports took ${Math.round(performance.now() - started)} ms; max event-loop delay ${maxBlockMs.toFixed(1)} ms`);
    // Worker heartbeats every 15 s with a 90 s lease; a sub-second stall cannot lose the lease.
    expect(maxBlockMs).toBeLessThan(1_000);
  }, 60_000);
});

describe("call budget and repair", () => {
  it("repairs one malformed response, revalidates it, and reports actual usage per call", async () => {
    const { input, valid } = await liveCase();
    const progress: EngineProgress[] = [];
    const client = scripted([async () => ok("```json\nnot json"), async () => ok(valid)]);
    const result = await createEngine({ modelClient: client }).runWork(input, deps(undefined, progress));
    expect(result.outcome).toBe("ready");
    expect(client.calls).toHaveLength(2);
    const messages = progress.map((item) => item.message).join("\n");
    expect(messages).toContain("Live model call 1 of 3 (generate, fake-model)");
    expect(messages).toContain("Live model call 2 of 3 (repair, fake-model)");
    expect(messages).toContain("100 input / 50 output tokens");
  });

  it("stops after one failed repair with a nonretryable typed error and no third call", async () => {
    const { input } = await liveCase();
    const client = scripted([async () => ok("nope"), async () => ok("{\"outcome\":\"ready\"}")]);
    await expect(createEngine({ modelClient: client }).runWork(input, deps())).rejects.toMatchObject({ code: "MODEL_INVALID_OUTPUT", retryable: false });
    expect(client.calls).toHaveLength(2);
  });

  it("does not repair when the call budget is exhausted", async () => {
    const { input } = await liveCase();
    const client = scripted([async () => ok(null)]);
    await expect(createEngine({ modelClient: client, limits: { maxCallsPerAttempt: 1, callTimeoutMs: 1_000, maxOutputTokens: 100 } }).runWork(input, deps())).rejects.toMatchObject({ code: "MODEL_INVALID_OUTPUT" });
    expect(client.calls).toHaveLength(1);
  });

  it("treats a truncated (incomplete) response as invalid and repairs it within budget", async () => {
    const { input, valid } = await liveCase();
    const client = scripted([async () => ok(valid.slice(0, 200), "incomplete"), async () => ok(valid)]);
    expect((await createEngine({ modelClient: client }).runWork(input, deps())).outcome).toBe("ready");
  });

  it("rejects a repaired response that invents a fee, a quote, or a percentage", async () => {
    const { input, ready } = await liveCase();
    const tamper = (edit: (products: typeof ready.products) => void) => { const products = structuredClone(ready.products); edit(products); return JSON.stringify({ outcome: "ready", plan: ready.plan, products }); };
    const cases = [
      tamper((products) => { products[0]!.blocks[0]!.text = "The fee is USD 9,999."; }),
      tamper((products) => { products[0]!.blocks[0]!.evidence = [{ sourceId: products[0]!.blocks[0]!.evidence[0]!.sourceId, quote: "The client guaranteed a 40% lift.", locator: null }]; }),
      tamper((products) => { products[1]!.slides[1]!.title = "Sales will grow 30%"; }),
    ];
    for (const repaired of cases) {
      await expect(createEngine({ modelClient: scripted([async () => ok("bad"), async () => ok(repaired)]) }).runWork(input, deps()))
        .rejects.toMatchObject({ code: "MODEL_INVALID_OUTPUT", retryable: false });
    }
  });

  it("rejects live report numbers the code did not calculate, and accepts the calculated ones", async () => {
    const { input, ready, valid } = await liveCase("report");
    expect((await createEngine({ modelClient: scripted([async () => ok(valid)]) }).runWork(input, deps())).outcome).toBe("ready");
    const products = structuredClone(ready.products);
    products[0]!.blocks[1]!.chart!.series[0]!.values = [12_000, 16_000];
    const fabricated = JSON.stringify({ outcome: "ready", plan: ready.plan, products });
    await expect(createEngine({ modelClient: scripted([async () => ok(fabricated), async () => ok(fabricated)]) }).runWork(input, deps())).rejects.toMatchObject({ code: "MODEL_INVALID_OUTPUT" });
  });

  it("assigns code-derived IDs and the code-resolved deadline regardless of model output", async () => {
    const first = await liveCase("proposal", 1);
    const second = await liveCase("proposal", 2);
    const hostile = (valid: string) => { const value = JSON.parse(valid); value.products[0].id = "../../etc/passwd"; value.plan.dueAt = "2030-01-01T00:00:00.000Z"; return JSON.stringify(value); };
    const runA = await createEngine({ modelClient: scripted([async () => ok(hostile(first.valid))]) }).runWork(first.input, deps());
    const runB = await createEngine({ modelClient: scripted([async () => ok(hostile(first.valid))]) }).runWork(first.input, deps());
    const runC = await createEngine({ modelClient: scripted([async () => ok(hostile(second.valid))]) }).runWork(second.input, deps());
    if (runA.outcome !== "ready" || runB.outcome !== "ready" || runC.outcome !== "ready") throw new Error("expected ready");
    expect(runA.plan.dueAt).toBe("2026-10-26T16:00:00.000Z");
    expect(runA.products.map((product) => product.id)).toEqual(runB.products.map((product) => product.id));
    expect(runA.files.map((file) => file.id)).toEqual(runB.files.map((file) => file.id));
    expect(runA.files.map((file) => file.id)).not.toEqual(runC.files.map((file) => file.id));
    for (const file of [...runA.files, ...runC.files]) expect(file.id).toMatch(/^[A-Za-z0-9._-]+$/);
  }, 30_000);

  it("never falls back to fixtures: missing provider configuration fails before any work", async () => {
    const { input } = await liveCase();
    const previous = { ...process.env };
    process.env.MODEL_PROVIDER = "anthropic"; delete process.env.MODEL_NAME; delete process.env.ANTHROPIC_API_KEY;
    const progress: EngineProgress[] = [];
    await expect(runWork(input, deps(undefined, progress))).rejects.toMatchObject({ code: "MODEL_CONFIGURATION", retryable: false });
    expect(progress).toHaveLength(0);
    process.env = previous;
  });
});

describe("provider error mapping", () => {
  it("maps HTTP statuses to retryable versus permanent errors", () => {
    expect([401, 403, 400, 404, 408, 429, 500, 503].map((status) => { const error = anthropicStatusError(status); return [status, error.code, error.retryable]; })).toEqual([
      [401, "MODEL_AUTHENTICATION", false], [403, "MODEL_AUTHENTICATION", false], [400, "MODEL_REQUEST_REJECTED", false], [404, "MODEL_REQUEST_REJECTED", false],
      [408, "MODEL_TIMEOUT", true], [429, "MODEL_RATE_LIMIT", true], [500, "MODEL_PROVIDER", true], [503, "MODEL_PROVIDER", true],
    ]);
  });

  it("never copies provider bodies or keys into error messages, and passes the signal to fetch", async () => {
    const secret = "sk-test-SECRET-should-not-leak";
    let signalSeen: AbortSignal | undefined;
    const client = createAnthropicClient({ apiKey: secret, model: "m", fetch: async (_url, init) => { signalSeen = init?.signal ?? undefined; return new Response(JSON.stringify({ error: { message: `bad key ${secret}` } }), { status: 401 }); } });
    const error = await client.complete({ instructions: "x", input: "y", maxOutputTokens: 10 }, new AbortController().signal).then(() => { throw new Error("expected failure"); }, (caught: unknown) => caught as EngineError);
    expect(error).toMatchObject({ code: "MODEL_AUTHENTICATION", retryable: false });
    expect(error.message).not.toContain(secret);
    expect(signalSeen).toBeDefined();
  });

  it("maps network failure to a retryable error without the raw error text", async () => {
    const { input } = await liveCase();
    const fetchFail = createAnthropicClient({ apiKey: "k", model: "m", fetch: async () => { throw new TypeError("getaddrinfo ENOTFOUND internal-host.example"); } });
    const error = await createEngine({ modelClient: fetchFail }).runWork(input, deps()).then(() => { throw new Error("expected failure"); }, (caught: unknown) => caught as EngineError);
    expect(error).toMatchObject({ code: "MODEL_NETWORK", retryable: true });
    expect(error.message).not.toContain("internal-host");
  });

  it("parses usage and incomplete status from a Messages API body", async () => {
    const client = createAnthropicClient({ apiKey: "k", model: "m", fetch: async () => new Response(JSON.stringify({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }], usage: { input_tokens: 7, output_tokens: 3 } }), { status: 200, headers: { "request-id": "req_1" } }) });
    expect(await client.complete({ instructions: "x", input: "y", maxOutputTokens: 10 }, new AbortController().signal)).toEqual({ text: "{", status: "incomplete", usage: { inputTokens: 7, outputTokens: 3 }, providerRequestId: "req_1" });
  });
});

describe("material commitments", () => {
  it("asks specific questions for every synthetic conflict or gap instead of producing files", async () => {
    for (const [name, { input, expect: expected }] of Object.entries(await syntheticRejections())) {
      const outcome = await runWork(input, deps()).catch((error: unknown) => error as EngineError);
      if (outcome instanceof EngineError) { expect(outcome.code, name).toBe(expected); continue; }
      expect(outcome.outcome, name).toBe("needs_input");
      if (outcome.outcome === "needs_input") expect(outcome.questions.map((question) => question.id), name).toContain(expected);
    }
  });

  it("re-asks unusable clarification answers instead of using them", async () => {
    const answers = { client_identity: "Northstar Co.", project_scope: "Launch positioning", authorized_fee: "whatever you think is fair", project_schedule: "November 2-29, 2026" };
    const input = await inputFor("ambiguous", { revision: 2, answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer })) });
    const result = await runWork(input, deps());
    expect(result.outcome).toBe("needs_input");
    if (result.outcome === "needs_input") expect(result.questions).toEqual([expect.objectContaining({ id: "authorized_fee", reason: expect.stringContaining("amount with a currency") })]);
  });

  it("keeps compound deliverables whole and labels basis visibly in exported content", async () => {
    expect(listItems("discovery, audience and message strategy, a four-week content calendar, and a measurement plan.")).toEqual(["Discovery", "Audience and message strategy", "A four-week content calendar", "A measurement plan"]);
    const result = await runWork(await inputFor("proposal"), deps());
    if (result.outcome !== "ready") throw new Error("expected ready");
    const { unzip } = await import("./zip");
    const docx = new TextDecoder().decode(unzip(result.files.find((file) => file.format === "docx")!.bytes).get("word/document.xml")!);
    expect(docx).toContain("Recommendation from Harbor Creative; not stated in the sources.");
    expect(docx).toContain("Assumptions and open items; confirm before any agreement.");
    expect(docx).toContain("Payment milestones are not stated and remain to be agreed.");
    const slide5 = new TextDecoder().decode(unzip(result.files.find((file) => file.format === "pptx")!.bytes).get("ppt/slides/slide5.xml")!);
    expect(slide5).toContain("RECOMMENDATION");
  }, 20_000);
});

describe("calculations stay authoritative", () => {
  it("recomputes canonical and changed inputs, including cents and decreases", () => {
    const canonical = calculateSales("month,channel,revenue_usd,orders\n2026-01,Website,8000,80\n2026-01,Partnerships,4000,40\n2026-02,Website,10000,100\n2026-02,Partnerships,5000,50\n");
    expect([canonical.months[0]!.revenueMinor, canonical.months[1]!.revenueMinor, canonical.revenueChangeMinor, canonical.revenueGrowthPercent, canonical.months[0]!.orders, canonical.months[1]!.orders, canonical.months[0]!.averageOrderValueMinor]).toEqual([1_200_000, 1_500_000, 300_000, 25, 120, 150, 10_000]);
    const changed = calculateSales("month,channel,revenue_usd,orders\n2026-03,Website,9000.50,95\n2026-03,Partnerships,3000,30\n2026-04,Website,7200.25,80\n2026-04,Partnerships,3300,30\n");
    expect([changed.months[0]!.revenueMinor, changed.months[1]!.revenueMinor, changed.revenueChangeMinor, changed.revenueGrowthPercent, changed.orderChange]).toEqual([1_200_050, 1_050_025, -150_025, -12.5, -15]);
  });

  it("does not reintroduce canonical fixture values when the CSV changes", async () => {
    const result = await runWork((await syntheticInputs())["changed-report"]!, deps());
    if (result.outcome !== "ready") throw new Error("expected ready");
    const text = JSON.stringify(result.products);
    expect(text).toContain("Revenue decreased 12.5%");
    expect(text).toContain("$12,000.50");
    // "25%" alone is a real value here (Partnerships' March share); the stale claims are the canonical growth statements.
    for (const stale of ["$15,000", "increased 25%", "grew 25%", "66.7%", "January"]) expect(text).not.toContain(stale);
  }, 20_000);

  it("refuses to sum mixed currencies and treats blanks as unknown", () => {
    expect(() => calculateSales("month,channel,revenue_usd,orders,currency\n2026-01,Website,1,1,USD\n2026-02,Website,1,1,EUR\n")).toThrow(expect.objectContaining({ code: "UNSUPPORTED_INPUT" }));
    expect(() => calculateSales("month,channel,revenue_usd,orders\n2026-01,Website,,1\n2026-02,Website,2,1\n")).toThrow(expect.objectContaining({ code: "INVALID_CSV" }));
  });
});

describe("Office output safety and layout budgets", () => {
  it("renders every synthetic ready input with zero layout issues and valid, escaped XML", async () => {
    const { unzip } = await import("./zip");
    for (const [name, input] of Object.entries(await syntheticInputs())) {
      const result = await runWork(input, deps());
      expect(result.outcome, name).toBe("ready");
      if (result.outcome !== "ready") continue;
      expect(deckLayoutIssues(result.products.find((product) => product.kind === "presentation")!), name).toEqual([]);
      for (const file of result.files) {
        for (const [entry, bytes] of unzip(file.bytes)) {
          if (!entry.endsWith(".xml")) continue;
          const xml = new TextDecoder().decode(bytes);
          // eslint-disable-next-line no-control-regex
          expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml), `${name} ${entry}`).toBe(false);
        }
      }
      if (name === "hostile-proposal") {
        const slide1 = new TextDecoder().decode(unzip(result.files.find((file) => file.format === "pptx")!.bytes).get("ppt/slides/slide1.xml")!);
        expect(slide1).toContain("Quill &amp; Ink &lt;Studio&gt;");
        expect(JSON.stringify(result.products)).not.toContain("attacker@example.com");
        expect(result.warnings.join(" ")).toContain("instruction-like text");
      }
    }
  }, 60_000);

  it("flags content that cannot fit at the readable minimum instead of shrinking it", async () => {
    const { ready } = await liveCase();
    const deck = structuredClone(ready.products.find((product) => product.kind === "presentation")!);
    deck.slides[1]!.blocks[0]!.items = Array.from({ length: 14 }, (_, index) => `A long objective statement number ${index} that keeps going to fill the slide with dense detail`);
    deck.slides[2]!.title = "A".repeat(10) + " very long slide title ".repeat(12);
    const issues = deckLayoutIssues(deck);
    expect(issues.some((issue) => issue.includes("does not fit at the 14 pt minimum"))).toBe(true);
    expect(issues.some((issue) => issue.includes("title is too long"))).toBe(true);
  });

  it("strips XML-invalid characters but keeps valid text, emoji, and RTL", () => {
    expect(officeText("a\u0000b\u0007c\u000Bd￾e\uD800f 📦 مرحبا\tg\nh")).toBe("abcdef 📦 مرحبا\tg\nh");
  });
});
