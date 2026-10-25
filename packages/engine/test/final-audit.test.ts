/**
 * Final audit regressions (docs/audits/final/audit.md). Each test reproduces a defect or checks a
 * required behavior through the real pipeline with fixture inputs; no model is called.
 */
import { describe, expect, it } from "vitest";
import type { EngineInput } from "@afterhours/contracts";
import { calculateSales, createEngine, runWork, type ModelClient } from "../src/index";
import { inputFor, text, withAttachmentText } from "./fixtures";
import { unzip } from "./zip";

const deps = () => ({ signal: new AbortController().signal, onProgress: async () => undefined });
const ready = async (input: EngineInput) => {
  const result = await runWork(input, deps());
  if (result.outcome !== "ready") throw new Error(`expected ready, got ${result.outcome}`);
  return result;
};
/** All visible text of the products plus the text runs of both exported files. */
const allText = (result: Awaited<ReturnType<typeof ready>>) => {
  const blocks = result.products.flatMap((product) => [...product.blocks, ...product.slides.flatMap((slide) => slide.blocks)]);
  const preview = [...result.products.flatMap((product) => product.slides.map((slide) => `${slide.title}\n${slide.speakerNotes}`)), ...blocks.map((block) => [block.heading, block.text, ...block.items, ...block.rows.flat()].filter(Boolean).join("\n"))].join("\n");
  const files = result.files.map((file) => [...unzip(file.bytes)].filter(([name]) => /^(word\/document|ppt\/slides\/slide\d+)\.xml$/.test(name)).map(([, bytes]) => text(bytes).replace(/<[^>]+>/g, " ")).join("\n")).join("\n");
  return `${preview}\n${files}`;
};
const csvOf = (input: EngineInput) => text(input.attachments[0]!.bytes);

describe("report: a month with no revenue", () => {
  const zeroJanuary = async () => withAttachmentText(await inputFor("report"), (csv) => csv.replace("2026-01,Website,8000,80", "2026-01,Website,0,0").replace("2026-01,Partnerships,4000,40", "2026-01,Partnerships,0,0"));

  it("has no channel shares for that month instead of a calculated 0%", async () => {
    const metrics = calculateSales(csvOf(await zeroJanuary()));
    expect(metrics.channels.map((channel) => channel.sharePercent["2026-01"])).toEqual([null, null]);
    expect(metrics.websiteSharePercent).toEqual({ "2026-01": null, "2026-02": 66.7 });
  });

  it("says the share and the percent change are not defined, in the preview and in both files", async () => {
    const all = allText(await ready(await zeroJanuary()));
    expect(all).toContain("January 2026 had no recorded revenue, so no channel shares are defined for it; Website represented 66.7% of revenue in February 2026.");
    expect(all).toContain("revenue rose from zero, so no percent change is defined");
    expect(all).toContain("not defined (no revenue that month) to 66.7%");
    expect(all).not.toMatch(/0% of revenue in January|increased not computable|Website share of revenue: 0%/);
  });

  it("keeps the two-month wording when both months have revenue", async () => {
    const all = allText(await ready(await inputFor("report")));
    expect(all).toContain("Website represented 66.7% of revenue in January 2026 and 66.7% in February 2026");
  });
});

describe("report: changed input changes metrics and narrative together", () => {
  it("February website revenue 10,000 -> 11,000 gives 16,000 total, +4,000, 33.3% and $106.67 average order value", async () => {
    const input = withAttachmentText(await inputFor("report"), (csv) => csv.replace("2026-02,Website,10000,100", "2026-02,Website,11000,100"));
    const metrics = calculateSales(csvOf(input));
    expect([metrics.months[1]!.revenueMinor, metrics.revenueChangeMinor, metrics.revenueGrowthPercent, metrics.months[1]!.averageOrderValueMinor]).toEqual([1_600_000, 400_000, 33.33, 10_667]);
    const all = allText(await ready(input));
    expect(all).toContain("Revenue moved from $12,000 in January 2026 to $16,000 in February 2026, a change of $4,000 (revenue increased 33.3%).");
    expect(all).toContain("average order value moved from $100 to $106.67");
    expect(all).not.toContain("$15,000");
  });
});

describe("O7: an email with no subject or text asks what is wanted before anything is prepared", () => {
  /** A real Gmail shape seen in the live check: empty subject and body, only the project brief attached. */
  const attachmentOnly = async (subject = ""): Promise<EngineInput> => {
    const base = await inputFor("proposal");
    return { ...base, mode: "live", fixtureScenario: null, email: { ...base.email, subject, bodyText: "" } };
  };
  const countingClient = () => {
    const calls: string[] = [];
    const client: ModelClient = { provider: "test", model: "test-model", async complete(request) { calls.push(request.input); throw new Error("the model must not be called"); } };
    return { client, calls };
  };

  it("live mode: needs_input with one requested_work question, zero model calls, no products or files", async () => {
    const { client, calls } = countingClient();
    const result = await createEngine({ modelClient: client }).runWork(await attachmentOnly(), deps());
    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe("needs_input");
    if (result.outcome !== "needs_input") return;
    expect(result.questions.map((question) => [question.id, question.required])).toEqual([["requested_work", true]]);
    expect(result.plan.requestedOutputs).toEqual([]);
    expect(result).not.toHaveProperty("files");
  });

  it("Gmail's \"(no subject)\" placeholder is not request text; the same email in fixture mode also asks", async () => {
    const { client, calls } = countingClient();
    expect((await createEngine({ modelClient: client }).runWork(await attachmentOnly("(no subject)"), deps())).outcome).toBe("needs_input");
    expect(calls).toHaveLength(0);
    expect((await runWork({ ...(await attachmentOnly()), mode: "fixture" }, deps())).outcome).toBe("needs_input");
  });

  it("an email with request text is unaffected: the subject alone is enough to reach the model", async () => {
    const { client, calls } = countingClient();
    await createEngine({ modelClient: client }).runWork(await attachmentOnly("Proposal for Maple & Moss"), deps()).catch(() => undefined);
    expect(calls).toHaveLength(1);
  });

  it("after the question is answered, the answer is the request: the model is called with it", async () => {
    const { client, calls } = countingClient();
    const answered = { ...(await attachmentOnly()), revision: 2, answers: [{ questionId: "requested_work", answer: "A proposal and a five-slide deck for Maple & Moss from the attached brief." }] };
    await createEngine({ modelClient: client }).runWork(answered, deps()).catch(() => undefined);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("A proposal and a five-slide deck for Maple & Moss");
  });

  it("fixture mode: answering with a report request on a CSV-only email produces the calculated report", async () => {
    const base = await inputFor("report");
    const input: EngineInput = { ...base, fixtureScenario: null, revision: 2, email: { ...base.email, subject: "", bodyText: "" },
      answers: [{ questionId: "requested_work", answer: "Please prepare a sales performance report and deck from the attached CSV." }] };
    const result = await ready(input);
    expect(result.products.map((product) => product.kind)).toEqual(["report", "presentation"]);
    expect(allText(result)).toContain("Revenue moved from $12,000 in January 2026 to $15,000 in February 2026");
  });
});
