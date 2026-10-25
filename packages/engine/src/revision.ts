// Revision path: edit the resolved source deck in place from documented requirements. No model call, no rebuild.
import { createHash } from "node:crypto";
import path from "node:path";
import {
  assertBundleReferences, ContextBundleError, EngineResultSchema,
  type ContextBundle, type EngineDependencies, type EngineInput, type EngineProgress, type EngineResult, type RevisionReport,
  type SourceDocument, type WorkPlan, type WorkProduct, type WorkQuestion,
} from "@afterhours/contracts";
import { abortIfNeeded, EngineError } from "./errors";
import { stableId } from "./ids";
import { applyDeckEdits, listSlides, readDeckText } from "./ooxml/deck";
import { OoxmlError, readPackage } from "./ooxml/zip";
import { wellFormed } from "./ooxml/xml";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const quote = (s: string) => `"${s.length > 80 ? `${s.slice(0, 77)}...` : s}"`;

function describeEdit(r: ContextBundle["requirements"][number]): string {
  const e = r.edit;
  if (!e) return r.text;
  if (e.op === "replace_text") return `${e.slide ? `Slide ${e.slide}: ` : ""}replace ${quote(e.find)} with ${quote(e.replace)}`;
  if (e.op === "append_bullet") return `Slide ${e.slide}: add the bullet ${quote(e.text)}`;
  return `Remove slide ${e.slide}`;
}

/** Everything that must still be true of the output package before it is allowed to be called a revision. */
function verifyOutput(original: Uint8Array, output: Uint8Array, outcome: ReturnType<typeof applyDeckEdits>, bundle: ContextBundle): void {
  const fail = (m: string) => { throw new EngineError("REVISION_VERIFY_FAILED", m, false); };
  const before = readPackage(original);
  const after = readPackage(output);
  for (const [name, bytes] of after) {
    if (/\.(xml|rels)$/.test(name)) {
      const ok = wellFormed(new TextDecoder().decode(bytes));
      if (!ok.ok) fail(`The revised deck has invalid XML in ${name}: ${ok.reason}.`);
    }
  }
  const slides = listSlides(after);
  if (slides.length !== outcome.slideCount.after) fail("The revised deck has an unexpected number of slides.");
  const touched = new Set(outcome.changedParts);
  for (const [name, bytes] of before) {
    if (touched.has(name) || outcome.removedParts.includes(name)) continue;
    const kept = after.get(name);
    if (!kept) { fail(`An untouched part of the original deck is missing from the revision: ${name}.`); continue; }
    if (kept.length !== bytes.length || sha256(kept) !== sha256(bytes)) fail(`An untouched part of the original deck changed: ${name}.`);
  }
  const text = readDeckText(after).map((s) => `${s.title}\n${s.paragraphs.join("\n")}`).join("\n").replace(/\u00a0/g, " ");
  bundle.requirements.forEach((r, i) => {
    const res = outcome.results[i]!;
    if (res.status !== "applied" || r.edit?.op !== "replace_text" || !r.edit.replace) return;
    if (!text.includes(r.edit.replace.replace(/\u00a0/g, " "))) fail(`The revised deck does not contain the requested text for "${r.id}".`);
  });
}

export async function executeRevision(input: EngineInput, deps: EngineDependencies): Promise<EngineResult> {
  const { signal } = deps;
  const emit = async (p: EngineProgress) => { abortIfNeeded(signal); await deps.onProgress(p); abortIfNeeded(signal); };
  const bundle = input.context;
  if (!bundle) throw new EngineError("INVALID_INPUT", "No context bundle was supplied.", false);
  try { assertBundleReferences(bundle); } catch (e) {
    if (e instanceof ContextBundleError) throw new EngineError("CONTEXT_BUNDLE_INVALID", e.message, false);
    throw e;
  }
  const target = bundle.resolvedTarget;
  const file = input.contextFiles?.find((f) => f.versionId === target.versionId);
  if (!file) throw new EngineError("CONTEXT_SOURCE_MISSING", "The resolved source file was not supplied to the engine.", false);
  if (sha256(file.bytes) !== target.sha256) throw new EngineError("CONTEXT_SOURCE_MISMATCH", "The source file does not match the version that was selected.", false);
  if (!/\.pptx$/i.test(target.filename) && target.mimeType !== PPTX_MIME) {
    throw new EngineError("UNSUPPORTED_SOURCE_FORMAT", "Only .pptx source files can be revised in place.", false);
  }
  await emit({ stage: "extract", message: `Reading the source deck ${target.filename} (version ${target.versionKey.slice(0, 12)}).` });

  await emit({ stage: "generate", message: `Applying ${bundle.requirements.length} requested change${bundle.requirements.length === 1 ? "" : "s"} to a copy of the original deck.` });
  let outcome: ReturnType<typeof applyDeckEdits>;
  try {
    outcome = applyDeckEdits(file.bytes, bundle.requirements.map((r) => ({ id: r.id, edit: r.edit })));
  } catch (e) {
    if (e instanceof OoxmlError) throw new EngineError(e.kind === "encrypted" ? "SOURCE_ENCRYPTED" : "SOURCE_UNREADABLE", e.message, false);
    throw e;
  }
  const pairs = bundle.requirements.map((req, i) => ({ req, res: outcome.results[i]! }));
  const usable = pairs.filter((p) => p.res.status === "applied" || p.res.status === "already_satisfied");
  const unusable = pairs.filter((p) => !usable.includes(p));
  const sources: SourceDocument[] = bundle.sources.map((s) => ({
    id: s.id, kind: s.kind === "email_excerpt" ? "email" : s.kind === "user_note" ? "user_answer" : "attachment", title: s.title, filename: null, mimeType: "text/plain",
    text: s.text, extractionStatus: "complete", warnings: [],
  }));
  const baseText = readDeckText(readPackage(file.bytes));
  const deckSourceId = `deck-${target.versionId}`;
  sources.push({
    id: deckSourceId, kind: "attachment", title: target.filename, filename: target.filename, mimeType: PPTX_MIME,
    text: baseText.map((s) => `Slide ${s.number}: ${[s.title, ...s.paragraphs].filter(Boolean).join(" | ")}`).join("\n"),
    extractionStatus: "complete", warnings: [],
  });
  const plan: WorkPlan = {
    title: `Revision of ${path.basename(target.filename, path.extname(target.filename))}`,
    requestSummary: `Revise ${target.filename} using ${bundle.requirements.length} documented change${bundle.requirements.length === 1 ? "" : "s"}.`,
    requestedOutputs: ["presentation"], dueAt: null, dueAtExplanation: null,
    steps: bundle.requirements.map(describeEdit),
    assumptions: bundle.uncertainties.filter((u) => u.kind === "assumption").map((u) => u.text),
    questions: [], sourcesUsed: sources.map((s) => s.id),
  };
  await emit({ stage: "plan", message: `Applying ${bundle.requirements.length} requested change${bundle.requirements.length === 1 ? "" : "s"} to the original deck.`, plan });

  if (usable.length === 0) {
    const detail = unusable.map((p) => `${describeEdit(p.req)} (${p.res.detail})`).slice(0, 5).join(" ");
    const question: WorkQuestion = {
      id: "context_changes_unusable",
      question: "None of the documented changes could be applied to the deck automatically. Which exact edits should I make (slide number, the current text and the new text)?",
      reason: detail, required: true,
    };
    plan.questions = [question];
    return { outcome: "needs_input", plan, sources, questions: [question], warnings: [] };
  }

  verifyOutput(file.bytes, outcome.bytes, outcome, bundle);
  await emit({ stage: "verify", message: `Verified the revised deck: ${outcome.slideCount.after} slides, untouched parts identical to the original.` });

  const after = readDeckText(readPackage(outcome.bytes));
  const beforePkg = readPackage(file.bytes);
  const afterPkg = readPackage(outcome.bytes);
  const slideRefsBefore = listSlides(beforePkg);
  const slideRefsAfter = new Set(listSlides(afterPkg).map((s) => s.partName));
  let unchanged = 0; let changed = 0; let removed = 0;
  for (const ref of slideRefsBefore) {
    if (!slideRefsAfter.has(ref.partName)) { removed += 1; continue; }
    const a = beforePkg.get(ref.partName)!; const b = afterPkg.get(ref.partName)!;
    if (a.length === b.length && sha256(a) === sha256(b)) unchanged += 1; else changed += 1;
  }
  const supportFor = new Map(bundle.requirements.map((r) => [r.id, r.support.map((s) => s.sourceId)]));
  const changedSlides = new Set<number>();
  bundle.requirements.forEach((r, i) => {
    const res = outcome.results[i]!;
    if (res.status === "applied" && r.edit && r.edit.op !== "delete_slide" && r.edit.slide) changedSlides.add(r.edit.slide);
  });
  // Output slides keep the original numbering minus removed slides; map back for evidence.
  const survivingOriginals = slideRefsBefore.filter((s) => slideRefsAfter.has(s.partName)).map((s) => s.number);
  const evidenceBySlide = (original: number) => {
    const ids = new Set<string>([deckSourceId]);
    bundle.requirements.forEach((r, i) => {
      if (outcome.results[i]!.status === "applied" && r.edit && r.edit.op !== "delete_slide" && r.edit.slide === original) for (const s of supportFor.get(r.id) ?? []) ids.add(s);
    });
    return [...ids];
  };
  const productId = stableId(input.taskId, input.revision, "presentation", 0);
  const product: WorkProduct = {
    id: productId, kind: "presentation", title: plan.title, subtitle: `Revised from ${target.filename}`,
    blocks: [],
    slides: after.map((s, index) => {
      const original = survivingOriginals[index] ?? index + 1;
      const sid = `${productId}-s${index + 1}`;
      return {
        id: sid, title: s.title || `Slide ${index + 1}`, layout: "bullets" as const, speakerNotes: s.notes,
        blocks: [{
          id: `${sid}b1`, kind: "bullets" as const, heading: null, text: null, items: s.paragraphs, columns: [], rows: [], chart: null,
          evidence: evidenceBySlide(original).map((sourceId) => ({ sourceId, locator: `slide ${original}`, quote: null })),
          basis: "source" as const,
        }],
      };
    }),
    assumptions: plan.assumptions,
    warnings: unusable.map((p) => `Not applied: ${describeEdit(p.req)} (${p.res.status}: ${p.res.detail})`),
  };
  const stem = path.basename(target.filename, path.extname(target.filename)).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "deck";
  const filename = `${stem}-revised-r${input.revision}.pptx`;
  const summary = bundle.requirements.map((r, i) => `${outcome.results[i]!.status === "applied" ? "Applied" : outcome.results[i]!.status === "already_satisfied" ? "Already in the deck" : outcome.results[i]!.status === "blocked" ? "Blocked" : "Not supported"}: ${describeEdit(r)}. ${outcome.results[i]!.detail}`);
  const report: RevisionReport = {
    baseVersionId: target.versionId, baseSha256: target.sha256, baseFilename: target.filename, outputFilename: filename, fidelity: "in_place_edit",
    edits: bundle.requirements.map((r, i) => ({ requirementId: r.id, status: outcome.results[i]!.status, detail: outcome.results[i]!.detail })),
    slides: { unchanged, changed, removed, total: outcome.slideCount.after },
    unrelatedContentPreserved: true, summary,
    assumptions: [...plan.assumptions, "Slide numbers in the requests refer to the deck as it was sent, before any removal."],
  };
  const files = [{ id: stableId(input.taskId, input.revision, productId, "pptx"), productId, format: "pptx" as const, filename, mimeType: PPTX_MIME, bytes: outcome.bytes }];
  await emit({ stage: "export", message: `Exported the revised deck (${filename}) from the original package; the source file was not modified.` });
  const warnings = [
    ...bundle.uncertainties.filter((u) => u.kind === "assumption").map((u) => u.text),
    ...(unusable.length ? [`${unusable.length} requested change${unusable.length === 1 ? " was" : "s were"} not applied. See the change summary.`] : []),
  ];
  const result = { outcome: "ready" as const, plan, sources, products: [product], files, warnings, revisionReport: report };
  if (!EngineResultSchema.safeParse(result).success) throw new EngineError("INVALID_OUTPUT", "Final engine result failed runtime validation.", false);
  return result;
}
