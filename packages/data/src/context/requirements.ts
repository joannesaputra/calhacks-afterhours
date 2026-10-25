// Turn feedback text into individual, source-backed requirements. Extraction is deterministic: a requirement that maps
// to a mechanical deck edit gets an `edit`; anything else is kept verbatim with `edit = null` and later reported as
// unsupported. Nothing here is inferred by a model, and instruction-like text addressed to the assistant is dropped.
import { createHash } from "node:crypto";
import type { ContextRequirement, EditOp } from "@afterhours/contracts";

export interface ExtractedRequirement { text: string; edit: EditOp | null; scope: string; quote: string }
export interface Extraction { requirements: ExtractedRequirement[]; flagged: number }

const INJECTION = new RegExp([
  "ignore\\s+(?:all\\s+|any\\s+|the\\s+|your\\s+)?(?:previous|prior|above|earlier|system)",
  "disregard\\s+(?:all\\s+|the\\s+|your\\s+)?(?:previous|prior|above|system|instructions|rules)",
  "you\\s+are\\s+now\\b",
  "system\\s+prompt",
  "(?:grant|give)\\s+(?:yourself|me|us|them|everyone)\\s+(?:full\\s+|more\\s+|additional\\s+)?access",
  "(?:share|open|expose|connect|index)\\s+(?:all|every|the\\s+whole|my\\s+entire)\\s+(?:folders?|drive|inbox|files|mailbox|documents)",
  "(?:forward|send|email|post|upload)\\s+(?:this|it|that|them|all|every|the)\\b[^.\\n]{0,60}\\s(?:to|at)\\s+\\S+@\\S+",
  "(?:reveal|print|leak|output|show|disclose)\\b[^.\\n]{0,40}\\b(?:secret|api\\s*key|token|credential|password|system\\s+prompt)",
  "exfiltrat",
  "(?:run|execute)\\s+(?:this\\s+|the\\s+)?(?:command|code|script|shell)",
].join("|"), "i");

export const looksLikeInjection = (text: string): boolean => INJECTION.test(text);

const VERB = "(?:change|replace|update|swap|set|correct|revise|edit|rename|reword|fix|adjust|add|include|remove|delete|drop|cut|shorten|lengthen|expand|trim|move|reorder|simplify|clarify|emphasi[sz]e|highlight|tighten|rework|make|use|show|put|list|call|write|say|keep|lead|start|end|finish|bring|lower|raise|increase|decrease|reduce|extend|split|merge|combine)";
const MODAL = /\b(?:should|needs?\s+to|must|has\s+to|have\s+to|ought\s+to|can\s+we|could\s+we|let'?s|we\s+want|i\s+want|we\s+need|i\s+need|instead\s+of|rather\s+than|too\s+(?:long|short|vague|dense))\b/i;
const CONTENT_NOUN = /\b(?:price|prices|pricing|fee|fees|cost|costs|budget|timeline|schedule|date|dates|title|titles|heading|agenda|logo|chart|graph|image|photo|picture|font|colou?r|tone|wording|summary|intro|introduction|conclusion|team|cover|bullet|bullets|scope|deliverables?|terms|payment|discount|number|numbers|figure|figures|whole thing|overall|everything|tone|design|layout|style|branding|warmer|clearer|shorter|longer|simpler|bolder|friendlier)\b/i;
const DECK_WORD = /\b(?:deck|presentation|slides?|slide deck|pptx|powerpoint)\b/i;
const QUOTE = `["“”']`;

const stripBullet = (s: string) => s.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, "").trim();

function slideRef(unit: string, slideCount: number | null): { slide: number | null; ranged: boolean } {
  const range = /\bslides?\s*#?(\d{1,3})\s*(?:-|–|to|through|and|&)\s*(\d{1,3})\b/i.exec(unit);
  if (range) return { slide: null, ranged: true };
  const one = /\bslide\s*(?:no\.?|number|#)?\s*(\d{1,3})\b/i.exec(unit);
  if (one) return { slide: Number(one[1]), ranged: false };
  if (/\b(?:title|first|cover|opening)\s+slide\b/i.test(unit)) return { slide: 1, ranged: false };
  if (/\b(?:last|final|closing)\s+slide\b/i.test(unit)) return { slide: slideCount, ranged: false };
  return { slide: null, ranged: false };
}

const NUM = String.raw`\$?\d[\d,]*(?:\.\d+)?\s?(?:%|[kKmM]\b|USD|weeks?|days?|months?|hours?)?`;

function structured(unit: string, slide: number | null): EditOp | null {
  let m = /\b(?:remove|delete|drop|cut)\s+(?:the\s+)?slide\s*#?(\d{1,3})\b/i.exec(unit) ?? /\bslide\s*#?(\d{1,3})\s+(?:can|should|needs?\s+to|must)\s+(?:go|be\s+(?:removed|deleted|dropped|cut))\b/i.exec(unit);
  if (m) return { op: "delete_slide", slide: Number(m[1]) };

  m = new RegExp(`${QUOTE}([^"“”]{1,300}?)${QUOTE}\\s*(?:to|with|into|->|→|by)\\s*${QUOTE}([^"“”]{0,300}?)${QUOTE}`, "i").exec(unit);
  if (m && new RegExp(`\\b${VERB}\\b`, "i").test(unit.slice(0, m.index))) return { op: "replace_text", slide, find: m[1]!.trim(), replace: m[2]!.trim() };

  m = new RegExp(`${QUOTE}([^"“”]{1,300}?)${QUOTE}\\s+(?:should|needs?\\s+to|must)\\s+(?:say|read|be)\\s+${QUOTE}([^"“”]{0,300}?)${QUOTE}`, "i").exec(unit);
  if (m) return { op: "replace_text", slide, find: m[1]!.trim(), replace: m[2]!.trim() };

  m = new RegExp(`\\buse\\s+${QUOTE}([^"“”]{1,300}?)${QUOTE}\\s+instead\\s+of\\s+${QUOTE}([^"“”]{1,300}?)${QUOTE}`, "i").exec(unit);
  if (m) return { op: "replace_text", slide, find: m[2]!.trim(), replace: m[1]!.trim() };

  m = new RegExp(`\\badd\\b(?:\\s+(?:a|another|one|the))?(?:\\s+new)?\\s*(?:bullet(?:\\s+point)?|point|line|item)?\\s*(?:saying|that\\s+says|reading|:|-)?\\s*${QUOTE}([^"“”]{2,400}?)${QUOTE}`, "i").exec(unit);
  if (m && slide) return { op: "append_bullet", slide, text: m[1]!.trim() };

  m = new RegExp(`\\b(?:change|update|replace|swap|correct|revise|set|adjust|edit|make)\\b[^.\\n]*?\\b(?:from\\s+)?(${NUM})\\s*(?:to|with|->|→)\\s*(${NUM})`, "i").exec(unit);
  if (m) return { op: "replace_text", slide, find: m[1]!.trim(), replace: m[2]!.trim() };
  return null;
}

/** The request sentence itself ("Can you revise the deck based on what we discussed?") is the task, not a requirement. */
function isTaskSentence(unit: string): boolean {
  if (/\bslide\s*\d|[“"']|\d/.test(unit)) return false;
  return DECK_WORD.test(unit) && /\b(?:revise|update|edit|rework|redo|tweak|modify|amend|polish|refresh|apply|incorporate|send|share|prepare|finali[sz]e|look at|review)\b/i.test(unit);
}

/** Extract individual requested edits from newly authored text. */
export function extractRequirements(text: string, opts: { slideCount?: number | null } = {}): Extraction {
  const slideCount = opts.slideCount ?? null;
  const out: ExtractedRequirement[] = [];
  let flagged = 0;
  let ctxSlide: number | null = null;
  const units: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = stripBullet(raw);
    if (!line) continue;
    const heading = /^slide\s*#?(\d{1,3})\s*[:\-–]?\s*$/i.exec(line);
    if (heading) { ctxSlide = Number(heading[1]); continue; }
    const lead = /^slide\s*#?(\d{1,3})\s*[:\-–]\s*(.+)$/i.exec(line);
    for (const sentence of (lead ? lead[2]! : line).split(/(?<=[.!?])\s+(?=[A-Z"“'])/)) {
      units.push(lead ? `slide ${lead[1]}: ${sentence}` : ctxSlide && !/\bslide\s*\d/i.test(sentence) ? `slide ${ctxSlide}: ${sentence}` : sentence);
    }
    if (!heading && !lead && !/^\s*(?:[-*•–]|\d+[.)])\s+/.test(raw)) ctxSlide = null;
  }
  for (const unit of units) {
    const t = unit.trim();
    if (!t) continue;
    if (looksLikeInjection(t)) { flagged += 1; continue; }
    const ref = slideRef(t, slideCount);
    const edit = structured(t, ref.slide);
    const clean = t.replace(/^slide\s*\d+:\s*/i, (m) => m);
    if (edit) {
      const scope = edit.op === "replace_text" ? (edit.slide ? `slide ${edit.slide}` : "deck") : `slide ${edit.slide}`;
      out.push({ text: clean.slice(0, 600), edit, scope, quote: clean.slice(0, 300) });
      continue;
    }
    if (isTaskSentence(t)) continue;
    const specific = ref.slide !== null || ref.ranged || /[“"']/.test(t) || /\d/.test(t) || CONTENT_NOUN.test(t);
    const imperative = new RegExp(`^(?:(?:please|also|and|then|plus|finally|lastly)[, ]+)*${VERB}\\b`, "i").test(t) || MODAL.test(t);
    if (imperative && specific) out.push({ text: clean.slice(0, 600), edit: null, scope: ref.slide ? `slide ${ref.slide}` : "deck", quote: clean.slice(0, 300) });
  }
  return { requirements: out, flagged };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Stable across revisions and runs: the same edit always has the same id. */
export function requirementId(r: { text: string; edit: EditOp | null }): string {
  const key = r.edit ? JSON.stringify(r.edit, Object.keys(r.edit).sort()) : norm(r.text);
  return `req-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

/** Mark requirements that ask for incompatible things. Never picks a winner. */
export function markConflicts(reqs: ContextRequirement[]): ContextRequirement[] {
  const conflicts = new Map<string, Set<string>>(reqs.map((r) => [r.id, new Set()]));
  const sameTarget = (a: EditOp, b: EditOp) => "slide" in a && "slide" in b && a.slide === b.slide && a.slide !== null;
  for (let i = 0; i < reqs.length; i += 1) {
    for (let j = i + 1; j < reqs.length; j += 1) {
      const a = reqs[i]!.edit; const b = reqs[j]!.edit;
      if (!a || !b) continue;
      const clash =
        (a.op === "replace_text" && b.op === "replace_text" && norm(a.find) === norm(b.find) && norm(a.replace) !== norm(b.replace) && (a.slide === b.slide || a.slide === null || b.slide === null)) ||
        (a.op === "delete_slide" && b.op !== "delete_slide" && sameTarget(a, b)) ||
        (b.op === "delete_slide" && a.op !== "delete_slide" && sameTarget(a, b));
      if (clash) { conflicts.get(reqs[i]!.id)!.add(reqs[j]!.id); conflicts.get(reqs[j]!.id)!.add(reqs[i]!.id); }
    }
  }
  return reqs.map((r) => ({ ...r, conflictsWith: [...conflicts.get(r.id)!] }));
}
