// Read and edit an existing .pptx package in place. Nothing is rebuilt: only the parts an edit touches are rewritten,
// so layouts, masters, themes, media, charts and every untouched slide keep their original bytes.
import path from "node:path";
import { strFromU8, strToU8 } from "fflate";
import type { EditOp, RequirementStatus } from "@afterhours/contracts";
import { OoxmlError, readPackage, text as partText, writePackage } from "./zip";
import { decodeXml, encodeXml, wellFormed } from "./xml";

export interface SlideRef { number: number; partName: string; relsName: string; rId: string; sldId: string }

const attrOf = (tag: string, name: string): string | null => {
  const m = new RegExp(`(?:^|[\\s<])${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decodeXml(m[2] ?? m[3] ?? "") : null;
};

interface Rel { id: string; type: string; target: string; tag: string }
export function parseRels(xml: string | null): Rel[] {
  if (!xml) return [];
  return [...xml.matchAll(/<Relationship\b[^>]*?\/?>/g)].map((m) => ({
    id: attrOf(m[0], "Id") ?? "", type: attrOf(m[0], "Type") ?? "", target: attrOf(m[0], "Target") ?? "", tag: m[0],
  }));
}

function resolvePart(baseDir: string, target: string): string {
  const clean = target.split("#")[0]!;
  return clean.startsWith("/") ? clean.slice(1) : path.posix.normalize(path.posix.join(baseDir, clean));
}
const relsNameFor = (part: string) => path.posix.join(path.posix.dirname(part), "_rels", `${path.posix.basename(part)}.rels`);

export function listSlides(files: Map<string, Uint8Array>): SlideRef[] {
  const pres = partText(files, "ppt/presentation.xml");
  if (!pres) throw new OoxmlError("corrupt", "The package has no ppt/presentation.xml.");
  const rels = new Map(parseRels(partText(files, "ppt/_rels/presentation.xml.rels")).map((r) => [r.id, r]));
  const slides: SlideRef[] = [];
  for (const m of pres.matchAll(/<p:sldId\b[^>]*?\/?>/g)) {
    const rId = attrOf(m[0], "r:id");
    const rel = rId ? rels.get(rId) : undefined;
    if (!rId || !rel) throw new OoxmlError("corrupt", "A slide in the slide list has no matching relationship.");
    const partName = resolvePart("ppt", rel.target);
    if (!files.has(partName)) throw new OoxmlError("corrupt", `Slide part ${partName} is missing.`);
    slides.push({ number: slides.length + 1, partName, relsName: relsNameFor(partName), rId, sldId: attrOf(m[0], "id") ?? "" });
  }
  if (slides.length === 0) throw new OoxmlError("corrupt", "The presentation has no slides.");
  return slides;
}

// ---- paragraphs ----
interface Segment { kind: "run" | "br" | "field"; text: string; xmlStart: number; xmlEnd: number; tStart: number; tEnd: number; selfClosingT: boolean }
export interface Paragraph { xml: string; start: number; end: number; segments: Segment[]; text: string }

const PARA = /<a:p(?=[\s>])[^>]*>[\s\S]*?<\/a:p>/g;
const SEGMENT = /<a:r(?=[\s>])[\s\S]*?<\/a:r>|<a:br(?:\s[^>]*)?\/>|<a:fld(?=[\s>])[\s\S]*?<\/a:fld>/g;

export function paragraphsOf(slideXml: string, from = 0, to = slideXml.length): Paragraph[] {
  const region = slideXml.slice(from, to);
  const out: Paragraph[] = [];
  for (const m of region.matchAll(PARA)) {
    const xml = m[0];
    const segments: Segment[] = [];
    for (const s of xml.matchAll(SEGMENT)) {
      const seg = s[0];
      if (seg.startsWith("<a:br")) { segments.push({ kind: "br", text: "\n", xmlStart: s.index!, xmlEnd: s.index! + seg.length, tStart: -1, tEnd: -1, selfClosingT: false }); continue; }
      const t = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:t\s*\/>/.exec(seg);
      if (!t) continue;
      const selfClosing = t[1] === undefined;
      const innerStart = selfClosing ? t.index : t.index + t[0].indexOf(">") + 1;
      segments.push({
        kind: seg.startsWith("<a:fld") ? "field" : "run",
        text: selfClosing ? "" : decodeXml(t[1]!),
        xmlStart: s.index!, xmlEnd: s.index! + seg.length,
        tStart: s.index! + (selfClosing ? t.index : innerStart), tEnd: s.index! + (selfClosing ? t.index + t[0].length : innerStart + t[1]!.length),
        selfClosingT: selfClosing,
      });
    }
    out.push({ xml, start: from + m.index!, end: from + m.index! + xml.length, segments, text: segments.map((s) => s.text).join("") });
  }
  return out;
}

function rewriteParagraph(p: Paragraph, texts: string[]): string {
  let xml = "";
  let cursor = 0;
  p.segments.forEach((seg, i) => {
    if (seg.kind === "br" || texts[i] === seg.text) return;
    xml += p.xml.slice(cursor, seg.tStart);
    xml += seg.selfClosingT ? `<a:t>${encodeXml(texts[i]!)}</a:t>` : encodeXml(texts[i]!);
    cursor = seg.tEnd;
  });
  return xml + p.xml.slice(cursor);
}

const norm = (s: string) => s.replace(/\u00a0/g, " ");

/** Whole-token presence, so a one-letter replacement is never "already there" just because the letter occurs somewhere. */
function containsToken(haystack: string, needle: string): boolean {
  const n = norm(needle).trim();
  if (n.length < 3) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(norm(haystack));
}

function replaceInParagraph(p: Paragraph, find: string, replace: string): { xml: string; count: number } | "spans_locked" | null {
  const full = norm(p.text);
  const target = norm(find);
  const hits: number[] = [];
  for (let at = full.indexOf(target); at >= 0; at = full.indexOf(target, at + target.length)) hits.push(at);
  if (!hits.length) return null;
  const starts: number[] = [];
  let acc = 0;
  for (const s of p.segments) { starts.push(acc); acc += s.text.length; }
  const texts = p.segments.map((s) => s.text);
  for (const s of [...hits].reverse()) {
    const e = s + target.length;
    const covered = p.segments.map((seg, i) => ({ seg, i, a: starts[i]!, b: starts[i]! + seg.text.length })).filter((x) => x.a < e && x.b > s);
    if (covered.some((c) => c.seg.kind !== "run")) return "spans_locked";
    const first = covered[0]!;
    const last = covered.at(-1)!;
    if (first.i === last.i) {
      texts[first.i] = texts[first.i]!.slice(0, s - first.a) + replace + texts[first.i]!.slice(e - first.a);
    } else {
      texts[first.i] = texts[first.i]!.slice(0, s - first.a) + replace;
      for (const c of covered.slice(1, -1)) texts[c.i] = "";
      texts[last.i] = texts[last.i]!.slice(e - last.a);
    }
  }
  return { xml: rewriteParagraph(p, texts), count: hits.length };
}

// ---- shapes ----
interface Shape { xml: string; start: number; end: number; placeholder: string | null; paragraphs: Paragraph[] }
function shapesOf(slideXml: string): Shape[] {
  const out: Shape[] = [];
  for (const m of slideXml.matchAll(/<p:sp(?=[\s>])[\s\S]*?<\/p:sp>/g)) {
    const xml = m[0];
    if (!xml.includes("<p:txBody>") && !/<p:txBody(?=[\s>])/.test(xml)) continue;
    const ph = /<p:ph\b([^>]*?)\/?>/.exec(xml);
    const type = ph ? (attrOf(ph[0], "type") ?? "body") : null;
    out.push({ xml, start: m.index!, end: m.index! + xml.length, placeholder: type, paragraphs: paragraphsOf(slideXml, m.index!, m.index! + xml.length) });
  }
  return out;
}

const TITLE_TYPES = new Set(["title", "ctrTitle"]);
const CHROME_TYPES = new Set(["ftr", "sldNum", "dt"]);
const textOf = (p: Paragraph) => p.text.trim();

export interface SlideText { number: number; title: string; paragraphs: string[]; notes: string }

function titleShape(shapes: Shape[]): Shape | null {
  const titled = shapes.find((s) => s.placeholder && TITLE_TYPES.has(s.placeholder) && s.paragraphs.some((p) => textOf(p)));
  return titled ?? shapes.find((s) => !CHROME_TYPES.has(s.placeholder ?? "") && s.paragraphs.some((p) => textOf(p))) ?? null;
}

export function readDeckText(files: Map<string, Uint8Array>): SlideText[] {
  return listSlides(files).map((ref) => {
    const xml = partText(files, ref.partName) ?? "";
    const shapes = shapesOf(xml);
    const titled = titleShape(shapes);
    const title = titled?.paragraphs.map(textOf).find(Boolean) ?? "";
    const body = shapes.filter((s) => s !== titled && !CHROME_TYPES.has(s.placeholder ?? "") && !(s.placeholder && TITLE_TYPES.has(s.placeholder)))
      .flatMap((s) => s.paragraphs.map(textOf)).filter(Boolean);
    // Text in graphic frames (tables) is read too: it is content a feedback email can refer to.
    const framed = [...xml.matchAll(/<p:graphicFrame[\s\S]*?<\/p:graphicFrame>/g)].flatMap((m) => paragraphsOf(m[0]).map(textOf)).filter(Boolean);
    const rels = parseRels(partText(files, ref.relsName));
    const notesRel = rels.find((r) => r.type.endsWith("/notesSlide"));
    let notes = "";
    if (notesRel) {
      const nx = partText(files, resolvePart(path.posix.dirname(ref.partName), notesRel.target)) ?? "";
      notes = shapesOf(nx).filter((s) => !CHROME_TYPES.has(s.placeholder ?? "") && s.placeholder !== "sldImg" && s.placeholder !== "sldNum")
        .flatMap((s) => s.paragraphs.map(textOf)).filter(Boolean).join("\n");
    }
    return { number: ref.number, title, paragraphs: [...body, ...framed], notes };
  });
}

export function readDeckBytes(bytes: Uint8Array): SlideText[] {
  return readDeckText(readPackage(bytes));
}

// ---- edits ----
export interface DeckEditInput { id: string; edit: EditOp | null }
export interface DeckEditResult { requirementId: string; status: RequirementStatus; detail: string }
export interface DeckEditOutcome {
  bytes: Uint8Array;
  results: DeckEditResult[];
  changedParts: string[];
  removedParts: string[];
  slideCount: { before: number; after: number };
}

const bulletParagraph = (p: Paragraph) => /<a:buChar\b|<a:buAutoNum\b/.test(p.xml);

function chooseBodyShape(shapes: Shape[]): Shape | null {
  const candidates = shapes.filter((s) => !CHROME_TYPES.has(s.placeholder ?? "") && !(s.placeholder && TITLE_TYPES.has(s.placeholder)) && s.paragraphs.length > 0);
  const bodyPh = candidates.find((s) => s.placeholder === "body" || s.placeholder === "obj");
  if (bodyPh) return bodyPh;
  const bulleted = candidates.filter((s) => s.paragraphs.some(bulletParagraph));
  const pool = bulleted.length ? bulleted : [];
  return pool.sort((a, b) => b.paragraphs.length - a.paragraphs.length)[0] ?? null;
}

function appendBulletTo(slideXml: string, text: string): { xml: string } | "no_body" | "already" {
  const shapes = shapesOf(slideXml);
  const shape = chooseBodyShape(shapes);
  if (!shape) return "no_body";
  if (shape.paragraphs.some((p) => norm(p.text).trim() === norm(text).trim())) return "already";
  const template = [...shape.paragraphs].reverse().find((p) => textOf(p) && p.segments.some((s) => s.kind === "run")) ?? shape.paragraphs.at(-1)!;
  const firstRun = template.segments.find((s) => s.kind === "run");
  let clone: string;
  if (firstRun) {
    const runXml = template.xml.slice(firstRun.xmlStart, firstRun.xmlEnd);
    const newRun = runXml.replace(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>|<a:t\s*\/>/, `<a:t>${encodeXml(text)}</a:t>`);
    const open = /^<a:p(?=[\s>])[^>]*>/.exec(template.xml)![0];
    const pPr = /<a:pPr(?:\s[^>]*)?\/>|<a:pPr(?=[\s>])[\s\S]*?<\/a:pPr>/.exec(template.xml)?.[0] ?? "";
    const end = /<a:endParaRPr(?:\s[^>]*)?\/>|<a:endParaRPr(?=[\s>])[\s\S]*?<\/a:endParaRPr>/.exec(template.xml)?.[0] ?? "";
    clone = `${open}${pPr}${newRun}${end}</a:p>`;
  } else {
    clone = `<a:p><a:r><a:t>${encodeXml(text)}</a:t></a:r></a:p>`;
  }
  const last = shape.paragraphs.at(-1)!;
  return { xml: slideXml.slice(0, last.end) + clone + slideXml.slice(last.end) };
}

/** Apply requested edits to a package. Slide numbers always refer to the ORIGINAL deck. */
export function applyDeckEdits(original: Uint8Array, edits: DeckEditInput[]): DeckEditOutcome {
  const files = readPackage(original);
  const slides = listSlides(files);
  const work = new Map<string, string>(slides.map((s) => [s.partName, partText(files, s.partName)!]));
  const touched = new Set<string>();
  const results = new Map<string, DeckEditResult>();
  const set = (id: string, status: RequirementStatus, detail: string) => results.set(id, { requirementId: id, status, detail });
  const slideOk = (n: number) => n >= 1 && n <= slides.length;

  const deletes = new Set<number>();
  for (const { id, edit } of edits) {
    if (edit?.op !== "delete_slide") continue;
    if (!slideOk(edit.slide)) set(id, "blocked", `Slide ${edit.slide} does not exist; the deck has ${slides.length} slides.`);
    else deletes.add(edit.slide);
  }
  if (deletes.size >= slides.length) {
    for (const { id, edit } of edits) if (edit?.op === "delete_slide" && deletes.has(edit.slide)) set(id, "blocked", "Removing every slide would leave an empty presentation.");
    deletes.clear();
  }

  for (const { id, edit } of edits) {
    if (results.has(id)) continue;
    if (!edit) { set(id, "unsupported", "This request could not be expressed as a slide edit the editor can perform (replace text, add a bullet, remove a slide)."); continue; }
    if (edit.op === "delete_slide") continue;
    if (edit.slide !== null && !slideOk(edit.slide)) { set(id, "blocked", `Slide ${edit.slide} does not exist; the deck has ${slides.length} slides.`); continue; }
    if (edit.slide !== null && deletes.has(edit.slide)) { set(id, "blocked", `Slide ${edit.slide} is also being removed, so this edit has no effect.`); continue; }
    const scope = edit.slide === null ? slides.filter((s) => !deletes.has(s.number)) : [slides[edit.slide - 1]!];

    if (edit.op === "append_bullet") {
      const ref = scope[0]!;
      const r = appendBulletTo(work.get(ref.partName)!, edit.text);
      if (r === "already") set(id, "already_satisfied", `Slide ${ref.number} already contains that bullet.`);
      else if (r === "no_body") set(id, "blocked", `Slide ${ref.number} has no bulleted body text to add to; adding a new text box is not supported.`);
      else { work.set(ref.partName, r.xml); touched.add(ref.partName); set(id, "applied", `Added a bullet to slide ${ref.number}.`); }
      continue;
    }

    // replace_text
    let applied = 0;
    let locked = false;
    const where: number[] = [];
    for (const ref of scope) {
      let xml = work.get(ref.partName)!;
      const paras = paragraphsOf(xml);
      let delta = 0;
      let changed = false;
      for (const p of paras) {
        const r = replaceInParagraph(p, edit.find, edit.replace);
        if (r === "spans_locked") { locked = true; continue; }
        if (!r) continue;
        const start = p.start + delta;
        xml = xml.slice(0, start) + r.xml + xml.slice(start + p.xml.length);
        delta += r.xml.length - p.xml.length;
        applied += r.count;
        changed = true;
      }
      if (changed) { work.set(ref.partName, xml); touched.add(ref.partName); where.push(ref.number); }
    }
    if (applied) set(id, "applied", `Replaced ${applied} occurrence${applied === 1 ? "" : "s"} on slide${where.length === 1 ? "" : "s"} ${where.join(", ")}.`);
    else if (locked) set(id, "blocked", "The text to change spans a line break or an automatic field, which the editor does not rewrite.");
    else {
      const present = scope.some((ref) => paragraphsOf(work.get(ref.partName)!).some((p) => containsToken(p.text, edit.replace)));
      if (edit.replace && present) set(id, "already_satisfied", `The new text is already present${edit.slide ? ` on slide ${edit.slide}` : ""}.`);
      else set(id, "blocked", `The text "${edit.find.slice(0, 60)}" was not found${edit.slide ? ` on slide ${edit.slide}` : " in the deck"}.`);
    }
  }

  const out = new Map(files);
  for (const part of touched) {
    const xml = work.get(part)!;
    const ok = wellFormed(xml);
    if (!ok.ok) throw new OoxmlError("corrupt", `An edit produced invalid XML in ${part}: ${ok.reason}`);
    out.set(part, strToU8(xml));
  }
  const removedParts: string[] = [];
  const changedParts = [...touched];
  if (deletes.size) {
    const removedSlides = [...deletes].map((n) => slides[n - 1]!);
    removeSlides(out, slides, removedSlides, removedParts);
    changedParts.push("ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "[Content_Types].xml");
    for (const { id, edit } of edits) if (edit?.op === "delete_slide" && deletes.has(edit.slide)) set(id, "applied", `Removed slide ${edit.slide}. Later slides moved up.`);
  }
  const ordered = edits.map((e) => results.get(e.id)!);
  return { bytes: writePackage(out), results: ordered, changedParts: [...new Set(changedParts)], removedParts, slideCount: { before: slides.length, after: slides.length - deletes.size } };
}

function removeSlides(files: Map<string, Uint8Array>, all: SlideRef[], remove: SlideRef[], removedParts: string[]): void {
  let pres = strFromU8(files.get("ppt/presentation.xml")!);
  let presRels = strFromU8(files.get("ppt/_rels/presentation.xml.rels")!);
  let types = strFromU8(files.get("[Content_Types].xml")!);
  const dropIds = new Set(remove.map((r) => r.sldId));
  for (const ref of remove) {
    pres = pres.replace(new RegExp(`<p:sldId\\b[^>]*\\br:id="${ref.rId}"[^>]*?/>`), "");
    presRels = presRels.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${ref.rId}"[^>]*?/>`), "");
    types = types.replace(new RegExp(`<Override\\b[^>]*PartName="/${ref.partName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*?/>`), "");
  }
  // Section lists (p14:sectionLst) reference slides by numeric id.
  pres = pres.replace(/<p14:sldId\b[^>]*?\bid="(\d+)"[^>]*?\/>/g, (m, id: string) => (dropIds.has(id) ? "" : m));
  for (const [name, xml] of [["ppt/presentation.xml", pres], ["ppt/_rels/presentation.xml.rels", presRels], ["[Content_Types].xml", types]] as const) {
    const ok = wellFormed(xml);
    if (!ok.ok) throw new OoxmlError("corrupt", `Removing a slide produced invalid XML in ${name}: ${ok.reason}`);
    files.set(name, strToU8(xml));
  }
  const survivors = all.filter((s) => !remove.includes(s));
  const referenced = new Set<string>();
  for (const s of survivors) for (const r of parseRels(partText(files, s.relsName))) referenced.add(resolvePart(path.posix.dirname(s.partName), r.target));
  for (const ref of remove) {
    for (const r of parseRels(partText(files, ref.relsName))) {
      const target = resolvePart(path.posix.dirname(ref.partName), r.target);
      // Only slide-private parts go with the slide (its notes page). Layouts, media and charts may be shared.
      if (/\/notesSlide$/.test(r.type) && !referenced.has(target)) { files.delete(target); files.delete(relsNameFor(target)); removedParts.push(target); types = types.replace(new RegExp(`<Override\\b[^>]*PartName="/${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*?/>`), ""); }
    }
    files.delete(ref.partName); files.delete(ref.relsName);
    removedParts.push(ref.partName, ref.relsName);
  }
  files.set("[Content_Types].xml", strToU8(types));
  const app = files.get("docProps/app.xml");
  if (app) files.set("docProps/app.xml", strToU8(strFromU8(app).replace(/<Slides>\d+<\/Slides>/, `<Slides>${survivors.length}</Slides>`)));
}
