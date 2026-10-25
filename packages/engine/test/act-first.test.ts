import { describe, expect, it } from "vitest";
import type { EngineInput } from "@afterhours/contracts";
import { createEngine, type ModelClient, type ModelRequest, type ModelResponse } from "../src/index";
import { systemPrompt } from "../src/liveSpec";
import { buildDeckFixture } from "../src/testing";
import { bytesOf, inputFor } from "./fixtures";

const deps = () => ({ signal: new AbortController().signal, onProgress: async () => undefined });
const ok = (value: unknown): ModelResponse => ({ text: JSON.stringify(value), status: "completed", usage: { inputTokens: 10, outputTokens: 5 }, providerRequestId: null });

function client(answer: (request: { sources: { id: string; kind: string; text: string; extractionStatus: string; filename: string | null }[]; calculationNote?: string }) => unknown) {
  const requests: ModelRequest[] = [];
  const c: ModelClient & { requests: ModelRequest[] } = {
    provider: "test", model: "fake-claude", requests,
    complete: async (request) => { requests.push(request); return ok(answer(JSON.parse(request.input))); },
  };
  return c;
}

const para = (id: string, heading: string, text: string) => ({ id, kind: "paragraph", heading, text, items: [], columns: [], rows: [], chart: null, evidence: [], basis: "recommendation" });
const bullets = (id: string, heading: string, items: string[]) => ({ id, kind: "bullets", heading, text: null, items, columns: [], rows: [], chart: null, evidence: [], basis: "recommendation" });
const documentAnswer = (title: string, assumptions: string[] = []) => ({
  outcome: "ready",
  plan: { title, requestSummary: "A one-page checklist.", requestedOutputs: ["document"], dueAt: null, dueAtExplanation: null, steps: ["Draft"], assumptions, questions: [], sourcesUsed: [] },
  products: [{ id: "p", kind: "document", title, subtitle: null, slides: [], assumptions: [], warnings: [], blocks: [para("b1", "Purpose", "Help every new hire feel ready on day one."), bullets("b2", "Before day one", ["Send the welcome message", "Prepare accounts and equipment"])] }],
});

/** Any email: no attachment, a request on any topic, nothing about proposals, reports or CSV files. */
async function plainRequest(subject: string, bodyText: string): Promise<EngineInput> {
  const base = await inputFor("proposal");
  return { ...base, mode: "live", fixtureScenario: null, attachments: [], email: { ...base.email, subject, bodyText, attachments: [] } };
}

describe("act first: any request is made right away", () => {
  it("makes a document from a request with no attachment, in one model call, without asking anything", async () => {
    const c = client(() => documentAnswer("New-hire onboarding checklist", ["Assumed a company of about ten people."]));
    const result = await createEngine({ modelClient: c }).runWork(await plainRequest("Onboarding checklist", "Please write a one-page onboarding checklist for new hires."), deps());
    expect(result.outcome).toBe("ready");
    if (result.outcome !== "ready") return;
    expect(c.requests).toHaveLength(1);
    expect(result.products.map((p) => p.kind)).toEqual(["document"]);
    expect(result.files.map((f) => f.format)).toEqual(["docx"]);
    expect(result.plan.assumptions).toContain("Assumed a company of about ten people.");
    expect(result.plan.questions).toEqual([]);
  });

  it("tells the model to act first, to treat attachments as optional, and to ask only when very ambiguous", () => {
    const prompt = systemPrompt();
    expect(prompt).toMatch(/Act first\. Prepare the work right away/);
    expect(prompt).toMatch(/whether or not files are attached/);
    expect(prompt).toMatch(/at most 3 short questions/);
    expect(prompt).toMatch(/never skip because the topic or file type is unfamiliar/);
    expect(prompt).not.toMatch(/Ask specific blocking questions for missing or conflicting fees, scope, dates, currency, or client identity instead of guessing/);
    expect(prompt).toMatch(/Never invent a fee, price, date, statistic/);
  });

  it("still asks a follow-up when the request is genuinely ambiguous", async () => {
    const c = client(() => ({
      outcome: "needs_input",
      plan: { title: "Request needed", requestSummary: "Unclear request.", requestedOutputs: [], dueAt: null, dueAtExplanation: null, steps: [], assumptions: [], sourcesUsed: [],
        questions: [{ id: "which_thing", question: "Do you want a pitch deck for investors or a one-page summary for customers?", reason: "The two readings need different work.", required: true }] },
    }));
    const result = await createEngine({ modelClient: c }).runWork(await plainRequest("the thing", "Can you do the thing we talked about?"), deps());
    expect(result.outcome).toBe("needs_input");
    if (result.outcome === "needs_input") expect(result.questions).toHaveLength(1);
  });

  it("does not fail a report request because the attached CSV is not the sales layout; it warns and goes on", async () => {
    const base = await plainRequest("Report on our signups", "Please prepare a report on the attached signups.");
    const csv = bytesOf("week,signups\n1,10\n2,14\n3,9\n");
    const input: EngineInput = { ...base,
      attachments: [{ id: "a1", filename: "signups.csv", mimeType: "text/csv", bytes: csv }],
      email: { ...base.email, attachments: [{ id: "a1", filename: "signups.csv", mimeType: "text/csv", sizeBytes: csv.byteLength }] } };
    const c = client(() => documentAnswer("Signups report"));
    const result = await createEngine({ modelClient: c }).runWork(input, deps());
    expect(result.outcome).toBe("ready");
    if (result.outcome !== "ready") return;
    expect(result.warnings.join(" ")).toMatch(/CSV could not be used for calculated figures/);
    const sent = JSON.parse(c.requests[0]!.input) as { calculationNote?: string; sources: { kind: string; text: string }[] };
    expect(sent.calculationNote).toMatch(/Treat it as plain text/);
    expect(sent.sources.find((source) => source.kind === "attachment")!.text).toContain("1,10");
  });

  it("reads a PowerPoint attachment as source material instead of reporting it unsupported", async () => {
    const base = await plainRequest("Turn this into a summary", "Please write a short summary document of the attached deck.");
    const deck = await buildDeckFixture([{ title: "Harvest plan", bullets: ["Pick on Tuesday", "Pack by noon"], notes: "Weather permitting" }]);
    const input: EngineInput = { ...base,
      attachments: [{ id: "a1", filename: "plan.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: deck }],
      email: { ...base.email, attachments: [{ id: "a1", filename: "plan.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", sizeBytes: deck.byteLength }] } };
    const c = client(() => documentAnswer("Harvest plan summary"));
    const result = await createEngine({ modelClient: c }).runWork(input, deps());
    expect(result.outcome).toBe("ready");
    const sent = JSON.parse(c.requests[0]!.input) as { sources: { kind: string; extractionStatus: string; text: string }[] };
    const source = sent.sources.find((s) => s.kind === "attachment")!;
    expect(source.extractionStatus).toBe("complete");
    expect(source.text).toContain("[Slide 1]");
    expect(source.text).toContain("Harvest plan");
    expect(source.text).toContain("Pack by noon");
  });

  it("does not stop on a file it cannot read: the request is still made and the file is flagged", async () => {
    const base = await plainRequest("Meeting notes", "Please turn these into clean meeting notes.");
    const pdf = bytesOf("%PDF-1.4 not really");
    const input: EngineInput = { ...base,
      attachments: [{ id: "a1", filename: "notes.pdf", mimeType: "application/pdf", bytes: pdf }],
      email: { ...base.email, attachments: [{ id: "a1", filename: "notes.pdf", mimeType: "application/pdf", sizeBytes: pdf.byteLength }] } };
    const c = client(() => documentAnswer("Meeting notes", ["notes.pdf could not be read, so it was not used."]));
    const result = await createEngine({ modelClient: c }).runWork(input, deps());
    expect(result.outcome).toBe("ready");
    const sent = JSON.parse(c.requests[0]!.input) as { sources: { kind: string; extractionStatus: string }[] };
    expect(sent.sources.find((s) => s.kind === "attachment")!.extractionStatus).toBe("unsupported");
  });
});
