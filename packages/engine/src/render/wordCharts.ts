import PptxGenJS from "pptxgenjs";
import { readZip, writeZip } from "../zip";

/**
 * Native, editable Word charts. Word and PowerPoint share the DrawingML chart format, so each chart is built with
 * the same pptxgenjs chart code as the deck, then its chart part and embedded workbook are moved into the DOCX and
 * placed where the renderer left a placeholder paragraph.
 */
export interface WordChart {
  type: "column" | "barH" | "line" | "area" | "doughnut";
  title: string | null;
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
  colors: string[];
  money: boolean;
  widthIn: number;
  heightIn: number;
  legend: boolean;
}

const TOKEN = (index: number) => `[[AFTERHOURS-CHART-${index}]]`;
const EMU = 914_400;
const BODY = "334E68";
const MUTED = "627D98";

/** Collects charts while the document is built and hands out the placeholder text for each one. */
export class WordChartSlots {
  readonly charts: WordChart[] = [];
  add(chart: WordChart): string {
    this.charts.push(chart);
    return TOKEN(this.charts.length);
  }
}

function addChart(pptx: PptxGenJS, chart: WordChart, font: string): void {
  const slide = pptx.addSlide();
  const cents = chart.series.some((series) => series.values.some((value) => !Number.isInteger(value)));
  const format = chart.money ? (cents ? "$#,##0.00" : "$#,##0") : "#,##0";
  const data = chart.series.map((series) => ({ name: series.name, labels: chart.labels, values: series.values }));
  const common = {
    x: 0, y: 0, w: chart.widthIn, h: chart.heightIn, chartColors: chart.colors, showTitle: Boolean(chart.title), title: chart.title ?? undefined,
    titleFontFace: font, titleFontSize: 11, titleColor: BODY, showLegend: chart.legend, legendPos: "b" as const, legendFontSize: 9, legendFontFace: font,
  };
  const axes = {
    catAxisLabelFontSize: 9, catAxisLabelColor: BODY, catAxisLabelFontFace: font, valAxisLabelFontSize: 8, valAxisLabelColor: MUTED, valAxisLabelFontFace: font,
    valAxisLabelFormatCode: chart.money ? "$#,##0" : "#,##0", valAxisMinVal: 0, valGridLine: { color: "E4E9EF", size: 0.5 },
    showValue: chart.type !== "line", dataLabelFontSize: 9, dataLabelColor: BODY, dataLabelFontFace: font, dataLabelFormatCode: format,
  };
  if (chart.type === "doughnut") {
    slide.addChart(pptx.ChartType.doughnut, data, { ...common, holeSize: 55, showPercent: true, showValue: false, dataLabelColor: "FFFFFF", dataLabelFontSize: 9 });
  } else if (chart.type === "line") {
    slide.addChart(pptx.ChartType.line, data, { ...common, ...axes, lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 6 });
  } else if (chart.type === "area") {
    slide.addChart(pptx.ChartType.area, data, { ...common, ...axes, chartColorsOpacity: 55 });
  } else {
    slide.addChart(pptx.ChartType.bar, data, { ...common, ...axes, barDir: chart.type === "barH" ? "bar" : "col", barGrouping: "clustered", barGapWidthPct: 60 });
  }
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const bytesOf = (value: string) => new TextEncoder().encode(value);
const target = (rels: string, type: string) => rels.match(new RegExp(`Type="[^"]*/${type}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Type="[^"]*/${type}"`));

/** Replaces each placeholder paragraph with a native chart. Returns the input unchanged when there are no charts. */
export async function embedCharts(docx: Uint8Array, slots: WordChartSlots, font: string): Promise<Uint8Array> {
  if (!slots.charts.length) return docx;
  const pptx = new PptxGenJS();
  for (const chart of slots.charts) addChart(pptx, chart, font);
  const deck = readZip(new Uint8Array((await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer));
  const word = readZip(docx);
  let documentXml = text(word.get("word/document.xml")!);
  let documentRels = text(word.get("word/_rels/document.xml.rels")!);
  let contentTypes = text(word.get("[Content_Types].xml")!);
  const added = new Map<string, Uint8Array>();
  slots.charts.forEach((chart, index) => {
    const n = index + 1;
    const slideRels = text(deck.get(`ppt/slides/_rels/slide${n}.xml.rels`)!);
    const chartPath = target(slideRels, "chart")!.slice(1).find(Boolean)!.replace(/^\//, "").replace(/^\.\.\//, "ppt/");
    const chartName = chartPath.split("/").pop()!;
    const chartRels = text(deck.get(`ppt/charts/_rels/${chartName}.rels`)!);
    const workbookPath = target(chartRels, "package")!.slice(1).find(Boolean)!;
    const workbook = deck.get(workbookPath.startsWith("/") ? workbookPath.slice(1) : `ppt/${workbookPath.replace(/^\.\.\//, "")}`)!;
    added.set(`word/charts/chart${n}.xml`, deck.get(chartPath)!);
    added.set(`word/charts/_rels/chart${n}.xml.rels`, bytesOf(chartRels.replace(workbookPath, `../embeddings/chart${n}.xlsx`)));
    added.set(`word/embeddings/chart${n}.xlsx`, workbook);
    documentRels = documentRels.replace("</Relationships>", `<Relationship Id="rIdAhChart${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart${n}.xml"/></Relationships>`);
    contentTypes = contentTypes.replace("</Types>", `<Override PartName="/word/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
    const token = documentXml.indexOf(TOKEN(n));
    if (token < 0) throw new Error(`Chart placeholder ${n} is missing`);
    const start = Math.max(documentXml.lastIndexOf("<w:p>", token), documentXml.lastIndexOf("<w:p ", token));
    const end = documentXml.indexOf("</w:p>", token) + "</w:p>".length;
    const drawing = `<w:p><w:pPr><w:keepLines/><w:spacing w:before="60" w:after="160"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>`
      + `<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">`
      + `<wp:extent cx="${Math.round(chart.widthIn * EMU)}" cy="${Math.round(chart.heightIn * EMU)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
      + `<wp:docPr id="${4000 + n}" name="Chart ${n}"/><wp:cNvGraphicFramePr/>`
      + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">`
      + `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdAhChart${n}"/>`
      + `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    documentXml = documentXml.slice(0, start) + drawing + documentXml.slice(end);
  });
  if (!/Extension="xlsx"/.test(contentTypes)) contentTypes = contentTypes.replace("</Types>", `<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/></Types>`);
  word.set("[Content_Types].xml", bytesOf(contentTypes));
  word.set("word/document.xml", bytesOf(documentXml));
  word.set("word/_rels/document.xml.rels", bytesOf(documentRels));
  for (const [name, data] of added) word.set(name, data);
  return writeZip(word);
}
