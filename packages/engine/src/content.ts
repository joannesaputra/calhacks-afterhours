import type { ContentBlock, EngineInput, SlideContent, SourceDocument, SourceRef, WorkPlan, WorkProduct } from "@afterhours/contracts";
import type { SalesMetrics } from "./calculations";
import { displayPercent, monthLabel, usd } from "./calculations";
import { formatLocal } from "./dates";
import { stableId } from "./ids";
import type { ProposalFacts } from "./proposalFacts";

const empty = { items: [] as string[], columns: [] as string[], rows: [] as string[][], chart: null };
const attachment = (sources: SourceDocument[], suffix?: string) => sources.find((source) => source.kind === "attachment" && (!suffix || source.filename?.endsWith(suffix)))!;
const ref = (source: SourceDocument, quote: string | null, locator: string | null = null): SourceRef => ({ sourceId: source.id, quote, locator });

function paragraph(id: string, heading: string | null, text: string, basis: ContentBlock["basis"], evidence: SourceRef[] = []): ContentBlock {
  return { id, kind: "paragraph", heading, text, ...empty, basis, evidence };
}
function bullets(id: string, heading: string | null, items: string[], basis: ContentBlock["basis"], evidence: SourceRef[] = []): ContentBlock {
  return { id, kind: "bullets", heading, text: null, items, columns: [], rows: [], chart: null, basis, evidence };
}
function table(id: string, heading: string, columns: string[], rows: string[][], basis: ContentBlock["basis"], evidence: SourceRef[] = []): ContentBlock {
  return { id, kind: "table", heading, text: null, items: [], columns, rows, chart: null, basis, evidence };
}
function slide(id: string, title: string, layout: SlideContent["layout"], blocks: ContentBlock[], speakerNotes: string): SlideContent {
  return { id, title, layout, blocks, speakerNotes };
}
const lowerFirst = (value: string) => value ? value[0]!.toLowerCase() + value.slice(1) : value;
/** Joins prose items; pass `names` to keep proper names (channels, clients) as written. */
function sentenceList(items: string[], names = false): string {
  const values = names ? items : items.map(lowerFirst);
  if (values.length <= 2) return values.join(" and ");
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const countWord = (value: number) => WORDS[value] ?? String(value);
const halves = <T>(items: T[]): [T[], T[]] => [items.slice(0, Math.ceil(items.length / 2)), items.slice(Math.ceil(items.length / 2))];

interface ProposalInputs { client: string; fee: string; schedule: string; scopeItems: string[]; objectives: string[]; exclusions: string[]; constraints: string | null; unknowns: string[]; durationWeeks: number | null; evidence: ProposalFacts["evidence"] }

function fromAnswers(input: EngineInput, sources: SourceDocument[]): ProposalInputs {
  const answers = Object.fromEntries(input.answers.map((answer) => [answer.questionId, answer.answer.trim()]));
  const answerRef = (id: string) => {
    const source = sources.find((item) => item.kind === "user_answer" && item.title === `Answer: ${id}`);
    return source ? [ref(source, source.text.length <= 300 ? source.text : null)] : [];
  };
  const scope = answers.project_scope!;
  return {
    client: answers.client_identity!, fee: answers.authorized_fee!, schedule: answers.project_schedule!,
    scopeItems: [scope], objectives: [scope], exclusions: [], constraints: null, durationWeeks: null,
    unknowns: ["Exclusions were not supplied and must be confirmed before agreement.", "Payment milestones are not stated and remain to be agreed."],
    evidence: { client: answerRef("client_identity"), fee: answerRef("authorized_fee"), schedule: answerRef("project_schedule"), scope: answerRef("project_scope"), objectives: answerRef("project_scope"), exclusions: [], constraints: [] },
  };
}

export function proposalProducts(input: EngineInput, sources: SourceDocument[], plan: WorkPlan, answered: boolean, extracted?: ProposalFacts): WorkProduct[] {
  const facts: ProposalInputs = answered ? fromAnswers(input, sources) : extracted!;
  const org = input.organization.name;
  const { client, fee, schedule, evidence } = facts;
  const deadline = plan.dueAt ? formatLocal(plan.dueAt, input.organization.timezone) : null;
  const engagement = facts.durationWeeks ? `a ${facts.durationWeeks}-week engagement` : "an engagement";
  const productId = stableId(input.taskId, input.revision, "proposal", 0);
  const scheduleEvidence = evidence.schedule.length ? evidence.schedule : evidence.client;
  const blocks: ContentBlock[] = [
    paragraph(`${productId}-summary`, "Executive summary", `${org} proposes ${engagement} for ${client} covering ${sentenceList(facts.scopeItems)}. This is a review draft: it does not promise commercial outcomes and has not been sent to or accepted by the client.`, "source", [...evidence.scope, ...evidence.client]),
    bullets(`${productId}-objectives`, "Understanding and objectives", facts.objectives, "source", evidence.objectives),
    ...(facts.constraints ? [paragraph(`${productId}-constraints`, "Constraints stated in the brief", facts.constraints, "source", evidence.constraints)] : []),
    table(`${productId}-scope`, "Scope and deliverables", ["#", "Deliverable"], facts.scopeItems.map((item, index) => [String(index + 1), item]), "source", evidence.scope),
    table(`${productId}-commercials`, "Timeline and fee", ["Item", "Review-draft position"], [
      ["Engagement schedule", schedule],
      ...(deadline ? [["Draft due", deadline]] : []),
      ["Strategy fee", fee],
      ["Payment milestones", "Not stated in the sources; to be agreed"],
    ], "source", [...evidence.fee, ...scheduleEvidence]),
    bullets(`${productId}-responsibilities`, "Responsibilities and dependencies", [`${client} provides timely access to product, launch, and channel context.`, `${org} develops the agreed deliverables for review.`, "Working hypotheses stay labeled as hypotheses until tested with evidence."], "recommendation"),
    ...(facts.exclusions.length ? [bullets(`${productId}-exclusions`, "Exclusions", facts.exclusions, "source", evidence.exclusions)] : []),
    bullets(`${productId}-success`, "Proposed success measures", ["Deliverables completed and approved on schedule", "Feedback on each deliverable captured in writing", "Baseline metrics defined before launch activity", "A regular measurement review established"], "recommendation"),
    bullets(`${productId}-assumptions`, "Assumptions and unknowns", ["This is a review draft, not an accepted agreement.", ...facts.unknowns], "assumption"),
    paragraph(`${productId}-next`, "Next steps", `Confirm the scope, the ${fee} fee, the schedule, and payment milestones, then approve any working hypotheses before delivery work begins.`, "recommendation"),
  ];
  const deckId = stableId(input.taskId, input.revision, "presentation", 0);
  const [scopeA, scopeB] = halves(facts.scopeItems);
  const slides: SlideContent[] = [
    slide(`${deckId}-1`, `${client} proposal kickoff`, "title", [paragraph(`${deckId}-1a`, "Review draft", `${org} | ${schedule}`, "source", scheduleEvidence)], "For internal review before any client commitment."),
    slide(`${deckId}-2`, facts.constraints ? "Goals and constraints" : "Goals", facts.constraints ? "two_column" : "bullets", [
      bullets(`${deckId}-2a`, "What we heard", facts.objectives, "source", evidence.objectives),
      ...(facts.constraints ? [paragraph(`${deckId}-2b`, "Constraints from the brief", facts.constraints.replace(/^Constraints?:\s*(\S)/i, (_, first: string) => first.toUpperCase()), "source", evidence.constraints)] : []),
    ], "Distinguish working hypotheses from established audience facts."),
    slide(`${deckId}-3`, "Scope and deliverables", scopeB.length ? "two_column" : "bullets", [
      bullets(`${deckId}-3a`, scopeB.length ? "Strategy" : "Deliverables", scopeA, "source", evidence.scope),
      ...(scopeB.length ? [bullets(`${deckId}-3b`, "Activation and measurement", scopeB, "source", evidence.scope)] : []),
    ], "All deliverables stay within the authorized scope."),
    slide(`${deckId}-4`, "Timeline and fee", "two_column", [
      bullets(`${deckId}-4a`, "Timeline", [schedule, ...(deadline ? [`Draft due ${deadline}`] : [])], "source", scheduleEvidence),
      bullets(`${deckId}-4b`, "Commercials", [`Strategy fee: ${fee}`, ...(facts.exclusions.length ? [`Excludes ${sentenceList(facts.exclusions.slice(0, 2))}`] : [])], "source", [...evidence.fee, ...evidence.exclusions]),
    ], facts.exclusions.length ? `Full exclusions: ${sentenceList(facts.exclusions)}.` : "Exclusions are not stated and must be confirmed."),
    slide(`${deckId}-5`, "Decisions and next steps", "closing", [bullets(`${deckId}-5a`, "Confirm before kickoff", ["Approve the scope and schedule", "Confirm the fee and agree payment milestones", "Test the working hypotheses with the client", "Agree how the baseline will be measured"], "recommendation")], "This deck supports review; it does not record acceptance."),
  ];
  return [
    { id: productId, kind: "proposal", title: `${client} Proposal`, subtitle: "Review draft prepared for internal review", blocks, slides: [], assumptions: plan.assumptions, warnings: [] },
    { id: deckId, kind: "presentation", title: `${client} Kickoff Deck`, subtitle: `${countWord(slides.length)}-slide review draft`, blocks: [], slides, assumptions: plan.assumptions, warnings: [] },
  ];
}

const pctText = (value: number | null) => value === null ? "not computable (zero starting value)" : `${Math.abs(displayPercent(value))}%`;
function change(value: number | null, delta: number, noun: string): string {
  if (delta === 0) return `${noun} was unchanged`;
  if (value === null) return `${noun} rose from zero, so no percent change is defined`;
  return `${noun} ${delta > 0 ? "increased" : "decreased"} ${pctText(value)}`;
}

/** A channel's share of a month's revenue; a month with no revenue has no shares. */
const shareText = (value: number | null) => value === null ? "not defined (no revenue that month)" : `${value}%`;

/** "A to B", or "A in both months" when unchanged. */
const span = (from: string, to: string) => from === to ? `${from} in both months` : `${from} to ${to}`;

function shareSentence(channel: SalesMetrics["channels"][number], month1: string, label1: string, month2: string, label2: string): string {
  const [s1, s2] = [channel.sharePercent[month1] ?? null, channel.sharePercent[month2] ?? null];
  if (s1 !== null && s2 !== null) return `${channel.channel} represented ${s1}% of revenue in ${label1} and ${s2}% in ${label2}; shares are rounded to one decimal place.`;
  if (s1 === null && s2 === null) return `${label1} and ${label2} had no recorded revenue, so no channel shares are defined.`;
  const [empty, known, share] = s1 === null ? [label1, label2, s2] : [label2, label1, s1];
  return `${empty} had no recorded revenue, so no channel shares are defined for it; ${channel.channel} represented ${share}% of revenue in ${known}.`;
}

export function reportTitle(metrics: SalesMetrics): string {
  const [first, second] = metrics.months;
  const sameYear = first!.month.slice(0, 4) === second!.month.slice(0, 4);
  return `${monthLabel(first!.month, !sameYear)}-${monthLabel(second!.month)}`;
}

export function reportProducts(input: EngineInput, sources: SourceDocument[], plan: WorkPlan, metrics: SalesMetrics): WorkProduct[] {
  const data = attachment(sources, ".csv");
  const dataRef = [ref(data, null, `CSV rows 2-${metrics.rows.length + 1}; sums, averages, shares, and percent changes computed in code`)];
  const [first, second] = metrics.months;
  const m1 = monthLabel(first!.month);
  const m2 = monthLabel(second!.month);
  const period = reportTitle(metrics);
  const aov = (minor: number | null) => minor === null ? "unknown (no orders)" : usd(minor);
  const aovSentence = first!.averageOrderValueMinor === second!.averageOrderValueMinor
    ? `average order value was ${aov(first!.averageOrderValueMinor)} in both months`
    : `average order value moved from ${aov(first!.averageOrderValueMinor)} to ${aov(second!.averageOrderValueMinor)}`;
  const byRevenue = [...metrics.channels].sort((a, b) => (b.values[second!.month]! - a.values[second!.month]!) || a.channel.localeCompare(b.channel));
  const top = byRevenue[0]!;
  // Never present one channel as "largest" when it is tied with another.
  const topTied = byRevenue.length > 1 && byRevenue[1]!.values[second!.month] === top.values[second!.month];
  const productId = stableId(input.taskId, input.revision, "report", 0);
  const chart: ContentBlock = { id: `${productId}-chart`, kind: "chart", heading: "Revenue by month (USD)", text: null, items: [], columns: [], rows: [], chart: { type: "bar", labels: [m1, m2], series: [{ name: "Revenue (USD)", values: metrics.months.map((item) => item.revenueMinor / 100) }], unit: "USD" }, evidence: dataRef, basis: "calculated" };
  const revenueLine = `Revenue moved from ${usd(first!.revenueMinor)} in ${m1} to ${usd(second!.revenueMinor)} in ${m2}, a change of ${metrics.revenueChangeMinor < 0 ? "-" : ""}${usd(Math.abs(metrics.revenueChangeMinor))} (${change(metrics.revenueGrowthPercent, metrics.revenueChangeMinor, "revenue")}).`;
  const blocks: ContentBlock[] = [
    paragraph(`${productId}-summary`, "Executive summary", `${revenueLine} Orders moved from ${first!.orders} to ${second!.orders} (${change(metrics.orderGrowthPercent, metrics.orderChange, "orders")}), and ${aovSentence}.`, "calculated", dataRef),
    chart,
    table(`${productId}-monthly`, "Monthly performance", ["Month", "Revenue", "Orders", "Average order value"], metrics.months.map((item) => [monthLabel(item.month), usd(item.revenueMinor), String(item.orders), aov(item.averageOrderValueMinor)]), "calculated", dataRef),
    table(`${productId}-channels`, "Channel revenue", ["Channel", m1, m2, "Change"], byRevenue.map((channel) => [channel.channel, usd(channel.values[first!.month]!), usd(channel.values[second!.month]!), channel.values[first!.month] === channel.values[second!.month] ? "Unchanged" : channel.growthPercent === null ? "Not computable" : `${channel.growthPercent > 0 ? "+" : "-"}${pctText(channel.growthPercent)}`]), "calculated", dataRef),
    paragraph(`${productId}-share`, "Channel mix", topTied ? `Several channels tied for the largest share of revenue in ${m2}; the channel table lists each channel's revenue.` : shareSentence(top, first!.month, m1, second!.month, m2), "calculated", dataRef),
    bullets(`${productId}-limits`, "Limitations", ["The dataset does not include campaign exposure, cost, margin, returns, or customer identifiers.", "ROAS, profit, retention, CAC, and conversion rate cannot be calculated.", "The change is an observation; the data does not establish causality."], "source", dataRef),
    bullets(`${productId}-recommend`, "Recommended next steps", ["Continue monthly revenue and order tracking by channel.", "Add campaign cost and exposure fields before evaluating marketing efficiency.", "Document returns and margin definitions before profit analysis."], "recommendation"),
  ];
  const deckId = stableId(input.taskId, input.revision, "presentation", 0);
  // Deck bullets lead with the takeaway: the movement first, then what it means for the mix.
  const movement = (from: number, to: number, growth: number | null) => {
    const values = `${usd(from)} → ${usd(to)}`;
    if (from === to) return `${values} (unchanged)`;
    if (growth === null) return `${values} (new revenue this month)`;
    return `${values} (${growth > 0 ? "up" : "down"} ${pctText(growth)})`;
  };
  const shareMove = (channel: SalesMetrics["channels"][number]) => {
    const [s1, s2] = [channel.sharePercent[first!.month] ?? null, channel.sharePercent[second!.month] ?? null];
    if (s1 === null || s2 === null) return null;
    return s1 === s2 ? `Share held steady from ${m1}` : `Share ${s2 > s1 ? "rose" : "fell"} from ${s1}% in ${m1}`;
  };
  const channelBlocks: ContentBlock[] = metrics.channels.length <= 2
    ? byRevenue.map((channel, index) => {
      const share = channel.sharePercent[second!.month] ?? null;
      const moved = shareMove(channel);
      return bullets(`${deckId}-3${index}`, channel.channel, [
        movement(channel.values[first!.month]!, channel.values[second!.month]!, channel.growthPercent),
        share === null ? `No revenue recorded in ${m2}` : `${share}% of ${m2} revenue`,
        ...(moved ? [moved] : []),
      ], "calculated", dataRef);
    })
    : [table(`${deckId}-3t`, metrics.channels.length > 6 ? "Revenue by channel (largest six; all in the report)" : "Revenue by channel", ["Channel", m1, m2], byRevenue.slice(0, 6).map((channel) => [channel.channel, usd(channel.values[first!.month]!), usd(channel.values[second!.month]!)]), "calculated", dataRef)];
  const revenueTitle = change(metrics.revenueGrowthPercent, metrics.revenueChangeMinor, "Revenue");
  function orderBullets(): string[] {
    const [o1, o2] = [first!.orders, second!.orders];
    const ordersLine = o1 === o2 ? `Orders held at ${o2} in both months`
      : metrics.orderGrowthPercent === null ? `Orders rose from zero to ${o2}`
      : `Orders ${o2 > o1 ? "grew" : "fell"} ${pctText(metrics.orderGrowthPercent)}, from ${o1} to ${o2}`;
    const [a1, a2] = [first!.averageOrderValueMinor, second!.averageOrderValueMinor];
    const aovLine = a1 !== null && a1 === a2 ? `Average order value held at ${aov(a1)} in both months` : `Average order value moved from ${aov(a1)} to ${aov(a2)}`;
    // Revenue = orders x average order value, so with a constant order value the change is all in order count.
    const insight = a1 !== null && a1 === a2 && o1 !== o2 ? [`The change came from ${o2 > o1 ? "more" : "fewer"} orders, not from order size`] : [];
    const s1 = top.sharePercent[first!.month] ?? null;
    const s2 = top.sharePercent[second!.month] ?? null;
    const shareLine = topTied ? "Several channels tied for the largest revenue share"
      : s1 !== null && s1 === s2 ? `${top.channel} kept ${s2}% of revenue in both months`
      : s1 !== null && s2 !== null ? `${top.channel} share moved from ${s1}% to ${s2}%`
      : `${top.channel} share: ${span(shareText(s1), shareText(s2))}`;
    return [ordersLine, aovLine, ...insight, shareLine];
  }
  const slides: SlideContent[] = [
    slide(`${deckId}-1`, `${period} sales update`, "title", [paragraph(`${deckId}-1a`, "Dataset scope", `Revenue and orders by channel: ${sentenceList(byRevenue.slice(0, 4).map((channel) => channel.channel), true)}${byRevenue.length > 4 ? ", and others" : ""}`, "calculated", dataRef)], "All values are calculated in code from the attached CSV."),
    slide(`${deckId}-2`, revenueTitle, "chart", [{ ...chart, id: `${deckId}-2a` }], `${revenueLine} Causality is not established.`),
    slide(`${deckId}-3`, "Channel performance", metrics.channels.length === 2 ? "two_column" : "bullets", channelBlocks, metrics.channels.length > 6 ? "Only the six largest channels are shown; the report lists every channel." : "Values are channel revenue sums from the CSV."),
    slide(`${deckId}-4`, "Orders and order value", "bullets", [bullets(`${deckId}-4a`, "What changed", orderBullets(), "calculated", dataRef)], "Average order value is revenue divided by orders for each month."),
    slide(`${deckId}-5`, "Limits and next steps", "closing", [bullets(`${deckId}-5a`, "How to use these numbers", ["Treat the change as an observation, not proof of campaign impact", "Add campaign cost and reach data to judge efficiency", "Track margins and returns before drawing financial conclusions", "Review each channel monthly to confirm the trend"], "recommendation")], "ROAS, CAC, profit, retention, and conversion are not computable from this dataset."),
  ];
  return [
    { id: productId, kind: "report", title: `${period} Sales Performance Report`, subtitle: "Calculated from the supplied CSV", blocks, slides: [], assumptions: plan.assumptions, warnings: [] },
    { id: deckId, kind: "presentation", title: `${period} Sales Update`, subtitle: `${countWord(slides.length)}-slide review deck`, blocks: [], slides, assumptions: plan.assumptions, warnings: [] },
  ];
}
