import { EngineInputSchema, EngineResultSchema, type EngineDependencies, type EngineInput, type EngineProgress, type EngineResult, type GeneratedFile, type SourceDocument, type WorkPlan, type WorkProduct, type WorkQuestion } from "@afterhours/contracts";
import { calculateSales, type SalesMetrics } from "./calculations";
import { proposalProducts, reportProducts, reportTitle } from "./content";
import { localDateKey, resolveDeadlines } from "./dates";
import { abortIfNeeded, EngineError } from "./errors";
import { verifyProducts, type VerifyContext } from "./grounding";
import { safeFilename, stableId } from "./ids";
import { generateLive } from "./live";
import { allAmbiguousAnswers, classify, makePlan, requestedSlideCount, unusableAnswers } from "./planning";
import type { ModelClient, ModelLimits } from "./providers/model";
import { liveClientFromEnv } from "./providers/env";
import { renderDocx } from "./render/docx";
import { renderPptx } from "./render/pptx";
import { buildSources } from "./sources";
import { extractProposalFacts } from "./proposalFacts";
import { executeRevision } from "./revision";

/** Internal injection points for tests; production uses the environment-configured provider. */
export interface EngineOptions {
  modelClient?: ModelClient | (() => ModelClient);
  limits?: ModelLimits;
  clock?: () => number;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const missingQuestion = (id: string, question: string, reason: string): WorkQuestion => ({ id, question, reason, required: true });

async function exportProducts(input: EngineInput, products: WorkProduct[], sources: SourceDocument[], signal: AbortSignal): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];
  for (const product of products) {
    abortIfNeeded(signal);
    const title = safeFilename(product.title);
    const format = product.kind === "presentation" ? "pptx" : "docx";
    const bytes = format === "pptx" ? await renderPptx(product, input.organization) : await renderDocx(product, sources, input.organization);
    files.push({ id: stableId(input.taskId, input.revision, product.id, format), productId: product.id, format, filename: `${title}-r${input.revision}.${format}`, mimeType: format === "pptx" ? PPTX_MIME : DOCX_MIME, bytes });
  }
  abortIfNeeded(signal);
  return files;
}

function sourceMetrics(sources: SourceDocument[]): { csv: SourceDocument | null; metrics: SalesMetrics | null; error: EngineError | null } {
  const csv = sources.find((source) => source.kind === "attachment" && source.extractionStatus === "complete" && (source.mimeType === "text/csv" || source.filename?.toLowerCase().endsWith(".csv"))) ?? null;
  if (!csv) return { csv: null, metrics: null, error: null };
  try { return { csv, metrics: calculateSales(csv.text), error: null }; } catch (error) {
    if (error instanceof EngineError) return { csv, metrics: null, error };
    throw error;
  }
}

const INSTRUCTION_LIKE = /\b(ignore (all |the )?(previous|prior|above|system)|api key|password|send (all|every)|email all|reveal|exfiltrat)/i;

export async function execute(inputValue: EngineInput, deps: EngineDependencies, options: EngineOptions = {}): Promise<EngineResult> {
  const parsed = EngineInputSchema.safeParse(inputValue);
  if (!parsed.success) throw new EngineError("INVALID_INPUT", "Engine input failed runtime validation.", false);
  const input = parsed.data;
  const { signal } = deps;
  // Never report progress after cancellation or lost ownership.
  const emit = async (progress: EngineProgress) => { abortIfNeeded(signal); await deps.onProgress(progress); abortIfNeeded(signal); };
  abortIfNeeded(signal);
  // A resolved revision request edits the supplied source deck in place. It needs no model, so it runs before the
  // live-client check and never reports a missing provider key.
  if (input.context) return executeRevision(input, deps);
  // Resolve the live client before any work so missing configuration fails fast and never falls back to fixtures.
  const client = input.mode === "live" ? (typeof options.modelClient === "function" ? options.modelClient() : options.modelClient ?? liveClientFromEnv()) : null;
  await emit({ stage: "extract", message: "Normalizing email, organization context, answers, and attachments." });
  const { sources, warnings } = buildSources(input, signal);
  for (const source of sources) if (source.kind !== "organization" && INSTRUCTION_LIKE.test(source.text)) warnings.push(`${source.title} contains instruction-like text; it was treated as data and did not change engine policy.`);
  const deadlines = resolveDeadlines(input.email.bodyText, input.email.receivedAt, input.organization.timezone);
  const requestedSlides = requestedSlideCount(`${input.email.subject}\n${input.email.bodyText}`);
  const { metrics, error: metricsError } = sourceMetrics(sources);
  const context = (dueAt: string | null, derivedDates: string[] = []): VerifyContext => ({ metrics, requestedSlides, organizationCurrency: input.organization.currency, allowedDates: [...(dueAt ? [localDateKey(dueAt, input.organization.timezone)] : []), ...derivedDates] });
  let derivedDates: string[] = [];

  let plan: WorkPlan;
  let products: WorkProduct[];
  let verifyContext: VerifyContext;
  if (client) {
    await emit({ stage: "plan", message: `Requesting a bounded structured plan from the configured live model (${client.model}).` });
    // Engagement dates are calculated in code (pure, no model call); the model may restate them but not invent others.
    derivedDates = extractProposalFacts(input, sources).derivedDates;
    const { result: live } = await generateLive(input, sources, { client, limits: options.limits, clock: options.clock, signal, emit, context: context(deadlines[0]?.dueAt ?? null, derivedDates), metricsError, deadline: deadlines.length === 1 ? deadlines[0]! : null });
    if (live.outcome === "skipped") return { outcome: "skipped", reason: live.reason, sources };
    plan = live.plan;
    await emit({ stage: "plan", message: "Validated the live model plan.", plan });
    if (live.outcome === "needs_input") return { outcome: "needs_input", plan, sources, questions: live.questions, warnings };
    products = live.products;
    verifyContext = context(plan.dueAt, derivedDates);
  } else {
    const classification = classify(input);
    plan = makePlan(input, sources, classification);
    await emit({ stage: "plan", message: "Created a deterministic fixture plan.", plan });
    if (classification === "no_action") return { outcome: "skipped", reason: "The message is informational and contains no delegated assignment.", sources };
    if (classification === "unsupported") return { outcome: "skipped", reason: "The request is outside the supported proposal, report, and presentation scope.", sources };
    if (classification === "ambiguous" && !allAmbiguousAnswers(input)) return { outcome: "needs_input", plan, sources, questions: plan.questions, warnings };
    if (classification === "ambiguous") {
      const again = unusableAnswers(input);
      if (again.length) { plan.questions = again; return { outcome: "needs_input", plan, sources, questions: again, warnings }; }
      plan = makePlan(input, sources, "proposal");
      plan.title = `${input.answers.find((answer) => answer.questionId === "client_identity")!.answer.trim()} proposal and deck`;
      plan.questions = [];
      products = proposalProducts(input, sources, plan, true);
    } else if (classification === "proposal") {
      const needed = sources.find((source) => source.kind === "attachment" && source.extractionStatus !== "complete");
      if (needed) {
        const question = missingQuestion("usable_project_brief", `Please provide a supported text or Markdown version of ${needed.filename ?? needed.title}.`, "The requested proposal depends on an attachment that could not be read.");
        plan.questions = [question];
        return { outcome: "needs_input", plan, sources, questions: [question], warnings: [...warnings, ...needed.warnings] };
      }
      const facts = extractProposalFacts(input, sources);
      warnings.push(...facts.warnings);
      if (facts.questions.length) {
        plan.questions = facts.questions;
        return { outcome: "needs_input", plan, sources, questions: facts.questions, warnings };
      }
      plan.title = `${facts.client} proposal and kickoff deck`;
      derivedDates = facts.derivedDates;
      products = proposalProducts(input, sources, plan, false, facts);
    } else {
      if (metricsError) throw metricsError;
      if (!metrics) {
        const question = missingQuestion("usable_sales_csv", "Please provide the requested sales dataset as a supported CSV.", "The report calculations require a readable CSV.");
        plan.questions = [question];
        return { outcome: "needs_input", plan, sources, questions: [question], warnings };
      }
      plan.title = `${reportTitle(metrics)} sales performance update`;
      products = reportProducts(input, sources, plan, metrics);
    }
    verifyContext = context(plan.dueAt, derivedDates);
  }
  await emit({ stage: "generate", message: "Generated structured content used by both previews and files." });
  verifyProducts(plan, sources, products, verifyContext);
  await emit({ stage: "verify", message: "Verified requested outputs, evidence, quotes, amounts, dates, calculated numbers, and slide layout budgets." });
  const files = await exportProducts(input, products, sources, signal);
  await emit({ stage: "export", message: `Exported ${files.length} Office files in memory.` });
  const result = { outcome: "ready" as const, plan, sources, products, files, warnings };
  if (!EngineResultSchema.safeParse(result).success) throw new EngineError("INVALID_OUTPUT", "Final engine result failed runtime validation.", false);
  abortIfNeeded(signal);
  return result;
}
