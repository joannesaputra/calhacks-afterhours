import type { SourceDocument, WorkPlan, WorkProduct } from "@afterhours/contracts";
import { displayPercent, type SalesMetrics } from "./calculations";
import { EngineError } from "./errors";
import { deckLayoutIssues } from "./layout";
import { normalizeWhitespace } from "./sources";

export interface VerifyContext {
  /** Code-calculated metrics; when present every number in report content must derive from them or the sources. */
  metrics: SalesMetrics | null;
  /** Slide count explicitly requested in the email, if any. */
  requestedSlides: number | null;
  organizationCurrency: string;
  /** Extra month/day keys allowed in proposal content, e.g. the resolved deadline's local date. */
  allowedDates: string[];
}

export interface Issue { code: "INVALID_OUTPUT" | "UNGROUNDED_CONTENT" | "UNSUPPORTED_NUMBER" | "LAYOUT_BUDGET"; message: string }

const MAX_QUOTE = 300;
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const MONEY = /(?:\b(USD|EUR|GBP|CAD|AUD)\s?|([$€£]))\s?(\d[\d,]*(?:\.\d+)?)/gi;
const PERCENT = /(\d[\d,]*(?:\.\d+)?)\s?%/g;
const DATE = new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2})\\b`, "gi");

const num = (text: string) => Number(text.replace(/,/g, ""));
const symbolCurrency: Record<string, string> = { "€": "EUR", "£": "GBP" };

export function moneyKeys(text: string, organizationCurrency: string): string[] {
  return [...text.matchAll(MONEY)].map((match) => `${(match[1]?.toUpperCase() ?? symbolCurrency[match[2]!] ?? (organizationCurrency === "USD" ? "USD" : "$"))}:${num(match[3]!)}`);
}
const percentKeys = (text: string) => [...text.matchAll(PERCENT)].map((match) => num(match[1]!));
const dateKeys = (text: string) => [...text.matchAll(DATE)].map((match) => `${match[1]!.toLowerCase()} ${Number(match[2])}`);
const numbers = (text: string) => [...text.matchAll(NUMBER)].map((match) => num(match[0]));

function productStrings(product: WorkProduct): string[] {
  const blocks = [...product.blocks, ...product.slides.flatMap((slide) => slide.blocks)];
  return [
    product.title, product.subtitle ?? "", ...product.assumptions, ...product.warnings,
    ...product.slides.flatMap((slide) => [slide.title, slide.speakerNotes]),
    ...blocks.flatMap((block) => [block.heading ?? "", block.text ?? "", ...block.items, ...block.columns, ...block.rows.flat(), ...(block.chart ? [...block.chart.labels, ...block.chart.series.map((series) => series.name), block.chart.unit ?? ""] : [])]),
  ];
}

/** Percent changes are computed to 2 decimals and displayed to 1 (displayPercent); both forms are calculated values. */
const pctForms = (value: number) => [value, Math.abs(value), Math.abs(displayPercent(value))];

export function metricNumbers(metrics: SalesMetrics): number[] {
  const values: number[] = [metrics.rows.length, metrics.rows.length + 1, metrics.months.length, metrics.channels.length, metrics.revenueChangeMinor / 100, Math.abs(metrics.revenueChangeMinor / 100), metrics.orderChange, Math.abs(metrics.orderChange)];
  for (const pct of [metrics.revenueGrowthPercent, metrics.orderGrowthPercent]) if (pct !== null) values.push(...pctForms(pct));
  for (const month of metrics.months) {
    const [year, mm] = month.month.split("-").map(Number);
    values.push(year!, mm!, month.revenueMinor / 100, month.orders);
    if (month.averageOrderValueMinor !== null) values.push(month.averageOrderValueMinor / 100);
  }
  for (const channel of metrics.channels) {
    values.push(...Object.values(channel.values).map((value) => value / 100), ...Object.values(channel.sharePercent).filter((value): value is number => value !== null));
    if (channel.growthPercent !== null) values.push(...pctForms(channel.growthPercent));
  }
  return values;
}

/** Returns every problem found so a live repair request can address all of them at once. */
export function productIssues(plan: WorkPlan, sources: SourceDocument[], products: WorkProduct[], context: VerifyContext): Issue[] {
  const issues: Issue[] = [];
  const add = (code: Issue["code"], message: string) => issues.push({ code, message });
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const complete = sources.filter((source) => source.extractionStatus === "complete");
  const productKinds = products.map((product) => product.kind).sort();
  const requested = [...plan.requestedOutputs].sort();
  if (JSON.stringify(productKinds) !== JSON.stringify(requested)) add("INVALID_OUTPUT", `Generated product kinds (${productKinds.join(", ") || "none"}) do not match the requested outputs (${requested.join(", ") || "none"}).`);
  if (new Set(products.map((product) => product.id)).size !== products.length) add("INVALID_OUTPUT", "Generated product IDs are not unique.");

  const sourceText = complete.map((source) => source.text).join("\n");
  const allowedMoney = new Set([...moneyKeys(sourceText, context.organizationCurrency), ...(context.metrics ? metricNumbers(context.metrics).map((value) => `USD:${value}`) : [])]);
  const allowedPercent = new Set([...percentKeys(sourceText), ...(context.metrics ? metricNumbers(context.metrics) : [])]);
  const allowedDates = new Set([...dateKeys(sourceText), ...context.allowedDates]);
  const allowedNumbers = new Set([...numbers(sourceText), ...(context.metrics ? metricNumbers(context.metrics) : [])]);

  for (const product of products) {
    const blocks = [...product.blocks, ...product.slides.flatMap((slide) => slide.blocks)];
    if (product.kind === "presentation") {
      if (product.slides.length === 0) add("INVALID_OUTPUT", "A presentation must contain actual slides.");
      if (context.requestedSlides !== null && product.slides.length !== context.requestedSlides) add("INVALID_OUTPUT", `The request asked for ${context.requestedSlides} slides but the deck has ${product.slides.length}.`);
      if (context.requestedSlides === null && (product.slides.length < 3 || product.slides.length > 10)) add("INVALID_OUTPUT", "A presentation without a requested slide count must have 3-10 slides.");
      for (const issue of deckLayoutIssues(product)) add("LAYOUT_BUDGET", issue);
    } else if (product.blocks.length === 0) add("INVALID_OUTPUT", `The ${product.kind} document has no content blocks.`);
    if (new Set(blocks.map((block) => block.id)).size !== blocks.length) add("INVALID_OUTPUT", `${product.kind} block IDs are not unique.`);
    const strings = productStrings(product);
    const joined = strings.join("\n");
    if (/lorem ipsum|insert data here|foundation placeholder|\btodo\b|\btbd\b|\[[a-z ]*placeholder[a-z ]*\]/i.test(joined)) add("INVALID_OUTPUT", `The ${product.kind} contains placeholder text.`);
    for (const key of new Set(moneyKeys(joined, context.organizationCurrency))) if (!allowedMoney.has(key)) add("UNSUPPORTED_NUMBER", `The ${product.kind} states the amount ${key.replace(":", " ")}, which is not in the sources${context.metrics ? " or the calculated metrics" : ""}.`);
    for (const value of new Set(percentKeys(joined))) if (!allowedPercent.has(value)) add("UNSUPPORTED_NUMBER", `The ${product.kind} states ${value}%, which is not in the sources${context.metrics ? " or the calculated metrics" : ""}.`);
    if (!context.metrics) for (const key of new Set(dateKeys(joined))) if (!allowedDates.has(key)) add("UNSUPPORTED_NUMBER", `The ${product.kind} states the date "${key}", which is not in the sources.`);
    if (context.metrics) {
      for (const value of new Set(numbers(joined))) if (!allowedNumbers.has(value)) add("UNSUPPORTED_NUMBER", `The ${product.kind} contains the number ${value}, which is not a calculated metric or a source value.`);
      for (const block of blocks) for (const series of block.chart?.series ?? []) for (const value of series.values) if (!allowedNumbers.has(value)) add("UNSUPPORTED_NUMBER", `${block.id} chart value ${value} is not a calculated metric.`);
    }
    for (const block of blocks) {
      if ((block.basis === "source" || block.basis === "calculated") && block.evidence.length === 0) add("UNGROUNDED_CONTENT", `${block.id} is ${block.basis}-based but has no evidence.`);
      if (block.kind === "chart" && block.basis !== "calculated") add("UNGROUNDED_CONTENT", `${block.id} is a chart but is not marked calculated.`);
      if (block.kind === "chart" && !context.metrics) add("UNGROUNDED_CONTENT", `${block.id} is a chart but no calculation backs it.`);
      for (const evidence of block.evidence) {
        const source = sourceMap.get(evidence.sourceId);
        if (!source || source.extractionStatus !== "complete") { add("UNGROUNDED_CONTENT", `${block.id} cites an unavailable source.`); continue; }
        if (evidence.quote && evidence.quote.length > MAX_QUOTE) add("UNGROUNDED_CONTENT", `${block.id} has a quote longer than ${MAX_QUOTE} characters.`);
        if (evidence.quote && !normalizeWhitespace(source.text).includes(normalizeWhitespace(evidence.quote))) add("UNGROUNDED_CONTENT", `${block.id} contains a quote that does not match its source.`);
      }
    }
  }
  return issues;
}

export function verifyProducts(plan: WorkPlan, sources: SourceDocument[], products: WorkProduct[], context: VerifyContext): void {
  const issue = productIssues(plan, sources, products, context)[0];
  if (issue) throw new EngineError(issue.code, issue.message, false);
}
