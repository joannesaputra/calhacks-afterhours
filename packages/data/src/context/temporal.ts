// Relative past dates ("last week", "on Tuesday", "October 19"), interpreted against the request's own received time and
// the organization's timezone. The worker's clock is never an input, so a task prepared a week late means the same thing.
import { DateTime } from "luxon";

export interface TimeInterval { start: string; end: string }
export interface Interpretation { id: string; label: string; interval: TimeInterval }
export interface PhraseInterpretation {
  phrase: string;
  anchor: string;
  timezone: string;
  primary: Interpretation;
  alternatives: Interpretation[];
  basis: string;
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY_RE = "(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";

const PATTERNS: RegExp[] = [
  /\b(?:earlier\s+)?(?:last|this)\s+(?:week|month)\b/gi,
  /\b(?:yesterday|today|the day before yesterday)\b/gi,
  new RegExp(`\\blast\\s+${WEEKDAY_RE}\\b`, "gi"),
  new RegExp(`\\bon\\s+${WEEKDAY_RE}\\b`, "gi"),
  new RegExp(`\\b${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"),
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b(?:\d{1,2}|a|one|two|three|four)\s+(?:day|week)s?\s+ago\b/gi,
];

/** Date phrases in order of appearance, deduplicated. */
export function findDatePhrases(text: string): string[] {
  const hits: Array<{ at: number; phrase: string }> = [];
  for (const re of PATTERNS) for (const m of text.matchAll(re)) hits.push({ at: m.index ?? 0, phrase: m[0].trim() });
  hits.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  return hits.filter((h) => { const k = h.phrase.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).map((h) => h.phrase);
}

const iso = (d: DateTime) => d.toISO({ suppressMilliseconds: false })!;
const span = (start: DateTime, end: DateTime): TimeInterval => ({ start: iso(start), end: iso(end) });
const dayOf = (d: DateTime): TimeInterval => span(d.startOf("day"), d.endOf("day"));
const weekdayIndex = (name: string) => WEEKDAYS.findIndex((w) => w.startsWith(name.slice(0, 3).toLowerCase()));
const NUMBER_WORDS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4 };

/** Most recent calendar day with the given weekday that is not after `from`; `strict` excludes `from` itself. */
function lastWeekday(from: DateTime, weekday: number, strict: boolean): DateTime {
  let d = from.startOf("day");
  if (strict) d = d.minus({ days: 1 });
  while (d.weekday - 1 !== weekday) d = d.minus({ days: 1 });
  return d;
}

export function interpretPhrase(phrase: string, anchorIso: string, timezone: string): PhraseInterpretation | null {
  const anchor = DateTime.fromISO(anchorIso, { setZone: true }).setZone(timezone);
  if (!anchor.isValid) return null;
  const p = phrase.trim().toLowerCase().replace(/^earlier\s+/, "");
  const basis = `Relative to the request received ${iso(anchor)} (${timezone}); weeks run Monday to Sunday.`;
  const make = (primary: Interpretation, alternatives: Interpretation[] = []): PhraseInterpretation => ({ phrase, anchor: iso(anchor), timezone, primary, alternatives, basis });
  const I = (id: string, label: string, interval: TimeInterval): Interpretation => ({ id, label, interval });

  if (p === "last week") {
    const start = anchor.startOf("week").minus({ weeks: 1 });
    return make(I("calendar_week", "the previous calendar week (Monday to Sunday)", span(start, start.plus({ weeks: 1 }).minus({ milliseconds: 1 }))),
      [I("rolling_7_days", "the 7 days before the day of the request", span(anchor.startOf("day").minus({ days: 7 }), anchor.startOf("day").minus({ milliseconds: 1 })))]);
  }
  if (p === "this week") return make(I("this_week", "this calendar week so far", span(anchor.startOf("week"), anchor)));
  if (p === "last month") {
    const start = anchor.startOf("month").minus({ months: 1 });
    return make(I("calendar_month", "the previous calendar month", span(start, start.endOf("month"))),
      [I("rolling_30_days", "the 30 days before the day of the request", span(anchor.startOf("day").minus({ days: 30 }), anchor.startOf("day").minus({ milliseconds: 1 })))]);
  }
  if (p === "this month") return make(I("this_month", "this calendar month so far", span(anchor.startOf("month"), anchor)));
  if (p === "yesterday") return make(I("yesterday", "the previous calendar day", dayOf(anchor.minus({ days: 1 }))));
  if (p === "the day before yesterday") return make(I("two_days_ago", "two calendar days before", dayOf(anchor.minus({ days: 2 }))));
  if (p === "today") return make(I("today", "the day of the request", span(anchor.startOf("day"), anchor)));

  let m = new RegExp(`^last\\s+${WEEKDAY_RE}$`, "i").exec(p);
  if (m) { const d = lastWeekday(anchor, weekdayIndex(m[1]!), true); return make(I("last_weekday", `the most recent ${WEEKDAYS[d.weekday - 1]}`, dayOf(d))); }
  m = new RegExp(`^on\\s+${WEEKDAY_RE}$`, "i").exec(p);
  if (m) { const d = lastWeekday(anchor, weekdayIndex(m[1]!), false); return make(I("on_weekday", `the most recent ${WEEKDAYS[d.weekday - 1]} up to the request`, dayOf(d))); }
  m = new RegExp(`^${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$`, "i").exec(p);
  if (m) {
    const month = MONTHS.findIndex((n) => n.startsWith(m![1]!.slice(0, 3).toLowerCase())) + 1;
    let d = DateTime.fromObject({ year: m[3] ? Number(m[3]) : anchor.year, month, day: Number(m[2]) }, { zone: timezone });
    if (!d.isValid) return null;
    if (!m[3] && d > anchor.endOf("day")) d = d.minus({ years: 1 });
    return make(I("calendar_date", `that calendar day (${d.toFormat("yyyy-MM-dd")})`, dayOf(d)));
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p);
  if (m) { const d = DateTime.fromObject({ year: +m[1]!, month: +m[2]!, day: +m[3]! }, { zone: timezone }); return d.isValid ? make(I("iso_date", "that calendar day", dayOf(d))) : null; }
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(p);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : anchor.year;
    let d = DateTime.fromObject({ year, month: +m[1]!, day: +m[2]! }, { zone: timezone });
    if (!d.isValid) return null;
    if (!m[3] && d > anchor.endOf("day")) d = d.minus({ years: 1 });
    return make(I("us_date", "that calendar day (month/day order)", dayOf(d)));
  }
  m = /^(\d{1,2}|a|one|two|three|four)\s+(day|week)s?\s+ago$/.exec(p);
  if (m) {
    const n = NUMBER_WORDS[m[1]!] ?? Number(m[1]);
    if (m[2] === "day") return make(I("days_ago", `${n} day${n === 1 ? "" : "s"} before`, dayOf(anchor.minus({ days: n }))));
    const week = anchor.minus({ weeks: n }).startOf("week");
    return make(I("weeks_ago_calendar", `the calendar week ${n} week${n === 1 ? "" : "s"} before`, span(week, week.plus({ weeks: 1 }).minus({ milliseconds: 1 }))),
      [I("weeks_ago_rolling", `${n * 7} days before, give or take 3 days`, span(anchor.minus({ days: n * 7 + 3 }), anchor.minus({ days: n * 7 - 3 })))]);
  }
  return null;
}

export const inInterval = (instantIso: string | null, interval: TimeInterval): boolean => {
  if (!instantIso) return false;
  const t = Date.parse(instantIso);
  return t >= Date.parse(interval.start) && t <= Date.parse(interval.end);
};
