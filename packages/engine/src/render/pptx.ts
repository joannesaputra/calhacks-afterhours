import PptxGenJS from "pptxgenjs";
import type { ContentBlock, OrganizationProfile, SlideContent, WorkProduct } from "@afterhours/contracts";
import type { Dashboard, Direction } from "../dashboard";
import { EngineError } from "../errors";
import { blockBoxes, blockParagraphs, bodyBox, bodySteps, COVER_TITLE, fitFont, headingH, labelH, MIN_BODY_PT, needsBasisLabel, SLIDE, TITLE_STEPS, type BlockBox } from "../layout";
import { officeText } from "../text";
import { columnWidths } from "./docx";

const BODY = "334E68";
const MUTED = "627D98";
const hex = (value: string) => value.replace(/^#/, "").toUpperCase();
const PARA_SPACE = 8;

function basisLine(slide: SlideContent): string {
  const labels = new Set<string>();
  for (const block of slide.blocks) {
    if (block.basis === "calculated") labels.add("Calculated in code from the supplied data");
    else if (block.basis === "source") labels.add("From the supplied sources");
    else if (block.basis === "recommendation") labels.add("Recommendation, not a source fact");
    else labels.add("Assumption to confirm");
  }
  return [...labels].join("  ·  ");
}

/** Channel series keep their dashboard color across the deck; other charts use the brand colors. */
function seriesColors(names: string[], organization: OrganizationProfile, dashboard: Dashboard | null): string[] {
  const brand = [hex(organization.brand.accentColor), hex(organization.brand.primaryColor), "829AB1"];
  if (names.length === 1) return [brand[0]!];
  const byName = new Map(dashboard?.channels.map((channel) => [channel.name.toLowerCase(), channel.color]) ?? []);
  return names.every((name) => byName.has(name.toLowerCase())) ? names.map((name) => byName.get(name.toLowerCase())!) : brand;
}

function addBlock(pptx: PptxGenJS, slide: PptxGenJS.Slide, content: SlideContent, block: ContentBlock, box: BlockBox, organization: OrganizationProfile, dashboard: Dashboard | null): void {
  const primary = hex(organization.brand.primaryColor);
  const font = organization.brand.fontFamily;
  const labelled = needsBasisLabel(block);
  if (block.heading) {
    const size = fitFont([block.heading], box.w, headingH + 0.1, [19, 17, 16], 0) ?? 16;
    slide.addText(officeText(block.heading), { x: box.x, y: box.y, w: box.w, h: headingH, fontFace: font, fontSize: size, bold: true, color: primary, margin: 0, valign: "top" });
  }
  if (labelled) slide.addText(block.basis === "recommendation" ? "RECOMMENDATION" : "ASSUMPTION", { x: box.x, y: box.y + (block.heading ? headingH : 0), w: box.w, h: labelH - 0.05, fontFace: font, fontSize: 11, bold: true, color: hex(organization.brand.accentColor), margin: 0, charSpacing: 1 });
  const body = bodyBox(block, box, labelled);
  if (block.kind === "chart" && block.chart) {
    const chart = block.chart;
    const money = chart.unit === "USD";
    const cents = chart.series.some((series) => series.values.some((value) => !Number.isInteger(value)));
    const format = `${money ? "$" : ""}#,##0${cents ? ".00" : ""}`;
    slide.addChart(pptx.ChartType.bar, chart.series.map((series) => ({ name: officeText(series.name), labels: chart.labels.map(officeText), values: series.values })), {
      x: body.x, y: body.y, w: body.w, h: body.h, barDir: "col", showTitle: false,
      showLegend: chart.series.length > 1, legendPos: "b", legendFontSize: 12,
      showValue: true, dataLabelFontSize: 14, dataLabelColor: BODY, dataLabelFormatCode: format,
      catAxisLabelFontSize: 14, catAxisLabelColor: BODY, valAxisLabelFontSize: 12, valAxisLabelColor: MUTED, valAxisLabelFormatCode: money ? "$#,##0" : "#,##0", valAxisMinVal: 0,
      showValAxisTitle: Boolean(chart.unit), valAxisTitle: chart.unit ?? undefined, valAxisTitleFontSize: 12, valAxisTitleColor: MUTED,
      valGridLine: { color: "D9E2EC", size: 0.5 }, chartColors: seriesColors(chart.series.map((series) => series.name), organization, dashboard),
    });
    return;
  }
  if (block.kind === "table") {
    const widths = columnWidths([block.columns, ...block.rows], 1000).map((value) => (value / 1000) * body.w);
    const rowH = Math.min(0.6, (body.h - 0.1) / (block.rows.length + 1));
    slide.addTable([
      block.columns.map((text) => ({ text: officeText(text), options: { bold: true, color: primary, fill: { color: "E6EEF5" } } })),
      ...block.rows.map((row) => row.map((text) => ({ text: officeText(text) }))),
    ], { x: body.x, y: body.y, w: body.w, colW: widths, rowH, fontFace: font, fontSize: MIN_BODY_PT + 2, color: BODY, border: { type: "solid", pt: 0.75, color: "BCCCDC" }, margin: 0.06, valign: "middle", autoPage: false });
    return;
  }
  const paragraphs = blockParagraphs(block);
  const size = fitFont(paragraphs, body.w, body.h, bodySteps(content.layout), PARA_SPACE) ?? MIN_BODY_PT;
  const runs = paragraphs.map((text) => ({ text: officeText(text), options: { bullet: block.kind === "bullets" ? { indent: 18 } : false, breakLine: true } }));
  slide.addText(runs, { x: body.x, y: body.y, w: body.w, h: body.h, fontFace: font, fontSize: size, color: BODY, margin: 0.08, valign: content.layout === "title" ? "middle" : "top", paraSpaceAfter: PARA_SPACE });
}

const DARK = "3A3A3A";
const RULE = "C9D2DC";
const arrow = (direction: Direction) => (direction === "up" ? "▲ " : direction === "down" ? "▼ " : "");
const trendColor = (direction: Direction) => (direction === "up" ? "129C86" : direction === "down" ? "D64545" : MUTED);

/** Template-style dashboard cover for sales decks: header bar, KPI tiles, trend line, share donut and channel list. */
function addDashboard(pptx: PptxGenJS, slide: PptxGenJS.Slide, content: SlideContent, dashboard: Dashboard, organization: OrganizationProfile): void {
  const font = organization.brand.fontFamily;
  const primary = hex(organization.brand.primaryColor);
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 0.35, w: 7.6, h: 0.55, rectRadius: 0.27, fill: { color: DARK }, line: { color: DARK } });
  slide.addText([
    { text: "Report Time Frame  |  ", options: { bold: true } },
    { text: `${officeText(dashboard.timeFrame)} `, options: { bold: true } },
    { text: `(Comparing to ${officeText(dashboard.comparison)})`, options: { italic: true, color: "D9D9D9" } },
  ], { x: 0.75, y: 0.35, w: 7.2, h: 0.55, fontFace: font, fontSize: 14, color: "FFFFFF", margin: 0, valign: "middle" });
  slide.addShape(pptx.ShapeType.ellipse, { x: 10.3, y: 0.4, w: 0.45, h: 0.45, fill: { color: DARK }, line: { color: DARK } });
  const orgSize = fitFont([organization.name.toUpperCase()], 2.2, 0.6, [14, 12, 11, 10], 0) ?? 10;
  slide.addText(officeText(organization.name).toUpperCase(), { x: 10.85, y: 0.32, w: 2.2, h: 0.6, fontFace: font, fontSize: orgSize, bold: true, color: DARK, margin: 0, valign: "middle" });

  const titleSize = fitFont([content.title], SLIDE.w, 0.6, [30, 28, 26, 24], 0) ?? 24;
  slide.addText(officeText(content.title), { x: SLIDE.x, y: 1.05, w: SLIDE.w, h: 0.6, fontFace: font, fontSize: titleSize, bold: true, color: primary, margin: 0, valign: "middle" });
  const caption = content.blocks[0] ? blockParagraphs(content.blocks[0]).join("  ·  ") : "";
  if (caption) slide.addText(officeText(caption.length > 140 ? `${caption.slice(0, 137)}...` : caption), { x: SLIDE.x, y: 1.65, w: SLIDE.w, h: 0.3, fontFace: font, fontSize: 12, color: MUTED, margin: 0 });

  const tileW = 2.825;
  dashboard.kpis.forEach((kpi, index) => {
    const x = SLIDE.x + index * (tileW + 0.2);
    slide.addShape(pptx.ShapeType.line, { x, y: 2.05, w: tileW, h: 0, line: { color: RULE, width: 1 } });
    slide.addText(officeText(kpi.label), { x, y: 2.12, w: tileW, h: 0.32, fontFace: font, fontSize: fitFont([kpi.label], tileW, 0.32, [13, 12, 11], 0) ?? 11, color: MUTED, margin: 0 });
    slide.addText(officeText(kpi.value), { x, y: 2.44, w: tileW, h: 0.56, fontFace: font, fontSize: 26, bold: true, color: DARK, margin: 0, valign: "middle" });
    slide.addText(`${arrow(kpi.direction)}${officeText(kpi.change)}`, { x, y: 3.0, w: tileW, h: 0.3, fontFace: font, fontSize: 13, bold: true, color: trendColor(kpi.direction), margin: 0 });
    slide.addShape(pptx.ShapeType.line, { x, y: 3.38, w: tileW, h: 0, line: { color: RULE, width: 1 } });
  });
  slide.addText(officeText(dashboard.question), { x: SLIDE.x, y: 3.5, w: SLIDE.w, h: 0.42, fontFace: font, fontSize: 17, bold: true, color: DARK, margin: 0, valign: "middle" });

  const panelTitle = (text: string, x: number, w: number) => slide.addText(officeText(text), { x, y: 4.0, w, h: 0.3, fontFace: font, fontSize: 12, color: BODY, margin: 0 });
  const colors = dashboard.channels.map((channel) => channel.color);
  panelTitle("Revenue per channel by month", SLIDE.x, 4.6);
  slide.addChart(pptx.ChartType.line, dashboard.channels.map((channel) => ({ name: officeText(channel.name), labels: dashboard.months.map(officeText), values: channel.revenue })), {
    x: SLIDE.x, y: 4.3, w: 4.6, h: 2.4, showTitle: false, chartColors: colors, lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 7,
    showLegend: true, legendPos: "b", legendFontSize: 10, catAxisLabelFontSize: 11, catAxisLabelColor: BODY,
    valAxisLabelFontSize: 10, valAxisLabelColor: MUTED, valAxisLabelFormatCode: "$#,##0", valAxisMinVal: 0, valGridLine: { color: "E4E9EF", size: 0.5 },
  });
  const second = dashboard.channels.map((channel) => channel.revenue[1]);
  panelTitle(`Revenue share, ${dashboard.months[1]}`, 5.55, 3.2);
  if (second.some((value) => value > 0)) {
    slide.addChart(pptx.ChartType.doughnut, [{ name: "Revenue share", labels: dashboard.channels.map((channel) => officeText(channel.name)), values: second }], {
      x: 5.55, y: 4.3, w: 3.2, h: 2.4, holeSize: 55, chartColors: colors, showLegend: false, showTitle: false,
      showPercent: true, showValue: false, showLabel: false, dataLabelColor: "FFFFFF", dataLabelFontSize: 10,
    });
  } else {
    slide.addText("No revenue recorded this month.", { x: 5.55, y: 4.4, w: 3.2, h: 0.4, fontFace: font, fontSize: 12, color: MUTED, margin: 0 });
  }
  const listX = 9.0;
  panelTitle(`Revenue share per channel (${dashboard.months[1]})`, listX, 3.6);
  const rowH = Math.min(0.44, 2.3 / Math.max(dashboard.channels.length, 1));
  dashboard.channels.forEach((channel, index) => {
    const y = 4.38 + index * rowH;
    slide.addText(officeText(channel.name), { x: listX, y, w: 1.65, h: rowH, fontFace: font, fontSize: fitFont([channel.name], 1.65, rowH, [14, 12, 11, 10], 0) ?? 10, bold: true, color: channel.color, margin: 0, valign: "middle" });
    slide.addText(officeText(channel.shareText), { x: listX + 1.65, y, w: 1.15, h: rowH, fontFace: font, fontSize: rowH >= 0.4 ? 20 : 16, color: channel.color, margin: 0, align: "right", valign: "middle" });
    slide.addText(`${arrow(channel.direction)}${officeText(channel.growthText)}`, { x: listX + 2.85, y, w: 0.85, h: rowH, fontFace: font, fontSize: 10, bold: true, color: trendColor(channel.direction), margin: 0, align: "right", valign: "middle" });
    slide.addShape(pptx.ShapeType.line, { x: listX, y: y + rowH, w: 3.7, h: 0, line: { color: RULE, width: 0.75 } });
  });
}

export async function renderPptx(product: WorkProduct, organization: OrganizationProfile, dashboard: Dashboard | null = null): Promise<Uint8Array> {
  try {
    const pptx = new PptxGenJS();
    const font = organization.brand.fontFamily;
    const primary = hex(organization.brand.primaryColor);
    const accent = hex(organization.brand.accentColor);
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = officeText(organization.name);
    pptx.subject = "AfterHours review draft";
    pptx.title = officeText(product.title);
    pptx.company = officeText(organization.name);
    pptx.theme = { headFontFace: font, bodyFontFace: font };
    pptx.defineSlideMaster({ title: "AFTERHOURS", background: { color: "F7FAFC" }, objects: [
      { rect: { x: 0, y: 0, w: SLIDE.width, h: 0.13, fill: { color: accent }, line: { color: accent } } },
      { text: { text: officeText(organization.name), options: { x: 0.7, y: 7.1, w: 5, h: 0.25, fontFace: font, fontSize: 10, color: MUTED, margin: 0 } } },
      { text: { text: "REVIEW DRAFT", options: { x: 9.6, y: 7.1, w: 2.6, h: 0.25, fontFace: font, fontSize: 10, color: MUTED, align: "right", margin: 0 } } },
    ], slideNumber: { x: 12.4, y: 7.08, w: 0.5, h: 0.28, color: MUTED, fontSize: 10, fontFace: font } });
    product.slides.forEach((content, index) => {
      const slide = pptx.addSlide({ masterName: "AFTERHOURS" });
      // The cover of a sales deck becomes the dashboard, so the requested slide count is unchanged.
      if (dashboard && index === 0 && content.layout === "title") {
        addDashboard(pptx, slide, content, dashboard, organization);
        slide.addText(officeText(dashboard.note), { x: SLIDE.x, y: 6.78, w: SLIDE.w, h: 0.24, fontFace: font, fontSize: 10, italic: true, color: MUTED, margin: 0 });
        if (content.speakerNotes.trim()) slide.addNotes(officeText(content.speakerNotes));
        return;
      }
      if (content.layout === "title") {
        const block = content.blocks[0];
        if (block?.heading) slide.addText(officeText(block.heading).toUpperCase(), { x: SLIDE.x, y: 1.9, w: SLIDE.w, h: 0.4, fontFace: font, fontSize: 14, bold: true, color: accent, margin: 0, charSpacing: 2 });
        const titleSize = fitFont([content.title], SLIDE.w, COVER_TITLE.h, COVER_TITLE.steps, 0) ?? COVER_TITLE.steps.at(-1)!;
        slide.addText(officeText(content.title), { x: SLIDE.x, y: COVER_TITLE.y, w: SLIDE.w, h: COVER_TITLE.h, fontFace: font, fontSize: titleSize, bold: true, color: primary, margin: 0, valign: "top" });
        slide.addShape(pptx.ShapeType.rect, { x: SLIDE.x, y: 4.2, w: 1.4, h: 0.06, fill: { color: accent }, line: { color: accent } });
        if (block) {
          const paragraphs = blockParagraphs(block);
          const size = fitFont(paragraphs, SLIDE.w, 1.6, [24, 22, 20, 18, 16], PARA_SPACE) ?? 16;
          slide.addText(paragraphs.map((text) => ({ text: officeText(text), options: { breakLine: true } })), { x: SLIDE.x, y: 4.45, w: SLIDE.w, h: 1.6, fontFace: font, fontSize: size, color: BODY, margin: 0, valign: "top", paraSpaceAfter: PARA_SPACE });
        }
      } else {
        const titleSize = fitFont([content.title], SLIDE.w, SLIDE.titleH, TITLE_STEPS, 0) ?? TITLE_STEPS.at(-1)!;
        slide.addText(officeText(content.title), { x: SLIDE.x, y: SLIDE.titleY, w: SLIDE.w, h: SLIDE.titleH, fontFace: font, fontSize: titleSize, bold: true, color: primary, margin: 0, valign: "middle" });
        const boxes = blockBoxes(content);
        content.blocks.forEach((block, index) => addBlock(pptx, slide, content, block, boxes[index]!, organization, dashboard));
      }
      slide.addText(officeText(basisLine(content)), { x: SLIDE.x, y: 6.78, w: SLIDE.w, h: 0.24, fontFace: font, fontSize: 10, italic: true, color: MUTED, margin: 0 });
      if (content.speakerNotes.trim()) slide.addNotes(officeText(content.speakerNotes));
    });
    const output = await pptx.write({ outputType: "arraybuffer" });
    return new Uint8Array(output as ArrayBuffer);
  } catch (error) {
    throw new EngineError("EXPORT_FAILED", `PPTX export failed: ${error instanceof Error ? error.name : "unknown error"}`, false);
  }
}
