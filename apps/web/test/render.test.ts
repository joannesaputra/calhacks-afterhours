// Rendering checks for the structured previews. Server-side render only: no browser, no network, no backend.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ContentBlock, SourceDocument } from "@afterhours/contracts";
import { ChartView } from "../components/preview/chart";
import { BlockView } from "../components/preview/blocks";
import { PreviewContext } from "../components/preview/context";
import { SourceDialog, quoteMatches } from "../components/preview/source-dialog";
import { safeReturnTo } from "../lib/api";
import { formatBytes, formatElapsed, isValidTimeZone, normalizeWs } from "../lib/format";
import { describeNotification, isConfigError, sortForQueue } from "../lib/labels";

const render = (block: ContentBlock, sources: SourceDocument[] = []) =>
  renderToStaticMarkup(createElement(PreviewContext.Provider, { value: { sources, openSource: () => undefined } }, createElement(BlockView, { block })));

describe("ChartView renders exactly the returned data", () => {
  it("shows labels, values, unit, legend and a data table for arbitrary input", () => {
    const html = renderToStaticMarkup(createElement(ChartView, {
      title: "Orders",
      chart: { type: "bar", labels: ["Q1", "Q2", "Q3"], unit: "EUR", series: [{ name: "North", values: [7, 9, 21] }, { name: "South", values: [3, 4, 5] }] },
    }));
    for (const text of ["Q1", "Q2", "Q3", ">21<", ">7<", "EUR", "North", "South"]) expect(html).toContain(text);
    expect(html).toMatch(/aria-label="Bar chart titled Orders, values in EUR\. North: Q1 7; Q2 9; Q3 21\. South: Q1 3; Q2 4; Q3 5\.\s*"/);
    expect(html).toContain("<table>");
  });

  it("changed input changes the output and never leaks other numbers", () => {
    const render1 = renderToStaticMarkup(createElement(ChartView, { title: null, chart: { type: "bar", labels: ["Jan", "Feb"], unit: "USD", series: [{ name: "Revenue", values: [12000, 15000] }] } }));
    const render2 = renderToStaticMarkup(createElement(ChartView, { title: null, chart: { type: "bar", labels: ["Jan", "Feb"], unit: "USD", series: [{ name: "Revenue", values: [8000, 9500] }] } }));
    expect(render1).toContain("12,000");
    expect(render1).toContain("15,000");
    expect(render2).toContain("8,000");
    expect(render2).toContain("9,500");
    expect(render2).not.toContain("12,000");
    expect(render2).not.toContain("15,000");
    expect(render2).not.toContain("25%");
    expect(render2).not.toContain("3,000");
  });

  it("draws line charts and handles an empty dataset without inventing values", () => {
    const line = renderToStaticMarkup(createElement(ChartView, { title: null, chart: { type: "line", labels: ["x", "y"], unit: null, series: [{ name: "S", values: [2, 4] }] } }));
    expect(line).toContain("<polyline");
    const empty = renderToStaticMarkup(createElement(ChartView, { title: null, chart: { type: "bar", labels: [], unit: null, series: [] } }));
    expect(empty).toContain("no data");
    expect(empty).not.toContain("<svg");
  });
});

describe("BlockView", () => {
  it("escapes email-like text and never emits raw HTML", () => {
    const html = render({
      id: "p", kind: "paragraph", heading: "<b>head</b>", text: "<img src=x onerror=alert(1)> & more", items: [], columns: [], rows: [], chart: null,
      evidence: [], basis: "recommendation",
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>head");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; more");
    expect(html).toContain("Recommendation");
  });

  it("renders tables with headers and flags a sourced block that has no reference", () => {
    const html = render({
      id: "t", kind: "table", heading: "Fees", text: null, items: [], columns: ["Item", "USD"], rows: [["Design", "4,500"], ["Total", "6,000"]], chart: null,
      evidence: [], basis: "source",
    });
    expect(html).toContain('<th scope="col">Item</th>');
    expect(html).toContain("<td>6,000</td>");
    expect(html).toContain("No source reference");
  });

  it("marks evidence from an unreadable source as not read and unknown sources as unknown", () => {
    const sources: SourceDocument[] = [{ id: "s1", kind: "attachment", title: "brief.pdf", filename: "brief.pdf", mimeType: "application/pdf", text: "", extractionStatus: "unsupported", warnings: ["PDF text extraction is not available."] }];
    const block: ContentBlock = {
      id: "b", kind: "paragraph", heading: null, text: "Claim", items: [], columns: [], rows: [], chart: null, basis: "source",
      evidence: [{ sourceId: "s1", locator: null, quote: "q" }, { sourceId: "missing", locator: null, quote: null }],
    };
    const html = render(block, sources);
    expect(html).toContain("(not read)");
    expect(html).toContain("Unknown source");
    expect(html).toContain("chip-warn");
  });
});

describe("quote matching", () => {
  const source: SourceDocument = { id: "s", kind: "email", title: "t", filename: null, mimeType: "text/plain", text: "Budget is\n  USD 6,000   fixed.", extractionStatus: "complete", warnings: [] };
  it("normalizes whitespace and case, and reports a miss honestly", () => {
    expect(quoteMatches({ sourceId: "s", locator: null, quote: "budget is usd 6,000 fixed." }, source)).toBe(true);
    expect(quoteMatches({ sourceId: "s", locator: null, quote: "USD 9,999" }, source)).toBe(false);
    expect(quoteMatches({ sourceId: "s", locator: null, quote: null }, source)).toBeNull();
    expect(quoteMatches({ sourceId: "nope", locator: null, quote: "x" }, undefined)).toBeNull();
  });
});

describe("SourceDialog", () => {
  const source: SourceDocument = {
    id: "s", kind: "attachment", title: "Brief", filename: "maple-brief.md", mimeType: "text/markdown",
    text: "The client budget is USD 6,000 for a four-week engagement.", extractionStatus: "complete", warnings: ["Truncated at 60,000 characters."],
  };
  const dialog = (reference: { sourceId: string; locator: string | null; quote: string | null }, src: SourceDocument | undefined) =>
    renderToStaticMarkup(createElement(SourceDialog, { reference, source: src, opener: null, onClose: () => undefined }));

  it("shows the real quote, source type, filename, locator, and whether the quote is in the text", () => {
    const html = dialog({ sourceId: "s", locator: "lines 3-4", quote: "budget is USD 6,000" }, source);
    expect(html).toContain("budget is USD 6,000");
    expect(html).toContain("Attachment");
    expect(html).toContain("maple-brief.md");
    expect(html).toContain("lines 3-4");
    expect(html).toContain("appears in the extracted source text");
    expect(html).toContain("Truncated at 60,000 characters.");
  });

  it("is honest when the quote is missing, wrong, or the source was not read", () => {
    expect(dialog({ sourceId: "s", locator: null, quote: null }, source)).toContain("No excerpt was recorded");
    expect(dialog({ sourceId: "s", locator: null, quote: "USD 9,999" }, source)).toContain("not found word-for-word");
    const unread = { ...source, extractionStatus: "unsupported" as const, text: "" };
    expect(dialog({ sourceId: "s", locator: null, quote: "x" }, unread)).toContain("cannot support the statement");
    expect(dialog({ sourceId: "gone", locator: null, quote: null }, undefined)).toContain("Unknown source");
  });

  it("escapes markup inside a quote and never renders it as HTML", () => {
    const html = dialog({ sourceId: "s", locator: null, quote: "<script>alert(1)</script>" }, source);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("helpers", () => {
  it("accepts only same-origin relative return paths", () => {
    expect(safeReturnTo("/tasks/abc?x=1")).toBe("/tasks/abc?x=1");
    // Encoded slashes stay inside the path: the browser does not decode them into a protocol-relative URL.
    expect(new URL(safeReturnTo("/%2F%2Fevil.example"), "http://localhost:3000").origin).toBe("http://localhost:3000");
    expect(new URL(safeReturnTo("/%5C%5Cevil.example"), "http://localhost:3000").origin).toBe("http://localhost:3000");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)", "/login", "", null, undefined, "/a\nb",
      "data:text/html,x", "%2F%2Fevil.example", "\\\\evil.example", "/\t/evil.example", "/login?returnTo=%2Ftasks", 42, {}]) {
      expect(safeReturnTo(bad as string | null | undefined)).toBe("/");
    }
  });
  it("formats sizes, durations and time zones", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatElapsed("2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:01:12Z"))).toBe("1m 12s");
    expect(isValidTimeZone("America/Los_Angeles")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(normalizeWs("  A \n b ")).toBe("a b");
  });
  it("orders the queue: ready, active, needs input, failed, then closed", () => {
    const t = (id: string, status: string, createdAt: string) => ({ id, status, createdAt }) as never;
    const out = sortForQueue([t("1", "approved", "2026-01-01"), t("2", "failed", "2026-01-02"), t("3", "ready", "2026-01-03"), t("4", "queued", "2026-01-04"), t("5", "needs_input", "2026-01-05")]);
    expect(out.map((x) => x.id)).toEqual(["3", "4", "5", "2", "1"]);
    expect(isConfigError("MODEL_NOT_CONFIGURED")).toBe(true);
    expect(isConfigError("ENGINE_UNEXPECTED_ERROR")).toBe(false);
  });
});

describe("describeNotification (honest delivery wording)", () => {
  const n = (state: "queued" | "simulated" | "accepted" | "delivered" | "blocked" | "failed", lastError: string | null = null) => describeNotification({ state, lastError, channel: "whatsapp" });
  it("calls an uncertain failure uncertain, not a rejection, and never offers a resend", () => {
    const d = n("failed", "DELIVERY_UNCERTAIN: The provider did not answer in time. It may or may not have been accepted.");
    expect(d.label).toBe("Failed (uncertain)");
    expect(d.detail).toContain("may have accepted");
    expect(d.detail).toContain("not resent automatically");
    expect(d.detail.toLowerCase()).not.toContain("rejected");
    expect(d.reason).not.toMatch(/^DELIVERY_UNCERTAIN/);
  });
  it("explains a policy-changed block as not sent, with the files unaffected", () => {
    const d = n("blocked", "POLICY_CHANGED: The recipient was edited after this message was queued.");
    expect(d.label).toBe("Not sent (settings changed)");
    expect(d.detail).toContain("files are unaffected");
  });
  it("keeps simulated, accepted and delivered distinct, and queued is a plan", () => {
    expect(n("simulated").detail).toContain("not sent to any phone");
    expect(n("accepted").detail).toContain("not confirmed");
    expect(n("accepted").label).not.toBe(n("delivered").label);
    expect(n("queued").detail).toContain("plan, not a promise");
  });
});
