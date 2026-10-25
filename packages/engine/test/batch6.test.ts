import { describe, expect, it } from "vitest";
import type { EngineInput } from "@afterhours/contracts";
import { calculateSales, runWork } from "../src/index";
import { inputFor } from "./fixtures";
import { unzip } from "./zip";

const deps = () => ({ signal: new AbortController().signal, onProgress: async () => undefined });

async function reportWith(edit: (csv: string) => string): Promise<EngineInput> {
  const base = await inputFor("report");
  const bytes = new TextEncoder().encode(edit(new TextDecoder().decode(base.attachments[0]!.bytes)));
  return { ...base, attachments: [{ ...base.attachments[0]!, bytes }], email: { ...base.email, attachments: [{ ...base.email.attachments[0]!, sizeBytes: bytes.byteLength }] } };
}

describe("Batch 6 report variation", () => {
  it("recomputes the spec variation (February Website 10,000 -> 11,000) everywhere", async () => {
    const input = await reportWith((csv) => csv.replace("2026-02,Website,10000", "2026-02,Website,11000"));
    const metrics = calculateSales(new TextDecoder().decode(input.attachments[0]!.bytes));
    expect([metrics.months[1]!.revenueMinor, metrics.revenueChangeMinor, metrics.revenueGrowthPercent, metrics.months[1]!.orders, metrics.months[1]!.averageOrderValueMinor]).toEqual([1_600_000, 400_000, 33.33, 150, 10_667]);
    const result = await runWork(input, deps());
    if (result.outcome !== "ready") throw new Error(`expected ready, got ${result.outcome}`);
    const text = JSON.stringify(result.products);
    for (const expected of ["$16,000", "$4,000", "33.3%", "$106.67", "Revenue increased 33.3%"]) expect(text).toContain(expected);
    for (const stale of ["$15,000", "$3,000", "Revenue increased 25%"]) expect(text).not.toContain(stale);
    const chart = result.products.find((product) => product.kind === "report")!.blocks.find((block) => block.kind === "chart")!.chart!;
    expect(chart.series[0]!.values).toEqual([12_000, 16_000]);
    const deck = unzip(result.files.find((file) => file.format === "pptx")!.bytes);
    // The cover dashboard adds charts before the revenue-by-month chart, so look across every chart part.
    expect([...deck].filter(([name]) => /^ppt\/charts\/chart\d+\.xml$/.test(name)).map(([, bytes]) => new TextDecoder().decode(bytes)).join("")).toContain("<c:v>16000</c:v>");
    expect(new TextDecoder().decode(deck.get("ppt/slides/slide2.xml")!)).toContain("Revenue increased 33.3%");
  }, 20_000);

  it("says 'in both months' instead of 'X to X' for unchanged metrics", async () => {
    const result = await runWork(await inputFor("report"), deps());
    if (result.outcome !== "ready") throw new Error("expected ready");
    const deck = JSON.stringify(result.products.find((product) => product.kind === "presentation"));
    expect(deck).toContain("Average order value held at $100 in both months");
    expect(deck).toContain("Website kept 66.7% of revenue in both months");
    expect(deck).not.toContain("$100 to $100");
  }, 20_000);

  it("never rejects its own rounded percentages across many revenue values", async () => {
    // Regression: 25.83% displayed as 25.8% was rejected as an unsupported number.
    for (let february = 9_000; february <= 11_200; february += 37) {
      const result = await runWork(await reportWith((csv) => csv.replace("2026-02,Website,10000", `2026-02,Website,${february}`)), deps());
      expect(result.outcome, `February Website ${february}`).toBe("ready");
    }
  }, 120_000);
});
