// Text extraction with typed failure states. One parser version string covers every format here: bump it when the
// extraction output changes so parse caches keyed by (file version, parser version) refresh themselves.
import path from "node:path";
import { strFromU8 } from "fflate";
import { readDeckText } from "./deck";
import { OoxmlError, isCompoundFile, readPackage, text as partText } from "./zip";
import { decodeXml } from "./xml";

export const PARSER_VERSION = "ooxml-1";

export interface ExtractedUnit { unit: number | null; unitKind: "slide" | "page" | "section" | null; locator: string; section: string | null; text: string }
export type ExtractOutcome =
  | { status: "complete"; units: ExtractedUnit[]; parserVersion: string; truncated: boolean; detail: string | null }
  | { status: "unsupported" | "encrypted" | "oversized" | "failed"; detail: string; parserVersion: string };

export interface ExtractInput { bytes: Uint8Array; filename: string; mimeType: string; maxBytes: number; maxUnits: number }

const ext = (name: string) => path.extname(name).toLowerCase();
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function docxUnits(files: Map<string, Uint8Array>): ExtractedUnit[] {
  const xml = partText(files, "word/document.xml");
  if (!xml) throw new OoxmlError("corrupt", "The package has no word/document.xml.");
  const units: ExtractedUnit[] = [];
  let section: string | null = null;
  let current: string[] = [];
  const flush = () => { if (current.length) { units.push({ unit: units.length + 1, unitKind: "section", locator: `section ${units.length + 1}${section ? `: ${section}` : ""}`, section, text: current.join("\n") }); current = []; } };
  for (const m of xml.matchAll(/<w:p(?=[\s>])[\s\S]*?<\/w:p>/g)) {
    const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(m[0])?.[1] ?? "";
    const line = [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)].map((t) => (t[1] !== undefined ? decodeXml(t[1]) : " ")).join("").trim();
    if (!line) continue;
    if (/^Heading\d|^Title$/i.test(style)) { flush(); section = line; current.push(line); } else current.push(line);
  }
  flush();
  return units;
}

function plainUnits(textValue: string): ExtractedUnit[] {
  const blocks = textValue.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const units: ExtractedUnit[] = [];
  let buf = "";
  for (const block of blocks) {
    if (buf && buf.length + block.length > 2_000) { units.push({ unit: units.length + 1, unitKind: "section", locator: `section ${units.length + 1}`, section: null, text: buf }); buf = ""; }
    buf = buf ? `${buf}\n\n${block}` : block;
  }
  if (buf) units.push({ unit: units.length + 1, unitKind: "section", locator: `section ${units.length + 1}`, section: null, text: buf });
  return units;
}

/** Extract text units from a file the platform may have to read. Never throws: failures are typed outcomes. */
export function extractDocument(input: ExtractInput): ExtractOutcome {
  const { bytes, filename, mimeType, maxBytes, maxUnits } = input;
  const done = (units: ExtractedUnit[]): ExtractOutcome => {
    const truncated = units.length > maxUnits;
    return { status: "complete", units: units.slice(0, maxUnits), parserVersion: PARSER_VERSION, truncated, detail: truncated ? `Only the first ${maxUnits} of ${units.length} sections were read (budget).` : null };
  };
  if (bytes.byteLength > maxBytes) return { status: "oversized", detail: `The file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`, parserVersion: PARSER_VERSION };
  const e = ext(filename);
  try {
    if (e === ".pptx" || mimeType === PPTX_MIME) {
      return done(readDeckText(readPackage(bytes)).map((s) => ({
        unit: s.number, unitKind: "slide" as const, locator: `slide ${s.number}`, section: s.title || null,
        text: [s.title, ...s.paragraphs, ...(s.notes ? [`Notes: ${s.notes}`] : [])].filter(Boolean).join("\n"),
      })));
    }
    if (e === ".docx" || mimeType === DOCX_MIME) return done(docxUnits(readPackage(bytes)));
    if (e === ".ppt" || e === ".doc" || e === ".xls") {
      return { status: isCompoundFile(bytes) ? "unsupported" : "failed", detail: "Legacy binary Office formats are not supported. Save the file as .pptx or .docx.", parserVersion: PARSER_VERSION };
    }
    if (e === ".pdf" || mimeType === "application/pdf") return { status: "unsupported", detail: "PDF text extraction is not supported in this release. Attach a .pptx or .docx version.", parserVersion: PARSER_VERSION };
    if (mimeType.startsWith("text/") || [".txt", ".md", ".csv"].includes(e)) return done(plainUnits(strFromU8(bytes)));
    return { status: "unsupported", detail: `${mimeType || e || "This file type"} cannot be read in this release.`, parserVersion: PARSER_VERSION };
  } catch (error) {
    if (error instanceof OoxmlError) {
      return { status: error.kind === "corrupt" ? "failed" : error.kind, detail: error.message, parserVersion: PARSER_VERSION };
    }
    return { status: "failed", detail: "The file could not be parsed.", parserVersion: PARSER_VERSION };
  }
}
