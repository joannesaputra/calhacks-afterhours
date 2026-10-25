import type { ContentBlock, SlideContent, WorkProduct } from "@afterhours/contracts";

/**
 * Deterministic slide text budgets. Fonts step down from the layout's base size to a readable
 * floor; content that still does not fit is reported as an issue instead of being shrunk
 * unreadably or silently clipped. Estimates assume ~0.5em average glyph width (Helvetica Neue/Arial)
 * and 1.2 line height, so they are conservative rather than pixel-exact.
 */
export const SLIDE = { width: 13.333, height: 7.5, x: 0.7, w: 11.9, titleY: 0.3, titleH: 1.0, bodyY: 1.4, bodyH: 5.3 } as const;
export const MIN_BODY_PT = 14;
export const TITLE_STEPS = [30, 28, 26, 24] as const;
/** Title-layout slides use a taller title box with larger type. */
export const COVER_TITLE = { y: 2.35, h: 1.7, steps: [40, 36, 32, 28] } as const;
export const MAX_SLIDE_BLOCKS = 2;
export const MAX_TABLE_ROWS = 7;
export const MAX_TABLE_COLUMNS = 5;
export const MAX_CHART_POINTS = 12;
const GLYPH_EM = 0.5;
/** 1.2 em single spacing x the renderer's 1.1 line spacing (LINE_SPACING in render/pptx.ts). */
const LINE = 1.32;

export function linesFor(text: string, widthIn: number, pt: number): number {
  const perLine = Math.max(1, Math.floor((widthIn * 72) / (pt * GLYPH_EM)));
  return text.split("\n").reduce((sum, paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) return sum + 1;
    let lines = 1;
    let used = 0;
    for (const word of words) {
      const length = word.length;
      if (used === 0) { lines += Math.floor(Math.max(0, length - 1) / perLine); used = length % perLine || perLine; continue; }
      if (used + 1 + length <= perLine) used += 1 + length;
      else { lines += 1 + Math.floor(Math.max(0, length - 1) / perLine); used = length % perLine || perLine; }
    }
    return sum + lines;
  }, 0);
}

export function heightFor(paragraphs: string[], widthIn: number, pt: number, paraSpacePt: number): number {
  const lines = paragraphs.reduce((sum, item) => sum + linesFor(item, widthIn, pt), 0);
  return (lines * pt * LINE + Math.max(0, paragraphs.length - 1) * paraSpacePt) / 72;
}

/** Largest font from `steps` whose wrapped text fits the box, or null. */
export function fitFont(paragraphs: string[], widthIn: number, heightIn: number, steps: readonly number[], paraSpacePt = 8): number | null {
  for (const pt of steps) if (heightFor(paragraphs, widthIn - 0.2, pt, paraSpacePt) <= heightIn - 0.1) return pt;
  return null;
}

export const bodySteps = (layout: SlideContent["layout"]): number[] => {
  const base = layout === "title" ? 24 : 22;
  const steps: number[] = [];
  for (let pt = base; pt >= MIN_BODY_PT; pt -= 2) steps.push(pt);
  return steps;
};

export function blockParagraphs(block: ContentBlock): string[] {
  if (block.kind === "paragraph") return [block.text ?? ""];
  if (block.kind === "bullets") return block.items;
  return [];
}

export interface BlockBox { x: number; y: number; w: number; h: number }
export function blockBoxes(slide: SlideContent): BlockBox[] {
  const count = Math.max(slide.blocks.length, 1);
  const gap = count > 1 ? 0.6 : 0;
  const w = (SLIDE.w - (count - 1) * gap) / count;
  return slide.blocks.map((_, index) => ({ x: SLIDE.x + index * (w + gap), y: SLIDE.bodyY, w, h: SLIDE.bodyH }));
}

/** Space left for a block's body after its heading and basis label. */
export const headingH = 0.45;
export const labelH = 0.3;
export function bodyBox(block: ContentBlock, box: BlockBox, labelled: boolean): BlockBox {
  const top = (block.heading ? headingH : 0) + (labelled ? labelH : 0);
  return { x: box.x, y: box.y + top, w: box.w, h: box.h - top };
}

export const needsBasisLabel = (block: ContentBlock) => block.basis === "recommendation" || block.basis === "assumption";

export function deckLayoutIssues(product: WorkProduct): string[] {
  const issues: string[] = [];
  if (product.kind !== "presentation") return issues;
  product.slides.forEach((slide, index) => {
    const name = `Slide ${index + 1}`;
    if (!slide.title.trim()) issues.push(`${name} has no title.`);
    if (!slide.blocks.length) issues.push(`${name} has no content.`);
    const cover = slide.layout === "title";
    if (fitFont([slide.title], SLIDE.w, cover ? COVER_TITLE.h : SLIDE.titleH, cover ? COVER_TITLE.steps : TITLE_STEPS, 0) === null) issues.push(`${name} title is too long for its title box at ${cover ? COVER_TITLE.steps.at(-1) : TITLE_STEPS.at(-1)} pt.`);
    if (cover && slide.blocks.some((block) => block.kind !== "paragraph" && block.kind !== "bullets")) issues.push(`${name} is a title slide and can only hold text.`);
    if (cover && slide.blocks[0] && fitFont(blockParagraphs(slide.blocks[0]), SLIDE.w, 1.6, [24, 22, 20, 18, 16]) === null) issues.push(`${name} subtitle text is too long for the title slide.`);
    if (slide.blocks.length > MAX_SLIDE_BLOCKS) issues.push(`${name} has ${slide.blocks.length} content blocks; at most ${MAX_SLIDE_BLOCKS} fit.`);
    const boxes = blockBoxes(slide);
    slide.blocks.forEach((block, blockIndex) => {
      const where = `${name} block ${blockIndex + 1}`;
      const box = bodyBox(block, boxes[blockIndex]!, needsBasisLabel(block));
      if (block.heading && fitFont([block.heading], box.w, headingH + 0.1, [19, 17, 16], 0) === null) issues.push(`${where} heading is too long.`);
      if (block.kind === "paragraph" || block.kind === "bullets") {
        const paragraphs = blockParagraphs(block);
        if (!paragraphs.some((item) => item.trim())) issues.push(`${where} is empty.`);
        else if (fitFont(paragraphs, box.w, box.h, bodySteps(slide.layout)) === null) issues.push(`${where} text does not fit at the ${MIN_BODY_PT} pt minimum; shorten it or keep the detail in the document.`);
      }
      if (block.kind === "table") {
        if (block.rows.length > MAX_TABLE_ROWS) issues.push(`${where} table has ${block.rows.length} rows; at most ${MAX_TABLE_ROWS} fit.`);
        if (block.columns.length > MAX_TABLE_COLUMNS || block.columns.length === 0) issues.push(`${where} table needs 1-${MAX_TABLE_COLUMNS} columns.`);
        if (block.rows.some((row) => row.length !== block.columns.length)) issues.push(`${where} table rows do not match its columns.`);
        const colW = box.w / Math.max(block.columns.length, 1);
        const rowH = (box.h - 0.1) / (block.rows.length + 1);
        if ([block.columns, ...block.rows].some((row) => row.some((cell) => heightFor([cell], colW - 0.15, MIN_BODY_PT, 0) > rowH))) issues.push(`${where} table cell text does not fit at ${MIN_BODY_PT} pt.`);
      }
      if (block.kind === "chart") {
        const chart = block.chart;
        if (!chart || !chart.labels.length || !chart.series.length) issues.push(`${where} chart has no data.`);
        else {
          if (chart.labels.length > MAX_CHART_POINTS) issues.push(`${where} chart has more than ${MAX_CHART_POINTS} categories.`);
          if (chart.series.some((series) => series.values.length !== chart.labels.length || series.values.some((value) => !Number.isFinite(value)))) issues.push(`${where} chart series do not match its labels.`);
        }
      }
    });
  });
  return issues;
}
