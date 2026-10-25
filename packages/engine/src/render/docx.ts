import { AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageBreak, PageNumber, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlignTable, WidthType, type TableVerticalAlign } from "docx";
import type { ContentBlock, OrganizationProfile, SourceDocument, WorkProduct } from "@afterhours/contracts";
import { usd } from "../calculations";
import type { Dashboard, Direction } from "../dashboard";
import { EngineError } from "../errors";
import { officeText, shorten } from "../text";

/** A4 with 0.75" margins: 11906 - 2 * 1080 twips of usable width. */
const MARGIN = 1080;
const CONTENT_WIDTH = 11906 - 2 * MARGIN;
const MUTED = "627D98";
const BODY_INK = "334E68";
const hex = (value: string) => value.replace(/^#/, "").toUpperCase();

interface RunOptions { bold?: boolean; italics?: boolean; size?: number; color?: string }
const run = (text: string, options: RunOptions = {}) => new TextRun({ text: officeText(text), ...options });

function para(text: string, options: RunOptions & { heading?: typeof HeadingLevel[keyof typeof HeadingLevel]; bullet?: boolean; keepNext?: boolean; after?: number } = {}): Paragraph {
  const { heading, bullet, keepNext, after, ...runOptions } = options;
  return new Paragraph({ heading, keepNext: keepNext ?? Boolean(heading), keepLines: Boolean(heading), bullet: bullet ? { level: 0 } : undefined, spacing: { after: after ?? 120, line: 276 }, children: [run(text, runOptions)] });
}

/** Column widths proportional to the longest cell text, with a floor so no column collapses. */
export function columnWidths(rows: string[][], total = CONTENT_WIDTH): number[] {
  const columns = Math.max(...rows.map((row) => row.length), 1);
  const weights = Array.from({ length: columns }, (_, index) => Math.min(60, Math.max(6, ...rows.map((row) => (row[index] ?? "").length))));
  const floor = Math.floor(total * Math.min(0.12, 1 / columns));
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((weight) => Math.max(floor, Math.round((weight / sum) * total)));
  const scale = total / raw.reduce((a, b) => a + b, 0);
  const widths = raw.map((value) => Math.floor(value * scale));
  widths[widths.length - 1]! += total - widths.reduce((a, b) => a + b, 0);
  return widths;
}

function grid(header: string[], body: string[][], primary: string): Table {
  const widths = columnWidths([header, ...body]);
  const border = { style: BorderStyle.SINGLE, size: 4, color: "BCCCDC" };
  const cell = (text: string, index: number, isHeader: boolean) => new TableCell({
    width: { size: widths[index]!, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 110, right: 110 },
    shading: isHeader ? { fill: "E6EEF5", color: "auto" } : undefined,
    borders: { top: border, bottom: border, left: border, right: border },
    children: [new Paragraph({ spacing: { after: 0, line: 260 }, children: [run(text, { bold: isHeader, color: isHeader ? primary : undefined, size: 20 })] })],
  });
  return new Table({
    layout: TableLayoutType.FIXED, columnWidths: widths, width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: header.map((text, index) => cell(text, index, true)) }),
      ...body.map((cells) => new TableRow({ cantSplit: true, children: cells.map((text, index) => cell(text, index, false)) })),
    ],
  });
}

function basisNote(block: ContentBlock, organization: OrganizationProfile, sourceTitles: Map<string, string>): string {
  const cited = [...new Set(block.evidence.map((item) => sourceTitles.get(item.sourceId)).filter(Boolean))].join("; ");
  if (block.basis === "recommendation") return `Recommendation from ${organization.name}; not stated in the sources.`;
  if (block.basis === "assumption") return "Assumptions and open items; confirm before any agreement.";
  if (block.basis === "calculated") return `Calculated in code from ${cited || "the supplied data"}.`;
  return `Source: ${cited || "supplied context"}.`;
}

function chartValue(value: number, unit: string | null): string {
  return unit === "USD" ? usd(Math.round(value * 100)) : `${value.toLocaleString("en-US")}${unit ? ` ${unit}` : ""}`;
}

function blockNodes(block: ContentBlock, organization: OrganizationProfile, sourceTitles: Map<string, string>): Array<Paragraph | Table> {
  const primary = hex(organization.brand.primaryColor);
  const nodes: Array<Paragraph | Table> = [];
  if (block.heading) nodes.push(para(block.heading, { heading: HeadingLevel.HEADING_1, color: primary, bold: true, size: 28, after: 60 }));
  nodes.push(para(basisNote(block, organization, sourceTitles), { italics: true, size: 18, color: MUTED, keepNext: true, after: 100 }));
  if (block.kind === "paragraph" && block.text) nodes.push(para(block.text));
  if (block.kind === "bullets") nodes.push(...block.items.map((item, index) => para(item, { bullet: true, keepNext: index < block.items.length - 1 && block.items.length <= 4, after: 80 })));
  if (block.kind === "table") nodes.push(grid(block.columns, block.rows, primary), para("", { after: 120 }));
  if (block.kind === "chart" && block.chart) {
    const chart = block.chart;
    nodes.push(grid(["Series", ...chart.labels], chart.series.map((series) => [series.name, ...series.values.map((value) => chartValue(value, chart.unit))]), primary));
    nodes.push(para("Chart data. The presentation contains the matching native, editable chart.", { italics: true, size: 18, color: MUTED }));
  }
  return nodes;
}

function sourceNotes(product: WorkProduct, sources: SourceDocument[]): Paragraph[] {
  const blocks = [...product.blocks, ...product.slides.flatMap((slide) => slide.blocks)];
  const cited = new Map<string, Set<string>>();
  for (const block of blocks) for (const evidence of block.evidence) {
    const notes = cited.get(evidence.sourceId) ?? new Set<string>();
    if (evidence.quote) notes.add(`“${shorten(evidence.quote, 220)}”`);
    if (evidence.locator) notes.add(evidence.locator);
    cited.set(evidence.sourceId, notes);
  }
  return sources.filter((source) => source.extractionStatus === "complete" && cited.has(source.id)).flatMap((source) => [
    para(`${source.title}${source.filename ? ` (${source.filename})` : ""} — ${source.kind.replace("_", " ")}`, { bullet: true, bold: true, after: 40 }),
    ...[...cited.get(source.id)!].slice(0, 6).map((note) => para(note, { italics: true, size: 18, color: MUTED, after: 40 })),
  ]);
}

const DARK = "3A3A3A";
const RULE = "C9D2DC";
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const arrow = (direction: Direction) => (direction === "up" ? "▲ " : direction === "down" ? "▼ " : "");
const trendColor = (direction: Direction) => (direction === "up" ? "129C86" : direction === "down" ? "D64545" : MUTED);
const BAR_UNITS = 32;

function plainTable(widths: number[], rows: TableRow[], borders: Record<string, unknown> = {}): Table {
  return new Table({ layout: TableLayoutType.FIXED, columnWidths: widths, width: { size: CONTENT_WIDTH, type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE, ...borders }, rows });
}
const cell = (width: number, children: Paragraph[], options: { fill?: string; borders?: Record<string, unknown>; align?: TableVerticalAlign } = {}) => new TableCell({
  width: { size: width, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, verticalAlign: options.align ?? VerticalAlignTable.CENTER,
  shading: options.fill ? { type: ShadingType.CLEAR, fill: options.fill, color: "auto" } : undefined, borders: { ...NO_BORDERS, ...(options.borders ?? {}) }, children,
});
const line = (runs: TextRun[], after = 0, alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]) => new Paragraph({ spacing: { after, line: 240 }, alignment, children: runs });

/** Template-style first page for sales reports: every value comes from the code-built dashboard. */
function dashboardPage(product: WorkProduct, dashboard: Dashboard, organization: OrganizationProfile): Array<Paragraph | Table> {
  const primary = hex(organization.brand.primaryColor);
  const rule = { style: BorderStyle.SINGLE, size: 8, color: RULE };
  const headerW = Math.round(CONTENT_WIDTH * 0.68);
  const header = plainTable([headerW, CONTENT_WIDTH - headerW], [new TableRow({ children: [
    cell(headerW, [line([run("Report Time Frame  |  ", { bold: true, size: 19, color: "FFFFFF" }), run(`${dashboard.timeFrame} `, { bold: true, size: 19, color: "FFFFFF" }), run(`(Comparing to ${dashboard.comparison})`, { italics: true, size: 19, color: "D9D9D9" })])], { fill: DARK }),
    cell(CONTENT_WIDTH - headerW, [line([run("●  ", { size: 26, color: DARK }), run(organization.name.toUpperCase(), { bold: true, size: 20, color: DARK })], 0, AlignmentType.RIGHT)]),
  ] })]);
  const tileW = Math.floor(CONTENT_WIDTH / dashboard.kpis.length);
  const kpis = plainTable(dashboard.kpis.map(() => tileW), [new TableRow({ children: dashboard.kpis.map((kpi) => cell(tileW, [
    line([run(kpi.label, { size: 17, color: MUTED })], 40),
    line([run(kpi.value, { bold: true, size: 36, color: DARK })], 20),
    line([run(`${arrow(kpi.direction)}${kpi.change}`, { bold: true, size: 18, color: trendColor(kpi.direction) })]),
  ], { borders: { top: rule, bottom: rule }, align: VerticalAlignTable.TOP })) })]);
  const shareW = [Math.round(CONTENT_WIDTH * 0.46), Math.round(CONTENT_WIDTH * 0.27)];
  shareW.push(CONTENT_WIDTH - shareW[0]! - shareW[1]!);
  const shares = plainTable(shareW, [
    new TableRow({ children: [cell(shareW[0]!, [line([run("Channel", { size: 16, color: MUTED })])]), cell(shareW[1]!, [line([run(`Share of revenue, ${dashboard.months[1]}`, { size: 16, color: MUTED })], 0, AlignmentType.RIGHT)]), cell(shareW[2]!, [line([run(`Change vs ${dashboard.months[0]}`, { size: 16, color: MUTED })], 0, AlignmentType.RIGHT)])] }),
    ...dashboard.channels.map((channel) => new TableRow({ cantSplit: true, children: [
      cell(shareW[0]!, [line([run("●  ", { color: channel.color, size: 22 }), run(channel.name, { bold: true, size: 22, color: channel.color })])], { borders: { bottom: rule } }),
      cell(shareW[1]!, [line([run(channel.shareText, { size: 32, color: channel.color })], 0, AlignmentType.RIGHT)], { borders: { bottom: rule } }),
      cell(shareW[2]!, [line([run(`${arrow(channel.direction)}${channel.growthText}`, { bold: true, size: 18, color: trendColor(channel.direction) })], 0, AlignmentType.RIGHT)], { borders: { bottom: rule } }),
    ] })),
  ]);
  const max = Math.max(...dashboard.channels.flatMap((channel) => channel.revenue), 0);
  const barW = [Math.round(CONTENT_WIDTH * 0.26), Math.round(CONTENT_WIDTH * 0.56)];
  barW.push(CONTENT_WIDTH - barW[0]! - barW[1]!);
  const bars = plainTable(barW, dashboard.channels.flatMap((channel) => channel.revenue.map((value, month) => new TableRow({ cantSplit: true, children: [
    cell(barW[0]!, [line([run(month === 0 ? channel.name : "", { bold: true, size: 18, color: channel.color }), run(`  ${dashboard.months[month]}`, { size: 16, color: MUTED })])]),
    cell(barW[1]!, [line([run("█".repeat(max > 0 ? Math.max(value > 0 ? 1 : 0, Math.round((value / max) * BAR_UNITS)) : 0), { size: 16, color: month === 0 ? "BCCCDC" : channel.color })])]),
    cell(barW[2]!, [line([run(usd(Math.round(value * 100)), { size: 18, color: DARK })], 0, AlignmentType.RIGHT)]),
  ] }))));
  return [
    header,
    new Paragraph({ spacing: { before: 240, after: 60 }, children: [run(product.title, { bold: true, size: 40, color: primary })] }),
    ...(product.subtitle ? [new Paragraph({ spacing: { after: 60 }, children: [run(product.subtitle, { italics: true, size: 22, color: MUTED })] })] : []),
    new Paragraph({ spacing: { after: 200 }, children: [run(`Prepared by ${organization.name} for internal review. Not sent to or accepted by any client.`, { size: 18, color: MUTED })] }),
    kpis,
    new Paragraph({ spacing: { before: 280, after: 120 }, keepNext: true, children: [run(dashboard.question, { bold: true, size: 26, color: DARK })] }),
    para("Revenue share per channel", { size: 20, color: BODY_INK, keepNext: true, after: 60 }),
    shares,
    para(`Revenue per channel, ${dashboard.months[0]} (grey) and ${dashboard.months[1]} (color)`, { size: 20, color: BODY_INK, keepNext: true, after: 60 }),
    bars,
    para(dashboard.note, { italics: true, size: 16, color: MUTED, after: 0 }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

export async function renderDocx(product: WorkProduct, sources: SourceDocument[], organization: OrganizationProfile, dashboard: Dashboard | null = null): Promise<Uint8Array> {
  try {
    const font = organization.brand.fontFamily;
    const primary = hex(organization.brand.primaryColor);
    const sourceTitles = new Map(sources.map((source) => [source.id, source.filename ?? source.title]));
    const opening: Array<Paragraph | Table> = dashboard && product.kind === "report" ? dashboardPage(product, dashboard, organization) : [
      new Paragraph({ spacing: { before: 600, after: 160 }, children: [run(product.title, { bold: true, size: 44, color: primary })] }),
      ...(product.subtitle ? [new Paragraph({ spacing: { after: 120 }, children: [run(product.subtitle, { italics: true, size: 26, color: MUTED })] })] : []),
      new Paragraph({ spacing: { after: 480 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: hex(organization.brand.accentColor), space: 8 } }, children: [run(`Prepared by ${organization.name} for internal review. Not sent to or accepted by any client.`, { size: 20, color: MUTED })] }),
    ];
    const content: Array<Paragraph | Table> = [
      ...opening,
      ...product.blocks.flatMap((block) => blockNodes(block, organization, sourceTitles)),
      para("Working assumptions", { heading: HeadingLevel.HEADING_1, color: primary, bold: true, size: 28 }),
      ...product.assumptions.map((item) => para(item, { bullet: true, after: 80 })),
      ...(product.warnings.length ? [para("Warnings", { heading: HeadingLevel.HEADING_1, color: primary, bold: true, size: 28 }), ...product.warnings.map((item) => para(item, { bullet: true, after: 80 }))] : []),
      para("Source notes", { heading: HeadingLevel.HEADING_1, color: primary, bold: true, size: 28 }),
      ...sourceNotes(product, sources),
    ];
    const doc = new Document({
      creator: organization.name, title: officeText(product.title), description: "AfterHours review draft",
      styles: { default: { document: { run: { font, size: 22, color: "243B53" }, paragraph: { spacing: { after: 120 } } } } },
      sections: [{
        properties: { page: { margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN, header: 500, footer: 500 } } },
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(`${organization.name}  |  ${shorten(product.title, 70)}`, { size: 16, color: MUTED })] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Review draft  |  Page ", size: 16, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED }), new TextRun({ text: " of ", size: 16, color: MUTED }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: MUTED })] })] }) },
        children: content,
      }],
    });
    return new Uint8Array(await Packer.toBuffer(doc));
  } catch (error) {
    throw new EngineError("EXPORT_FAILED", `DOCX export failed: ${error instanceof Error ? error.name : "unknown error"}`, false);
  }
}
