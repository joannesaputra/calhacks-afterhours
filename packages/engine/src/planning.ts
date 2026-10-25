import type { EngineInput, OutputKind, SourceDocument, WorkPlan, WorkQuestion } from "@afterhours/contracts";
import { resolveDeadline } from "./dates";

const AMBIGUOUS_QUESTIONS: WorkQuestion[] = [
  { id: "client_identity", question: "Which client is this proposal for?", reason: "The client identity is needed to tailor and label the deliverables.", required: true },
  { id: "project_scope", question: "What work and deliverables should the proposal cover?", reason: "Scope cannot be inferred safely.", required: true },
  { id: "authorized_fee", question: "What fee is authorized for this proposal?", reason: "Pricing is a material commitment and cannot be invented.", required: true },
  { id: "project_schedule", question: "What start date or project schedule is authorized?", reason: "The requested schedule is unknown.", required: true },
];

export type Classification = "proposal" | "report" | "ambiguous" | "no_action" | "unsupported";

export function classify(input: EngineInput): Classification {
  // Revision scenarios are resolved before the engine runs (input.context). Reaching here without a context means the
  // request could not be treated as a revision, which this classifier does not handle.
  if (input.fixtureScenario) return input.fixtureScenario === "revision" || input.fixtureScenario === "revision_choice" ? "unsupported" : input.fixtureScenario;
  const text = `${input.email.subject}\n${input.email.bodyText}`.toLowerCase();
  if (/\b(no action|fyi only|newsletter)\b/.test(text)) return "no_action";
  const imperative = /\b(please|prepare|create|draft|make|need|request)\b/.test(text);
  if (!imperative) return "no_action";
  if (/\b(report|sales|performance|month-over-month)\b/.test(text)) return "report";
  if (/\b(proposal|kickoff deck)\b/.test(text)) return input.email.attachments.length || input.answers.length ? "proposal" : "ambiguous";
  return "unsupported";
}

export function makePlan(input: EngineInput, sources: SourceDocument[], classification: Classification): WorkPlan {
  const answered = new Set(input.answers.filter((answer) => answer.answer.trim()).map((answer) => answer.questionId));
  const questions = classification === "ambiguous" ? AMBIGUOUS_QUESTIONS.filter((question) => !answered.has(question.id)) : [];
  const requestedOutputs: OutputKind[] = classification === "report" ? ["report", "presentation"] : classification === "proposal" || classification === "ambiguous" ? ["proposal", "presentation"] : [];
  const deadline = classification === "proposal" ? resolveDeadline(input.email.bodyText, input.email.receivedAt, input.organization.timezone) : null;
  const client = input.email.subject.match(/\bfor\s+(.+?)\s*$/i)?.[1] ?? "Client";
  const subject = input.email.subject.trim() || "(no subject)";
  const titles: Record<Classification, [string, string]> = {
    proposal: [`${client} proposal and kickoff deck`, "Prepare a review-draft proposal and kickoff deck from the email, its attachments, and the company profile."],
    report: ["Sales performance report and deck", "Prepare a short sales report and presentation using only the attached CSV; numbers are calculated in code."],
    ambiguous: ["Proposal and deck (details needed)", "Prepare a client proposal and short presentation after the material details are supplied."],
    no_action: [`No action: ${subject}`.slice(0, 120), "Informational message with no delegated assignment; no files will be prepared."],
    unsupported: [`Unsupported request: ${subject}`.slice(0, 120), "The request is outside supported proposal, report, and presentation work; no files will be prepared."],
  };
  const prepares = classification === "proposal" || classification === "report" || classification === "ambiguous";
  return {
    title: titles[classification][0],
    requestSummary: titles[classification][1],
    requestedOutputs, dueAt: deadline?.dueAt ?? null,
    dueAtExplanation: deadline?.explanation ?? null,
    steps: prepares ? ["Extract and normalize authorized sources", "Resolve material unknowns", "Generate grounded structured content", "Verify evidence and calculations", "Export matching Office files"] : ["Read the message", "Confirm whether supported work is requested"],
    assumptions: classification === "report" ? ["USD amounts are reported exactly as supplied; causal explanations are out of scope."] : prepares ? ["Any audience segments are working hypotheses, not established demographic facts.", "The deliverables are review drafts and have not been sent or accepted."] : [],
    questions,
    sourcesUsed: sources.filter((source) => source.extractionStatus === "complete").map((source) => source.id),
  };
}

export function allAmbiguousAnswers(input: EngineInput): boolean {
  const values = new Map(input.answers.map((answer) => [answer.questionId, answer.answer.trim()]));
  return AMBIGUOUS_QUESTIONS.every((question) => values.get(question.id));
}

const SLIDE_WORDS: Record<string, number> = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/** Slide count stated in the request ("five-slide", "5 slides"), or null when unstated. */
export function requestedSlideCount(text: string): number | null {
  const match = text.match(/\b(three|four|five|six|seven|eight|nine|ten|\d{1,2})[ -]slides?\b/i);
  if (!match) return null;
  return SLIDE_WORDS[match[1]!.toLowerCase()] ?? Number(match[1]);
}

const MONEY_ANSWER = /(?:\b(?:USD|EUR|GBP|CAD|AUD)\s?|[$€£])\s?\d/i;
const ANSWER_LIMITS: Record<string, number> = { client_identity: 80, project_scope: 600, authorized_fee: 80, project_schedule: 160 };
/**
 * Answers are untrusted data. Ones that cannot be used safely (too long for titles, or a fee
 * without an amount and currency) are asked again with a specific reason instead of guessed.
 */
export function unusableAnswers(input: EngineInput): WorkQuestion[] {
  const values = new Map(input.answers.map((answer) => [answer.questionId, answer.answer.trim()]));
  const again: WorkQuestion[] = [];
  for (const question of AMBIGUOUS_QUESTIONS) {
    const value = values.get(question.id) ?? "";
    const limit = ANSWER_LIMITS[question.id]!;
    if (value.length > limit) again.push({ ...question, reason: `The previous answer was ${value.length} characters; please answer in at most ${limit}.` });
    else if (question.id === "authorized_fee" && !MONEY_ANSWER.test(value)) again.push({ ...question, reason: "The previous answer did not state an amount with a currency, such as USD 6,000." });
  }
  return again;
}
