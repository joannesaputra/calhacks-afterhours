import { describe, expect, it } from "vitest";
import { ContentBlockSchema, OutputKindSchema, SlideContentSchema, SourceRefSchema, WorkPlanSchema, WorkProductSchema, WorkQuestionSchema, type EngineInput } from "@afterhours/contracts";
import { z } from "zod";
import { createEngine, EngineError, type ModelClient, type ModelRequest, type ModelResponse } from "../src/index";
import { FORMAT_EXAMPLE, LiveResponseSchema, responseJsonSchema, systemPrompt } from "../src/liveSpec";
import { inputFor } from "./fixtures";

const deps = () => ({ signal: new AbortController().signal, onProgress: async () => undefined });
const ok = (value: unknown): ModelResponse => ({ text: JSON.stringify(value), status: "completed", usage: { inputTokens: 10, outputTokens: 5 }, providerRequestId: null });

/** Provider-boundary fake: records every request and answers from a script that sees the request's own sources. */
function scripted(answers: Array<(sources: SourceView[]) => unknown>): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    provider: "test", model: "fake-claude", requests,
    complete: async (request) => {
      requests.push(request);
      const answer = answers[requests.length - 1];
      if (!answer) throw new Error("unexpected extra provider call");
      const parsed = JSON.parse(request.input) as { sources?: SourceView[]; originalRequest?: { sources: SourceView[] } };
      return ok(answer(parsed.sources ?? parsed.originalRequest!.sources));
    },
  };
}
interface SourceView { id: string; kind: string; text: string; extractionStatus: string }
const liveInput = async (): Promise<EngineInput> => ({ ...(await inputFor("proposal")), mode: "live", fixtureScenario: null });
const run = async (client: ModelClient) => createEngine({ modelClient: client }).runWork(await liveInput(), deps());

const block = (id: string, kind: "paragraph" | "bullets", basis: "source" | "recommendation" | "assumption", content: string | string[], evidence: unknown[] = [], heading: string | null = null) => ({
  id, kind, heading, text: kind === "paragraph" ? content : null, items: kind === "bullets" ? content : [], columns: [], rows: [], chart: null, evidence, basis,
});
const slide = (n: number, title: string, layout: string, blocks: unknown[]) => ({ id: `slide-${n}`, title, layout, blocks, speakerNotes: "" });

/** A response written by hand from the request's own sources (not produced by the fixture engine). */
function validProposal(sources: SourceView[], overrides: { fee?: string; sourceId?: string; kind?: string } = {}) {
  const brief = sources.find((source) => source.kind === "attachment")!;
  const email = sources.find((source) => source.kind === "email")!;
  const quote = /The authorized strategy budget is USD 6,000;[^.]*\./.exec(brief.text)![0];
  const cite = [{ sourceId: overrides.sourceId ?? brief.id, locator: "budget sentence", quote }];
  const fee = overrides.fee ?? "USD 6,000";
  return {
    outcome: "ready",
    plan: { title: "Proposal and kickoff deck", requestSummary: "A proposal document and a five-slide kickoff deck.", requestedOutputs: [overrides.kind ?? "proposal", "presentation"], dueAt: null, dueAtExplanation: null, steps: ["Read the brief", "Draft both products"], assumptions: [], questions: [], sourcesUsed: [brief.id, email.id] },
    products: [
      { id: "p1", kind: "proposal", title: "Proposal", subtitle: null, slides: [], assumptions: [], warnings: [], blocks: [
        block("b1", "paragraph", "source", `The authorized strategy budget is ${fee}; paid media is separate.`, cite, "Fee"),
        block("b2", "bullets", "recommendation", ["Confirm the scope and schedule before any agreement."], [], "Next steps"),
      ] },
      { id: "p2", kind: "presentation", title: "Kickoff deck", subtitle: null, blocks: [], assumptions: [], warnings: [], slides: [
        slide(1, "Kickoff", "title", [block("s1b", "paragraph", "recommendation", "Review draft")]),
        slide(2, "Goals", "bullets", [block("s2b", "bullets", "source", ["Audience hypothesis", "Message directions"], cite)]),
        slide(3, "Scope", "bullets", [block("s3b", "bullets", "source", ["Discovery", "Measurement plan"], cite)]),
        slide(4, "Fee", "bullets", [block("s4b", "bullets", "source", [`Strategy fee: ${fee}`], cite)]),
        slide(5, "Next steps", "closing", [block("s5b", "bullets", "recommendation", ["Confirm scope", "Agree milestones"])]),
      ] },
    ],
  };
}

describe("model-facing output specification", () => {
  const spec = JSON.parse(responseJsonSchema()) as unknown;
  type Node = { properties?: Record<string, unknown>; required?: string[] };
  /** Every object node anywhere in the schema, including inlined and $defs ones. */
  const objects = (node: unknown): Node[] => {
    if (Array.isArray(node)) return node.flatMap(objects);
    if (!node || typeof node !== "object") return [];
    const record = node as Record<string, unknown>;
    return [...(record.properties ? [record as Node] : []), ...Object.values(record).flatMap(objects)];
  };
  const shapeOf = (schema: unknown) => Object.keys((schema as z.ZodObject<z.ZodRawShape>).shape);

  it("carries every field of every nested contract schema, as required properties", () => {
    for (const schema of [WorkPlanSchema, WorkProductSchema, ContentBlockSchema, SlideContentSchema, SourceRefSchema, WorkQuestionSchema.omit({ options: true })]) {
      const keys = shapeOf(schema);
      const match = objects(spec).find((node) => Object.keys(node.properties!).length === keys.length && keys.every((key) => key in node.properties!));
      expect(match, `no definition with exactly ${keys.join(",")}`).toBeDefined();
      expect([...match!.required!].sort()).toEqual([...keys].sort());
    }
  });

  it("carries every enum value and distinguishes output kinds from file formats", () => {
    const text = responseJsonSchema();
    for (const value of [...OutputKindSchema.options, ...ContentBlockSchema.shape.kind.options, ...ContentBlockSchema.shape.basis.options, ...SlideContentSchema.shape.layout.options, "bar", "line"]) expect(text, value).toContain(`"${value}"`);
    const prompt = systemPrompt();
    expect(prompt).toMatch(/"docx" and "pptx" are file formats/);
    expect(prompt).toMatch(/ONLY "proposal", "report", "presentation" or "document"/);
  });

  it("is derived from the validating schema, so changing the schema changes the specification", () => {
    const changed = z.object({ kind: z.enum(["alpha", "beta"]), extra: z.string() });
    const derived = responseJsonSchema(changed);
    expect(derived).toContain('"alpha"');
    expect(derived).toContain('"extra"');
    expect(derived).not.toContain('"requestedOutputs"');
    expect(systemPrompt(changed)).toContain(derived);
  });

  it("keeps the hand-written field rules consistent with the schema enums", () => {
    const rules = systemPrompt().slice(systemPrompt().indexOf("Field rules"));
    const sentence = (marker: string) => rules.split("\n").find((line) => line.includes(marker))!;
    const quoted = (line: string) => [...line.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
    for (const option of OutputKindSchema.options) expect(sentence("ONLY"), option).toContain(`"${option}"`);
    for (const option of SlideContentSchema.shape.layout.options) expect(sentence("layout of"), option).toContain(`"${option}"`);
    for (const option of ContentBlockSchema.shape.basis.options) expect(rules, option).toContain(`"${option}"`);
    // Everything the rules quote as a value must be a real enum option, a field name or an outcome (no drifted or invented value).
    const fields = objects(spec).flatMap((node) => Object.keys(node.properties!));
    const requestFields = ["calculatedMetrics", "calculatedDates", "requestedSlides", "sources", "extractionStatus"];
    const known = new Set<string>([...OutputKindSchema.options, ...SlideContentSchema.shape.layout.options, ...ContentBlockSchema.shape.basis.options, ...ContentBlockSchema.shape.kind.options, ...fields, ...requestFields, "docx", "pptx", "ready", "needs_input", "skipped", "complete"]);
    const stray = quoted(rules).filter((word) => !known.has(word));
    expect(stray).toEqual([]);
  });

  it("is what the legacy instruction text lacked: no field or enum was named", () => {
    const LEGACY = 'with "outcome" set to "ready", "needs_input", or "skipped", plus "plan" (and "products" when ready) matching the AfterHours WorkPlan and WorkProduct shapes.';
    for (const needle of ["requestedOutputs", "presentation", "evidence", "basis", "speakerNotes"]) expect(LEGACY).not.toContain(needle);
    for (const needle of ["requestedOutputs", "presentation", "evidence", "basis", "speakerNotes"]) expect(systemPrompt()).toContain(needle);
  });

  it("includes a format example that validates but cannot pass as content", async () => {
    expect(LiveResponseSchema.safeParse(FORMAT_EXAMPLE).success).toBe(true);
    const client = scripted([() => FORMAT_EXAMPLE, () => FORMAT_EXAMPLE]);
    await expect(run(client)).rejects.toMatchObject({ code: "MODEL_INVALID_OUTPUT", retryable: false });
    expect(client.requests).toHaveLength(2);
  });
});

describe("live generation with the specification", () => {
  it("accepts a hand-written valid response in one call, with code-derived deadline and IDs", async () => {
    const client = scripted([(sources) => validProposal(sources)]);
    const result = await run(client);
    expect(client.requests).toHaveLength(1);
    expect(result.outcome).toBe("ready");
    if (result.outcome !== "ready") return;
    expect(result.products.map((product) => product.kind).sort()).toEqual(["presentation", "proposal"]);
    expect(result.products[1]!.slides).toHaveLength(5);
    expect(result.plan.dueAt).toMatch(/^2026-10-26T/);
    for (const product of result.products) expect(product.id).not.toMatch(/^p[12]$/);
    expect(result.files.map((file) => file.format).sort()).toEqual(["docx", "pptx"]);
  });

  it("rejects 'docx' as an output kind, then repairs with the same specification and the actual issue (exactly two calls)", async () => {
    const client = scripted([(sources) => validProposal(sources, { kind: "docx" }), (sources) => validProposal(sources)]);
    const result = await run(client);
    expect(result.outcome).toBe("ready");
    expect(client.requests).toHaveLength(2);
    const [first, repair] = client.requests as [ModelRequest, ModelRequest];
    expect(first.instructions).toContain(responseJsonSchema());
    expect(repair.instructions).toContain(responseJsonSchema());
    expect(repair.instructions).toContain("Field rules");
    const sent = JSON.parse(repair.input) as { validationIssues: string[]; originalRequest: { sources: unknown[] }; previousResponse: string };
    expect(sent.validationIssues.join("\n")).toMatch(/plan\.requestedOutputs\.0/);
    expect(sent.originalRequest.sources.length).toBeGreaterThan(0);
    expect(JSON.parse(sent.previousResponse).plan.requestedOutputs[0]).toBe("docx");
  });

  it("fails nonretryable after one repair and never makes a third call", async () => {
    const client = scripted([(sources) => validProposal(sources, { kind: "docx" }), (sources) => validProposal(sources, { kind: "docx" })]);
    const error = await run(client).catch((caught: unknown) => caught as EngineError);
    expect(error).toMatchObject({ code: "MODEL_INVALID_OUTPUT", retryable: false });
    expect(client.requests).toHaveLength(2);
  });

  it("still applies grounding after a structurally valid answer: an unsupported amount and an unknown source are reported together", async () => {
    const client = scripted([(sources) => validProposal(sources, { fee: "USD 9,500", sourceId: "src-invented" }), (sources) => validProposal(sources)]);
    const result = await run(client);
    expect(result.outcome).toBe("ready");
    const issues = (JSON.parse(client.requests[1]!.input) as { validationIssues: string[] }).validationIssues.join("\n");
    expect(issues).toMatch(/UNSUPPORTED_NUMBER/);
    expect(issues).toMatch(/UNGROUNDED_CONTENT/);
  });

  it("keeps needs_input and skipped working, and does not let a ready result carry a required question", async () => {
    const ask = (sources: SourceView[]) => ({ outcome: "needs_input", plan: { ...validProposal(sources).plan, requestedOutputs: ["proposal"], questions: [{ id: "q-fee", question: "What fee is authorized?", reason: "The sources do not state a fee.", required: true }] } });
    const asked = await run(scripted([ask]));
    expect(asked).toMatchObject({ outcome: "needs_input", questions: [{ id: "q-fee" }] });
    const skipped = await run(scripted([() => ({ outcome: "skipped", reason: "No delegated work request." })]));
    expect(skipped).toMatchObject({ outcome: "skipped", reason: "No delegated work request." });
    const bypass = scripted([(sources) => { const value = validProposal(sources); value.plan.questions = [{ id: "q1", question: "Which client?", reason: "Unknown", required: true }] as never; return value; }, (sources) => validProposal(sources)]);
    expect((await run(bypass)).outcome).toBe("ready");
    expect((JSON.parse(bypass.requests[1]!.input) as { validationIssues: string[] }).validationIssues.join("\n")).toMatch(/required unanswered questions/);
  });
});
