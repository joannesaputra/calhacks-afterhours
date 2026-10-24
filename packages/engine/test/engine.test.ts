import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DemoFixture, EngineInput, OrganizationProfile } from "@afterhours/contracts";
import { calculateSales, EngineError, resolveDeadline, runWork } from "../src/index";
import { unzip } from "./zip";

const root = resolve(import.meta.dirname, "../../..");
const loadJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(resolve(root, path), "utf8")) as T;

async function inputFor(scenario: DemoFixture["scenario"], overrides: Partial<EngineInput> = {}): Promise<EngineInput> {
  const fixture = await loadJson<DemoFixture>(`fixtures/scenarios/${scenario}.json`);
  const organization = await loadJson<OrganizationProfile>("fixtures/organization/harbor-creative.json");
  const attachments = await Promise.all(fixture.attachmentFiles.map(async (entry) => {
    const meta = fixture.email.attachments.find((item) => item.id === entry.attachmentId)!;
    return { id: meta.id, filename: meta.filename, mimeType: meta.mimeType, bytes: new Uint8Array(await readFile(resolve(root, "fixtures", entry.relativePath))) };
  }));
  return { taskId: `task-${scenario}`, revision: 1, mode: "fixture", email: fixture.email, attachments, organization, answers: [], now: "2026-10-23T20:00:00.000Z", fixtureScenario: scenario, ...overrides };
}

const deps = () => ({ onProgress: async () => undefined, signal: new AbortController().signal });

describe("sales calculations", () => {
  it("computes the exact report metrics from CSV", async () => {
    const metrics = calculateSales(await readFile(resolve(root, "fixtures/attachments/sales.csv"), "utf8"));
    expect(metrics.months).toEqual([
      { month: "2026-01", revenueMinor: 1_200_000, orders: 120, averageOrderValueMinor: 10_000 },
      { month: "2026-02", revenueMinor: 1_500_000, orders: 150, averageOrderValueMinor: 10_000 },
    ]);
    expect(metrics.revenueChangeMinor).toBe(300_000);
    expect(metrics.revenueGrowthPercent).toBe(25);
    expect(metrics.websiteSharePercent).toEqual({ "2026-01": 66.7, "2026-02": 66.7 });
  });

  it("changes results when the input changes and handles a zero denominator", () => {
    const changed = calculateSales("month,channel,revenue_usd,orders\n2026-01,Website,0,0\n2026-02,Website,200,2\n");
    expect(changed.months[1]?.revenueMinor).toBe(20_000);
    expect(changed.revenueGrowthPercent).toBeNull();
    expect(changed.months[0]?.averageOrderValueMinor).toBeNull();
  });

  it("rejects blank numeric values instead of treating them as zero", () => {
    expect(() => calculateSales("month,channel,revenue_usd,orders\n2026-01,Website,,1\n2026-02,Website,2,1\n")).toThrow(EngineError);
  });
});

describe("fixture pipeline", () => {
  it("resolves relative deadlines from receivedAt in the organization timezone, never run time", () => {
    const deadline = resolveDeadline("Please send this by next Monday at 9 AM.", "2026-10-23T19:00:00.000Z", "America/Los_Angeles");
    expect(deadline?.dueAt).toBe("2026-10-26T16:00:00.000Z");
    expect(deadline?.explanation).toContain("email.receivedAt");
  });

  it("skips an informational message without files", async () => {
    const result = await runWork(await inputFor("no_action"), deps());
    expect(result.outcome).toBe("skipped");
  });

  it("asks stable blocking questions and resumes with supplied answers", async () => {
    const initial = await runWork(await inputFor("ambiguous"), deps());
    expect(initial.outcome).toBe("needs_input");
    if (initial.outcome !== "needs_input") return;
    expect(initial.questions.map((question) => question.id)).toEqual(["client_identity", "project_scope", "authorized_fee", "project_schedule"]);
    const answered = await inputFor("ambiguous", { revision: 2, answers: initial.questions.map((question) => ({ questionId: question.id, answer: ({ client_identity: "Northstar Co.", project_scope: "Launch positioning and a four-week content plan", authorized_fee: "USD 6,000", project_schedule: "November 2-29, 2026" } as Record<string, string>)[question.id]! })) });
    const resumed = await runWork(answered, deps());
    expect(resumed.outcome).toBe("ready");
    if (resumed.outcome === "ready") expect(JSON.stringify(resumed.products)).toContain("Northstar Co.");
  });

  it("exports a grounded proposal DOCX and exactly five-slide PPTX", async () => {
    const result = await runWork(await inputFor("proposal"), deps());
    expect(result.outcome).toBe("ready");
    if (result.outcome !== "ready") return;
    expect(result.files.map((file) => file.format).sort()).toEqual(["docx", "pptx"]);
    expect(result.files.every((file) => file.bytes.byteLength > 1_000 && file.bytes[0] === 0x50 && file.bytes[1] === 0x4b)).toBe(true);
    expect(result.products.find((product) => product.kind === "presentation")?.slides).toHaveLength(5);
    expect(JSON.stringify(result.products)).toContain("USD 6,000");
    const docx = unzip(result.files.find((file) => file.format === "docx")!.bytes);
    expect(Buffer.from(docx.get("word/document.xml")!).toString("utf8")).toContain("Maple &amp; Moss Proposal");
    const pptx = unzip(result.files.find((file) => file.format === "pptx")!.bytes);
    expect([...pptx.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(5);
    expect(Buffer.from(pptx.get("ppt/slides/slide1.xml")!).toString("utf8")).toContain("Maple &amp; Moss proposal kickoff");
    if (process.env.ENGINE_RENDER_DIR) {
      await mkdir(process.env.ENGINE_RENDER_DIR, { recursive: true });
      await Promise.all(result.files.map((file) => writeFile(resolve(process.env.ENGINE_RENDER_DIR!, file.filename), file.bytes)));
    }
  }, 20_000);

  it("derives the client from the actual email and brief instead of a fixture constant", async () => {
    const changed = await inputFor("proposal");
    changed.email.subject = changed.email.subject.replace("Maple & Moss", "Cedar & Sage");
    const text = new TextDecoder().decode(changed.attachments[0]!.bytes).replaceAll("Maple & Moss", "Cedar & Sage");
    changed.attachments[0] = { ...changed.attachments[0]!, bytes: new TextEncoder().encode(text) };
    const result = await runWork(changed, deps());
    expect(result.outcome).toBe("ready");
    if (result.outcome === "ready") {
      expect(JSON.stringify(result.products)).toContain("Cedar & Sage");
      expect(JSON.stringify(result.products)).not.toContain("Maple & Moss");
    }
  });

  it("surfaces a material fee conflict instead of inventing or silently choosing", async () => {
    const changed = await inputFor("proposal");
    const text = new TextDecoder().decode(changed.attachments[0]!.bytes).replace("USD 6,000", "USD 7,000");
    changed.attachments[0] = { ...changed.attachments[0]!, bytes: new TextEncoder().encode(text) };
    const result = await runWork(changed, deps());
    expect(result.outcome).toBe("needs_input");
    if (result.outcome === "needs_input") {
      expect(result.questions).toContainEqual(expect.objectContaining({ id: "proposal_fee_conflict" }));
      expect(result.questions[0]?.reason).toContain("USD 6,000");
      expect(result.questions[0]?.reason).toContain("USD 7,000");
    }
  });

  it("honors an already-aborted worker signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runWork(await inputFor("proposal"), { onProgress: async () => undefined, signal: controller.signal }))
      .rejects.toMatchObject({ code: "ENGINE_ABORTED", retryable: true });
  });

  it("keeps report preview, chart, and exported files on calculated values", async () => {
    const result = await runWork(await inputFor("report"), deps());
    expect(result.outcome).toBe("ready");
    if (result.outcome !== "ready") return;
    const text = JSON.stringify(result.products);
    expect(text).toContain("$12,000");
    expect(text).toContain("$15,000");
    expect(text).toContain("25%");
    expect(text).toContain("66.7%");
    expect(result.products.find((product) => product.kind === "presentation")?.slides).toHaveLength(5);
  }, 20_000);

  it("treats prompt injection attachment text as data and retains normal policy", async () => {
    const base = await inputFor("proposal");
    const injection = new Uint8Array(await readFile(resolve(root, "fixtures/attachments/prompt-injection.txt")));
    base.email.attachments.push({ id: "att-injection", filename: "prompt-injection.txt", mimeType: "text/plain", sizeBytes: injection.byteLength });
    base.attachments.push({ id: "att-injection", filename: "prompt-injection.txt", mimeType: "text/plain", bytes: injection });
    const result = await runWork(base, deps());
    expect(result.outcome).toBe("ready");
    if (result.outcome === "ready") {
      expect(result.files).toHaveLength(2);
      expect(JSON.stringify(result.products)).not.toContain("attacker@example.com");
    }
  });

  it("rejects an attachment over the per-file limit", async () => {
    const base = await inputFor("proposal");
    base.attachments[0] = { ...base.attachments[0]!, bytes: new Uint8Array(10 * 1024 * 1024 + 1) };
    await expect(runWork(base, deps())).rejects.toMatchObject({ code: "INPUT_LIMIT", retryable: false });
  });

  it("uses stable file IDs for a revision and different IDs for a new revision", async () => {
    const first = await runWork(await inputFor("proposal"), deps());
    const retry = await runWork(await inputFor("proposal"), deps());
    const next = await runWork(await inputFor("proposal", { revision: 2 }), deps());
    if (first.outcome !== "ready" || retry.outcome !== "ready" || next.outcome !== "ready") throw new Error("unexpected outcome");
    expect(first.files.map((file) => file.id)).toEqual(retry.files.map((file) => file.id));
    expect(first.files.map((file) => file.id)).not.toEqual(next.files.map((file) => file.id));
  }, 30_000);
});

describe("live configuration", () => {
  it("fails clearly without credentials and never falls back to fixtures", async () => {
    const previous = { provider: process.env.MODEL_PROVIDER, model: process.env.MODEL_NAME, key: process.env.ANTHROPIC_API_KEY };
    delete process.env.MODEL_PROVIDER; delete process.env.MODEL_NAME; delete process.env.ANTHROPIC_API_KEY;
    await expect(runWork(await inputFor("proposal", { mode: "live" }), deps())).rejects.toMatchObject({ code: "MODEL_CONFIGURATION", retryable: false });
    process.env.MODEL_PROVIDER = previous.provider; process.env.MODEL_NAME = previous.model; process.env.ANTHROPIC_API_KEY = previous.key;
  });
});

describe("DOCX tables have a real grid (release defect DEF-4)", () => {
  it("every table declares a fixed layout and grid columns wide enough to hold text, for proposal and report", async () => {
    for (const scenario of ["proposal", "report"] as const) {
      const result = await runWork(await inputFor(scenario), deps());
      if (result.outcome !== "ready") throw new Error(`${scenario} did not produce files`);
      const xml = Buffer.from(unzip(result.files.find((file) => file.format === "docx")!.bytes).get("word/document.xml")!).toString("utf8");
      const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
      expect(tables.length).toBeGreaterThan(0);
      for (const table of tables) {
        const grid = [...table.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
        expect(grid.length).toBeGreaterThan(0);
        expect(Math.min(...grid)).toBeGreaterThanOrEqual(500);
        expect(table).toMatch(/<w:tblLayout w:type="fixed"/);
        // Batch 7 oracle: the grid must fit the page's usable width (page width minus margins, read from
        // the document), not the 9000-twip constant of the interim renderer that used other margins.
        const page = Number(/<w:pgSz w:w="(\d+)"/.exec(xml)![1]);
        const margins = /<w:pgMar[^>]*w:right="(\d+)"[^>]*w:left="(\d+)"/.exec(xml) ?? /<w:pgMar[^>]*w:left="(\d+)"[^>]*w:right="(\d+)"/.exec(xml)!;
        expect(grid.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(page - Number(margins[1]) - Number(margins[2]));
      }
    }
  });
});

describe("a skipped message is not labelled as a proposal (DEF-6)", () => {
  it("titles the plan with the email subject and says nothing was prepared", async () => {
    const plans: Array<{ title: string; requestSummary: string; requestedOutputs: string[] }> = [];
    const input = await inputFor("no_action");
    const result = await runWork(input, { signal: new AbortController().signal, onProgress: async (p) => { if (p.plan) plans.push(p.plan); } });
    expect(result.outcome).toBe("skipped");
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      // Batch 7 oracle: the title is built from the subject (engine prefixes "No action: "), never a proposal title.
      expect(plan.title).toContain(input.email.subject.trim().replace(/\s+/g, " "));
      expect(plan.title).not.toMatch(/proposal/i);
      expect(plan.requestSummary).toMatch(/no files will be prepared/);
      expect(plan.requestedOutputs).toEqual([]);
    }
  });
});

describe("answers choosing a different schedule are not contradicted by fixed labels (DEF-3)", () => {
  it("a three-week scope and schedule never appears next to 'Four-week' headings or table cells", async () => {
    const answers = [
      { questionId: "client_identity", answer: "Northstar Co." },
      { questionId: "project_scope", answer: "Launch positioning and a three-week content plan" },
      { questionId: "authorized_fee", answer: "USD 4,500" },
      { questionId: "project_schedule", answer: "November 2-22, 2026 (three weeks)" },
    ];
    const resumed = await runWork(await inputFor("ambiguous", { revision: 2, answers }), deps());
    if (resumed.outcome !== "ready") throw new Error("expected ready");
    const products = JSON.stringify(resumed.products);
    expect(products).toContain("three-week");
    expect(products).not.toMatch(/four-week/i);
    const docx = Buffer.from(unzip(resumed.files.find((file) => file.format === "docx")!.bytes).get("word/document.xml")!).toString("utf8");
    expect(docx).not.toMatch(/four-week/i);
  });
});

describe("report narrative follows the computed data, not the canonical sample (DEF-2)", () => {
  async function reportWith(transform: (csv: string) => string) {
    const input = await inputFor("report");
    const csv = transform(new TextDecoder().decode(input.attachments[0]!.bytes));
    input.attachments[0] = { ...input.attachments[0]!, bytes: new TextEncoder().encode(csv) };
    const result = await runWork(input, deps());
    if (result.outcome !== "ready") throw new Error("expected ready");
    const docx = Buffer.from(unzip(result.files.find((file) => file.format === "docx")!.bytes).get("word/document.xml")!).toString("utf8");
    return { products: JSON.stringify(result.products), docx };
  }

  // Batch 7 oracle: assertions check the computed statements, not the interim fix's exact phrasing.
  it("canonical data states 25% growth and an unchanged $100 AOV", async () => {
    const { products, docx } = await reportWith((c) => c);
    expect(products).toContain("Revenue increased 25%");
    expect(products).toContain("average order value was $100 in both months");
    expect(products).toContain("Average order value: $100 in both months");
    expect(docx).toContain("+25%");
  });

  it("a changed February revenue changes the title, growth and AOV statements together", async () => {
    // Feb Website 10000 -> 11000: revenue 12000 -> 16000 (+33.3%), orders unchanged at 150, AOV $100 -> $106.67.
    const { products, docx } = await reportWith((c) => c.replace("2026-02,Website,10000,100", "2026-02,Website,11000,100"));
    expect(products).toContain("Revenue increased 33.3%");
    expect(products).not.toContain("Revenue increased 25%");
    expect(products).toContain("Average order value: $100 to $106.67");
    expect(products).not.toMatch(/average order value (was|remained) \$100 in both months/i);
    expect(docx).toContain("$106.67");
    expect(docx).not.toMatch(/\$100 in both months/);
  });

  it("a month with zero orders is not described as an increase or a constant AOV", async () => {
    const { products } = await reportWith((c) => c.replace("2026-02,Website,10000,100", "2026-02,Website,10000,0").replace("2026-02,Partnerships,5000,50", "2026-02,Partnerships,5000,0"));
    expect(products).not.toMatch(/orders increased/i);
    expect(products).not.toMatch(/average order value (was|remained) \$100 in both months/i);
    expect(products).toContain("Orders: 120 to 0 (orders decreased 100%)");
    expect(products).toContain("unknown (no orders)");
  });
});
