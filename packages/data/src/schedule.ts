import { DateTime, IANAZone } from "luxon";
import type { WorkspaceSettings } from "@afterhours/contracts";

/**
 * Pure delivery-scheduling policy (Batch 5). No database, no server clock, no server timezone: callers pass
 * the UTC instant and the validated IANA policy. Persisted values are UTC instants plus a logical local date.
 *
 * Policy (documented in docs/batches/batch-5/darren.md and docs/runbook.md):
 *  - Quiet hours disabled, or `now` outside the quiet window: deliver immediately.
 *  - `now` inside the window: only delivery is deferred (work generation is never delayed).
 *      * digestTime outside the window  -> the first digestTime wall-clock occurrence at or after `now`
 *        (always at or after the end of the window).
 *      * digestTime inside the window   -> the end of the window containing `now` (delivery never happens in
 *        quiet hours because the requested slot fell there).
 *  - Quiet window is [start, end): start inclusive, end exclusive; start > end crosses midnight.
 *  - An enabled window with start === end is ambiguous. Settings writes reject it (patchSettings). If one is
 *    already stored it is treated as "no quiet hours" so a ready commit can never fail because of it.
 *  - Wall-clock resolution uses Luxon with an explicit disambiguation rule:
 *      * DST gap (the wall time does not exist, e.g. 02:30 on spring-forward day): moved forward by the gap
 *        length (02:30 -> 03:30), Luxon's own behaviour, asserted in tests.
 *      * DST overlap (the wall time occurs twice): the earliest occurrence that is not before `now`
 *        (the first one, unless it has already passed, then the repeated one).
 *    "Next morning" is a local calendar date, never `now + 24 h`.
 *  - One digest per logical (local date, channel) group; a repeated local hour does not create a second group
 *    because grouping is by the local date of the scheduled instant.
 */
export type QuietHours = WorkspaceSettings["notifications"]["quietHours"];

export interface SchedulePolicy {
  quietHours: QuietHours;
  digestTime: string;
}

export interface DeliverySchedule {
  immediate: boolean;
  scheduledFor: Date;
  /** Logical local calendar date of `scheduledFor` in `timezone`; null for an immediate delivery. */
  localDate: string | null;
  timezone: string;
}

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHHmm(value: string): { h: number; m: number } {
  const m = HHMM.exec(value);
  if (!m) throw new ScheduleError(`Invalid time "${value}": expected HH:mm (24-hour).`);
  return { h: Number(m[1]), m: Number(m[2]) };
}

export function isValidIanaZone(zone: string): boolean {
  return typeof zone === "string" && zone.length > 0 && IANAZone.isValidZone(zone);
}

const minutes = (t: { h: number; m: number }): number => t.h * 60 + t.m;

/** True when quiet hours are enabled AND well-formed (equal start/end counts as not enabled). */
function activeWindow(q: QuietHours): { s: number; e: number } | null {
  if (!q.enabled) return null;
  const s = minutes(parseHHmm(q.start));
  const e = minutes(parseHHmm(q.end));
  if (s === e) return null;
  return { s, e };
}

const inWindow = (w: { s: number; e: number }, minuteOfDay: number): boolean =>
  w.s < w.e ? minuteOfDay >= w.s && minuteOfDay < w.e : minuteOfDay >= w.s || minuteOfDay < w.e;

function zoned(zone: string, instant: Date): DateTime {
  if (!isValidIanaZone(zone)) throw new ScheduleError(`Unknown IANA timezone: ${zone}`);
  return DateTime.fromJSDate(instant).setZone(zone);
}

export function inQuietHours(q: QuietHours, now: Date): boolean {
  const w = activeWindow(q);
  if (!w) return false;
  const local = zoned(q.timezone, now);
  return inWindow(w, local.hour * 60 + local.minute);
}

/** Every instant at which the wall clock in `zone` reads this date and time. Empty for a DST gap. */
function wallInstants(zone: string, date: DateTime, time: { h: number; m: number }): DateTime[] {
  const { year, month, day } = date;
  const probe = DateTime.fromObject({ year, month, day, hour: 12 }, { zone });
  const offsets = new Set([probe.minus({ days: 1 }).offset, probe.offset, probe.plus({ days: 1 }).offset]);
  const found = new Map<number, DateTime>();
  for (const off of offsets) {
    const ms = Date.UTC(year, month - 1, day, time.h, time.m) - off * 60_000;
    const dt = DateTime.fromMillis(ms, { zone });
    if (dt.year === year && dt.month === month && dt.day === day && dt.hour === time.h && dt.minute === time.m) {
      found.set(ms, dt);
    }
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, dt]) => dt);
}

/** First instant at or after (or strictly after) `from` whose local wall clock reads `time`. */
function firstWallClock(zone: string, from: Date, time: { h: number; m: number }, inclusive: boolean): DateTime {
  const start = zoned(zone, from).startOf("day");
  for (let i = 0; i < 4; i++) {
    const day = start.plus({ days: i });
    let candidates = wallInstants(zone, day, time);
    if (candidates.length === 0) {
      // DST gap: Luxon resolves a nonexistent wall time forward by the length of the gap.
      candidates = [DateTime.fromObject({ year: day.year, month: day.month, day: day.day, hour: time.h, minute: time.m }, { zone })];
    }
    const hit = candidates.find((c) => (inclusive ? c.toMillis() >= from.getTime() : c.toMillis() > from.getTime()));
    if (hit) return hit;
  }
  throw new ScheduleError(`No occurrence of ${String(time.h).padStart(2, "0")}:${String(time.m).padStart(2, "0")} found in ${zone}.`);
}

/** End of the quiet window that contains `at` (which must be inside the window). */
function quietEndAfter(q: QuietHours, at: Date): DateTime {
  return firstWallClock(q.timezone, at, parseHHmm(q.end), false);
}

/** Decide when a ready notification may be delivered. Generation is never delayed. */
export function computeDeliverySchedule(policy: SchedulePolicy, now: Date): DeliverySchedule {
  const q = policy.quietHours;
  const window = activeWindow(q);
  const digest = parseHHmm(policy.digestTime);
  if (!window || !inQuietHours(q, now)) {
    return { immediate: true, scheduledFor: now, localDate: null, timezone: q.timezone };
  }
  const windowEnd = quietEndAfter(q, now);
  const digestInsideQuiet = inWindow(window, minutes(digest));
  let target = digestInsideQuiet ? windowEnd : firstWallClock(q.timezone, now, digest, true);
  if (target < windowEnd) target = windowEnd;
  // Defensive: a resolved instant must never land back inside quiet hours.
  for (let i = 0; i < 3 && inQuietHours(q, target.toJSDate()); i++) target = quietEndAfter(q, target.toJSDate());
  const local = target.setZone(q.timezone);
  return {
    immediate: false,
    scheduledFor: target.toUTC().toJSDate(),
    localDate: local.toISODate(),
    timezone: q.timezone,
  };
}
