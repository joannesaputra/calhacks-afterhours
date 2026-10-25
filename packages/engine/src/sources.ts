import type { EngineInput, SourceDocument } from "@afterhours/contracts";
import { abortIfNeeded, EngineError } from "./errors";
import { stableId } from "./ids";
import { extractDocument } from "./ooxml/extract";

const MAX_FILE = 10 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_TEXT = 60_000;

function cleanText(value: string): string {
  return [...value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")]
    .filter((character) => { const code = character.charCodeAt(0); return (code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13; })
    .join("");
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildSources(input: EngineInput, signal: AbortSignal): { sources: SourceDocument[]; warnings: string[] } {
  abortIfNeeded(signal);
  if (input.attachments.length > MAX_FILES) throw new EngineError("INPUT_LIMIT", `At most ${MAX_FILES} attachments are supported.`, false);
  const total = input.attachments.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (total > MAX_TOTAL) throw new EngineError("INPUT_LIMIT", "Attachments exceed the 20 MB aggregate limit.", false);

  const sources: SourceDocument[] = [
    {
      id: stableId(input.taskId, "source", "email"), kind: "email", title: input.email.subject,
      filename: null, mimeType: "text/plain", text: cleanText(input.email.bodyText), extractionStatus: "complete", warnings: [],
    },
    {
      id: stableId(input.taskId, "source", "organization"), kind: "organization", title: input.organization.name,
      filename: null, mimeType: "text/plain", text: cleanText(`${input.organization.description}\n${input.organization.backgroundText}\n${input.organization.policiesText}`), extractionStatus: "complete", warnings: [],
    },
  ];
  const warnings: string[] = [];
  const binaryById = new Map(input.attachments.map((file) => [file.id, file]));
  for (const meta of input.email.attachments) {
    abortIfNeeded(signal);
    const file = binaryById.get(meta.id);
    const sourceBase = { id: stableId(input.taskId, "source", "attachment", meta.id), kind: "attachment" as const, title: meta.filename, filename: meta.filename, mimeType: meta.mimeType };
    if (!file) {
      sources.push({ ...sourceBase, text: "", extractionStatus: "failed", warnings: ["Attachment bytes were not supplied."] });
      continue;
    }
    if (file.bytes.byteLength > MAX_FILE) throw new EngineError("INPUT_LIMIT", `${meta.filename} exceeds the 10 MB file limit.`, false);
    const supported = meta.mimeType.startsWith("text/") || /\.(txt|md|csv)$/i.test(meta.filename);
    if (!supported) {
      // Word and PowerPoint files are read by the same extractor used for revisions; anything else is reported, never guessed at.
      const read = extractDocument({ bytes: file.bytes, filename: meta.filename, mimeType: meta.mimeType, maxBytes: MAX_FILE, maxUnits: 200 });
      if (read.status === "complete" && read.units.length) {
        const text = read.units.map((unit) => `${unit.unitKind === "slide" ? `[Slide ${unit.unit}] ` : ""}${unit.text}`).join("\n\n");
        sources.push({ ...sourceBase, text: cleanText(text), extractionStatus: "complete", warnings: read.detail ? [read.detail] : [] });
        continue;
      }
      const why = read.status === "complete" ? "The file contains no readable text." : read.detail;
      sources.push({ ...sourceBase, text: "", extractionStatus: "unsupported", warnings: [`${meta.filename} could not be read: ${why}`] });
      continue;
    }
    sources.push({ ...sourceBase, text: cleanText(new TextDecoder("utf-8", { fatal: false }).decode(file.bytes)), extractionStatus: "complete", warnings: [] });
  }
  for (const answer of input.answers) {
    sources.push({
      id: stableId(input.taskId, "source", "answer", answer.questionId), kind: "user_answer", title: `Answer: ${answer.questionId}`,
      filename: null, mimeType: "text/plain", text: cleanText(answer.answer), extractionStatus: "complete", warnings: [],
    });
  }

  let used = 0;
  for (const source of sources) {
    const remaining = MAX_TEXT - used;
    if (source.text.length > remaining) {
      source.text = remaining > 0 ? source.text.slice(0, remaining) : "";
      source.warnings.push("Text was truncated to the 60,000-character model-context budget.");
      warnings.push(`${source.title} was truncated.`);
    }
    used += source.text.length;
  }
  return { sources, warnings };
}
