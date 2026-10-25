import { type EngineInput, type EngineProgress, type SourceDocument, type WorkPlan, type WorkProduct, type WorkQuestion } from "@afterhours/contracts";
import { abortIfNeeded, EngineError } from "./errors";
import { productIssues, type VerifyContext } from "./grounding";
import { stableId } from "./ids";
import { LiveResponseSchema, systemPrompt } from "./liveSpec";
import { CallBudget, type CallRecord, type ModelClient, type ModelLimits, type ModelResponse } from "./providers/model";

/** Kept as the single instruction text for generation and repair; built from the validating schema in liveSpec.ts. */
export const SYSTEM = systemPrompt();

export type LiveOutcome =
  | { outcome: "ready"; plan: WorkPlan; products: WorkProduct[] }
  | { outcome: "needs_input"; plan: WorkPlan; questions: WorkQuestion[] }
  | { outcome: "skipped"; reason: string };

export interface LiveOptions {
  client: ModelClient;
  limits?: ModelLimits;
  clock?: () => number;
  signal: AbortSignal;
  emit: (progress: EngineProgress) => Promise<void>;
  context: VerifyContext;
  /** Set when a CSV was supplied but could not be calculated; a report then fails with this error. */
  metricsError: EngineError | null;
  deadline: { dueAt: string; explanation: string } | null;
}

/** Model never chooses persistent IDs: products, slides, and blocks get code-derived IDs per slot. */
function withCodeIds(input: EngineInput, products: WorkProduct[]): WorkProduct[] {
  const slots = new Map<string, number>();
  return products.map((product) => {
    const slot = slots.get(product.kind) ?? 0;
    slots.set(product.kind, slot + 1);
    const id = stableId(input.taskId, input.revision, product.kind, slot);
    return {
      ...product, id,
      blocks: product.blocks.map((block, index) => ({ ...block, id: `${id}-b${index + 1}` })),
      slides: product.slides.map((slide, index) => ({ ...slide, id: `${id}-s${index + 1}`, blocks: slide.blocks.map((block, blockIndex) => ({ ...block, id: `${id}-s${index + 1}b${blockIndex + 1}` })) })),
    };
  });
}

function evaluate(input: EngineInput, sources: SourceDocument[], response: ModelResponse, options: LiveOptions): { value: LiveOutcome } | { issues: string[] } {
  if (response.status === "incomplete") return { issues: ["The previous response was cut off at the output-token limit. Return a shorter, complete JSON object."] };
  if (!response.text) return { issues: ["The previous response contained no JSON text."] };
  let parsed: unknown;
  try { parsed = JSON.parse(response.text); } catch { return { issues: ["The previous response was not valid JSON. Return exactly one JSON object with no surrounding text."] }; }
  const validated = LiveResponseSchema.safeParse(parsed);
  if (!validated.success) return { issues: validated.error.issues.slice(0, 12).map((issue) => `Schema: ${issue.path.join(".") || "(root)"} ${issue.message}`) };
  const value = validated.data;
  if (value.outcome === "skipped") return { value: { outcome: "skipped", reason: value.reason } };
  const known = new Set(sources.map((source) => source.id));
  const plan: WorkPlan = {
    ...value.plan,
    // Deadlines are resolved in code from email.receivedAt and the organization timezone, never by the model.
    dueAt: options.deadline?.dueAt ?? null,
    dueAtExplanation: options.deadline?.explanation ?? null,
    sourcesUsed: value.plan.sourcesUsed.filter((id) => known.has(id)),
  };
  if (value.outcome === "needs_input") {
    if (!plan.questions.length) return { issues: ["needs_input requires at least one specific question in plan.questions."] };
    return { value: { outcome: "needs_input", plan, questions: plan.questions } };
  }
  if (value.products.some((product) => product.kind === "report") && options.metricsError) throw options.metricsError;
  if (plan.questions.some((question) => question.required)) return { issues: ["A ready result cannot contain required unanswered questions; return needs_input instead."] };
  const products = withCodeIds(input, value.products);
  const issues = productIssues(plan, sources, products, options.context);
  if (issues.length) return { issues: issues.slice(0, 20).map((issue) => `${issue.code}: ${issue.message}`) };
  return { value: { outcome: "ready", plan, products } };
}

function payload(input: EngineInput, sources: SourceDocument[], context: VerifyContext): string {
  return JSON.stringify({
    now: input.now, receivedAt: input.email.receivedAt,
    email: { from: input.email.from, subject: input.email.subject, attachments: input.email.attachments.map(({ id, filename, mimeType }) => ({ id, filename, mimeType })) },
    organization: input.organization, answers: input.answers, requestedSlides: context.requestedSlides,
    calculatedMetrics: context.metrics,
    calculatedDates: context.allowedDates,
    sources: sources.map(({ id, kind, title, filename, text, extractionStatus, warnings }) => ({ id, kind, title, filename, text, extractionStatus, warnings })),
  });
}

const usageText = (record: CallRecord) => record.usage ? `${record.usage.inputTokens} input / ${record.usage.outputTokens} output tokens` : "usage not reported";

export async function generateLive(input: EngineInput, sources: SourceDocument[], options: LiveOptions): Promise<{ result: LiveOutcome; calls: CallRecord[] }> {
  const budget = new CallBudget(options.client, options.limits, options.clock);
  const limit = options.limits?.maxCallsPerAttempt ?? 3;
  const report = async (purpose: string) => {
    const record = budget.calls.at(-1)!;
    await options.emit({ stage: purpose === "generate" ? "plan" : "verify", message: `Live model call ${budget.calls.length} of ${limit} (${purpose}, ${options.client.model}) finished in ${record.durationMs} ms; ${usageText(record)}.` });
  };
  const request = payload(input, sources, options.context);
  const first = await budget.call("generate", { instructions: SYSTEM, input: request }, options.signal);
  await report("generate");
  let outcome = evaluate(input, sources, first, options);
  if ("issues" in outcome) {
    // Exactly one repair, counted in the same budget and validated by the same checks.
    if (budget.remaining <= 0) throw new EngineError("MODEL_INVALID_OUTPUT", `The live model output failed validation: ${outcome.issues[0]}`, false);
    await options.emit({ stage: "verify", message: `The live model output failed ${outcome.issues.length} validation check(s); requesting one bounded repair.` });
    const repairInput = JSON.stringify({ originalRequest: JSON.parse(request), previousResponse: (first.text ?? "").slice(0, 40_000), validationIssues: outcome.issues });
    const repaired = await budget.call("repair", { instructions: `${SYSTEM}\n\nYour previous response failed validation (see validationIssues in the input). Return the complete corrected JSON object, not a patch, that satisfies the JSON Schema and field rules above and resolves every listed issue without adding unsupported facts.`, input: repairInput }, options.signal);
    await report("repair");
    outcome = evaluate(input, sources, repaired, options);
    if ("issues" in outcome) throw new EngineError("MODEL_INVALID_OUTPUT", `The repaired live model output still failed validation: ${outcome.issues[0]}`, false);
  }
  abortIfNeeded(options.signal);
  return { result: outcome.value, calls: budget.calls };
}
