/**
 * Final audit regressions (docs/audits/final/audit.md). Each test reproduces a defect or checks a
 * required behavior through the real pipeline with fixture inputs; no model is called.
 */
import { describe, expect, it } from "vitest";
import type { EngineInput } from "@afterhours/contracts";
import { calculateSales, runWork } from "../src/index";
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
