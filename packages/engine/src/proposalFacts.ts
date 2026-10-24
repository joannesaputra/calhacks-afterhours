import type { EngineInput, SourceDocument, SourceRef, WorkQuestion } from "@afterhours/contracts";
import { inferYear, resolveDeadlines } from "./dates";
import { moneyKeys } from "./grounding";

export interface ProposalFacts {
  client: string;
  fee: string;
  durationWeeks: number | null;
  startDate: string | null;
  /** Inclusive end of the engagement, calculated in code from start + duration; null when either is unknown. */
  endDate: string | null;
  /** Calendar keys ("november 22") of dates calculated here, allowed in content checks. */
  derivedDates: string[];
  schedule: string;
  scopeItems: string[];
  objectives: string[];
  exclusions: string[];
  constraints: string | null;
  unknowns: string[];
  questions: WorkQuestion[];
  warnings: string[];
  evidence: { client: SourceRef[]; fee: SourceRef[]; schedule: SourceRef[]; scope: SourceRef[]; objectives: SourceRef[]; exclusions: SourceRef[]; constraints: SourceRef[] };
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const wordsToWeeks: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const MAX_CLIENT = 80;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((item) => item.trim()).filter(Boolean);
}

/** Exact source substring of at most 300 characters (a word-boundary prefix of longer sentences). */
function exactQuote(sentence: string): string {
  if (sentence.length <= 300) return sentence;
  const cut = sentence.slice(0, 300);
  return cut.slice(0, cut.lastIndexOf(" ")).trimEnd();
}

/** First sentence matching `pattern`, returned as an exact source quote. */
function quote(source: SourceDocument | undefined, pattern: RegExp): SourceRef | null {
  if (!source) return null;
  const sentence = sentences(source.text).find((item) => pattern.test(item));
  return sentence ? { sourceId: source.id, locator: null, quote: exactQuote(sentence) } : null;
}

/**
 * "a, b and c, and d" -> ["A", "B and c", "D"]. Commas separate items; "and" splits only a
 * comma-free pair, so compound items such as "audience and message strategy" stay whole.
 */
export function listItems(text: string): string[] {
  const body = text.trim().replace(/\.$/, "");
  const parts = body.includes(",") ? body.split(/,\s*(?:and\s+|or\s+)?/) : body.split(/\s+and\s+/);
  return parts.map((item) => item.trim()).filter(Boolean).map((item) => item[0]!.toUpperCase() + item.slice(1));
}

function listAfter(source: SourceDocument | undefined, lead: RegExp): { items: string[]; ref: SourceRef } | null {
  if (!source) return null;
  for (const sentence of sentences(source.text)) {
    const match = sentence.match(lead);
    if (match?.[1]) return { items: listItems(match[1].split(/[;]/)[0]!), ref: { sourceId: source.id, locator: null, quote: exactQuote(sentence) } };
  }
  return null;
}

const refs = (...values: Array<SourceRef | null>) => values.filter((value): value is SourceRef => value !== null);
const showMoney = (key: string) => `${key.split(":")[0]} ${Number(key.split(":")[1]).toLocaleString("en-US")}`;
const question = (id: string, text: string, reason: string): WorkQuestion => ({ id, question: text, reason, required: true });

export function extractProposalFacts(input: EngineInput, sources: SourceDocument[]): ProposalFacts {
  const tz = input.organization.timezone;
  const email = sources.find((source) => source.kind === "email");
  const org = sources.find((source) => source.kind === "organization");
  const briefs = sources.filter((source) => source.kind === "attachment" && source.extractionStatus === "complete");
  const brief = briefs[0];
  const questions: WorkQuestion[] = [];
  const warnings: string[] = [];
  const unknowns: string[] = [];

  const subjectClient = input.email.subject.match(/\bfor\s+(.+?)\s*$/i)?.[1] ?? "";
  const briefClients = briefs.flatMap((source) => [...source.text.matchAll(/^#\s+(.+?)\s+project brief\s*$/gim)].map((match) => match[1]!));
  const clients = unique([subjectClient, ...briefClients]);
  if (clients.length !== 1) questions.push(question("proposal_client_conflict", "Which client name should the proposal use?", `The supplied sources contain ${clients.length ? `conflicting names: ${clients.join(", ")}` : "no client name"}.`));
  else if (clients[0]!.length > MAX_CLIENT) questions.push(question("proposal_client_length", `What short client name (at most ${MAX_CLIENT} characters) should appear on the documents?`, "The stated client name is too long to use as a document and slide title."));

  const feeSources = [...briefs, ...(org ? [org] : [])];
  const fees = unique(feeSources.flatMap((source) => moneyKeys(source.text, input.organization.currency)));
  const currencies = unique(fees.map((key) => key.split(":")[0]!));
  if (fees.length !== 1) questions.push(question("proposal_fee_conflict", "What fee is authorized for this proposal?", `The supplied brief and company profile contain ${fees.length ? `${currencies.length > 1 ? "amounts in different currencies" : "conflicting fees"}: ${fees.map(showMoney).join(", ")}` : "no authorized fee"}.`));
  const feeKey = fees.length === 1 ? fees[0]! : null;
  const fee = feeKey ? showMoney(feeKey) : "Fee to be confirmed";
  if (feeKey && feeKey.split(":")[0] !== input.organization.currency) warnings.push(`The authorized fee is stated in ${feeKey.split(":")[0]}, not the organization currency ${input.organization.currency}; it is shown as stated and not converted.`);
  const money = /(?:\b(?:USD|EUR|GBP|CAD|AUD)\s?|[$€£])\s?\d/i;

  const weekPattern = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)[ -]weeks?\b/gi;
  const durationSources = sources.filter((source) => source.kind !== "organization");
  const weeks = [...new Set(durationSources.flatMap((source) => [...source.text.matchAll(weekPattern)]
    .filter((match) => !/calendar|content/i.test(source.text.slice(match.index! + match[0].length, match.index! + match[0].length + 20)))
    .map((match) => wordsToWeeks[match[1]!.toLowerCase()] ?? Number(match[1]))))];
  if (weeks.length !== 1) questions.push(question("proposal_schedule_conflict", "How many weeks should the engagement run?", `The supplied sources contain ${weeks.length ? `conflicting durations: ${weeks.join(", ")} weeks` : "no engagement duration"}.`));
  const durationWeeks = weeks.length === 1 ? weeks[0]! : null;

  const startPattern = new RegExp(`\\bstart(?:s|ing)?(?:\\s+on)?\\s+(${MONTHS.join("|")})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?`, "gi");
  const starts = unique(sources.filter((source) => source.kind === "email" || source.kind === "attachment").flatMap((source) => [...source.text.matchAll(startPattern)].map((match) => {
    const month = MONTHS.indexOf(match[1]!.toLowerCase()) + 1;
    const day = Number(match[2]);
    const year = match[3] ? Number(match[3]) : inferYear(month, day, input.email.receivedAt, tz);
    return `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1).toLowerCase()} ${day}, ${year}`;
  })));
  if (starts.length > 1) questions.push(question("proposal_start_conflict", "Which engagement start date is authorized?", `The supplied sources contain conflicting start dates: ${starts.join(", ")}.`));
  const startDate = starts.length === 1 ? starts[0]! : null;
  // A week-based engagement starting on day S ends on S + 7N - 1 (inclusive), computed on the civil calendar.
  const startParts = startDate ? /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(startDate) : null;
  const end = startParts && durationWeeks ? new Date(Date.UTC(Number(startParts[3]), MONTHS.indexOf(startParts[1]!.toLowerCase()), Number(startParts[2]) + durationWeeks * 7 - 1)) : null;
  const endDate = end ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(end) : null;
  if (!startDate) unknowns.push("The engagement start date is not stated and must be confirmed.");

  const deadlines = [...new Set(resolveDeadlines(input.email.bodyText, input.email.receivedAt, tz).map((item) => item.dueAt))];
  if (deadlines.length > 1) questions.push(question("proposal_deadline_conflict", "Which draft deadline applies?", `The email states ${deadlines.length} different draft deadlines.`));
  if (deadlines.length === 1 && Date.parse(deadlines[0]!) < Date.parse(input.email.receivedAt)) questions.push(question("proposal_deadline_past", "The stated draft deadline is earlier than when the email was received. What deadline should be used?", "A deadline in the past cannot be met and may be a typo."));

  // A brief that itemizes deliverables wins; the company's standard package applies only when a source invokes it.
  const usesPackage = [brief, email].some((source) => source && /standard package/i.test(source.text));
  const briefList = listAfter(brief, /\bdeliverables(?::|\s+are|\s+include)\s+(.+)$/i);
  const scopeList = usesPackage ? listAfter(org, /\bincludes\s+(.+)$/i) : briefList;
  const briefScope = quote(brief, /\b(deliverables|scope)\b/i) ?? quote(email, /\b(deliverables|scope)\b/i);
  const wantList = listAfter(brief, /\bclient wants\s+(.+?)(?:\.|$)/i);
  // A brief the email relies on must contain project facts; instruction-only or empty text is not a usable brief.
  const briefHasFacts = briefClients.length > 0 || Boolean(wantList || briefList || quote(brief, money) || quote(brief, /\bweeks?\b/i) || quote(brief, /\b(deliverables|scope|objectives?|goals?)\b/i));
  const briefUnusable = /\battach/i.test(input.email.bodyText) && Boolean(brief) && !briefHasFacts;
  if (briefUnusable) questions.push(question("usable_project_brief", `Please provide a project brief with the client, objectives, deliverables, budget, and schedule; ${brief!.filename ?? "the attachment"} contains none of these.`, "The email asks for work based on the attached brief, but the attachment has no usable project information, so the proposal cannot be grounded in it."));
  if (!briefUnusable && !briefScope && !wantList) questions.push(question("proposal_scope_missing", "What work and deliverables should the proposal cover?", "Neither the email nor a readable brief states the requested scope or deliverables."));
  const scopeItems = scopeList?.items ?? wantList?.items ?? [];
  if (!scopeItems.length && !questions.some((item) => item.id === "proposal_scope_missing")) questions.push(question("proposal_scope_missing", "Which deliverables should the proposal list?", "The scope could not be itemized from the supplied sources."));
  const exclusionList = listAfter(org, /\bexcludes\s+(.+)$/i);
  if (!exclusionList) unknowns.push("No exclusions are stated in the company profile; confirm them before agreement.");
  const constraints = quote(brief, /\bconstraints?\b/i);
  if (!quote(brief, money) && feeKey) unknowns.push("The client brief does not restate the fee; it comes from the company's standard package.");
  unknowns.push("Payment milestones are not stated and remain to be agreed.");

  const interval = startDate && endDate ? `${startDate.slice(0, -6)}${startDate.slice(-4) === endDate.slice(-4) ? "" : startDate.slice(-6)}-${endDate}` : null;
  const schedule = interval ? `${interval} (${durationWeeks} calendar weeks)` : durationWeeks ? `${startDate ? `Starts ${startDate}` : "Start date to be confirmed"}; ${durationWeeks} calendar weeks` : startDate ? `Starts ${startDate}` : "Schedule to be confirmed";
  if (endDate) unknowns.unshift(`The end date (${endDate}) is calculated as ${durationWeeks} calendar weeks from the stated start, inclusive; confirm it with the client.`);
  return {
    client: clients.length === 1 ? clients[0]! : "Client",
    fee, durationWeeks, startDate, endDate, schedule,
    derivedDates: endDate ? [endDate.toLowerCase().replace(/,.*$/, "")] : [],
    scopeItems, objectives: wantList?.items ?? scopeItems, exclusions: exclusionList?.items ?? [],
    constraints: constraints?.quote ?? null,
    unknowns, questions, warnings,
    evidence: {
      client: refs(brief ? quote(brief, /project brief|is a fictional|brand/i) : null, email ? { sourceId: email.id, locator: "subject", quote: null } : null),
      fee: refs(quote(brief, money), quote(org, money)),
      schedule: refs(quote(email, /\bstart|\bweeks?\b/i), quote(brief, /\bweeks?\b/i)),
      scope: refs(briefScope, scopeList?.ref ?? null),
      objectives: refs(wantList?.ref ?? briefScope),
      exclusions: refs(exclusionList?.ref ?? null),
      constraints: refs(constraints),
    },
  };
}
