import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { computeDeliverySchedule, DomainError, inQuietHours, parseHHmm, patchSettings, ScheduleError } from "../src";
import { makeTestDb } from "../src/testing";

const LA = "America/Los_Angeles";
const quiet = (start = "22:00", end = "08:00", timezone = LA, enabled = true) => ({ enabled, start, end, timezone });
const at = (iso: string) => new Date(iso);
const sched = (iso: string, q = quiet(), digestTime = "08:00") => computeDeliverySchedule({ quietHours: q, digestTime }, at(iso));
const local = (d: Date, zone = LA) => DateTime.fromJSDate(d).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm");

// Expected instants below are written out by hand from the published DST rules for America/Los_Angeles in 2026
// (PST = UTC-8, PDT = UTC-7; spring forward Sun 8 Mar 02:00 -> 03:00; fall back Sun 1 Nov 02:00 -> 01:00),
// not computed with the code under test.

describe("delivery schedule — documented default (22:00–08:00, digest 08:00, America/Los_Angeles)", () => {
  it("23:30 on Oct 23 is deferred to 08:00 on Oct 24, 2026-10-24T15:00:00Z", () => {
    const now = at("2026-10-24T06:30:00Z");
    expect(local(now)).toBe("2026-10-23T23:30");
    const s = sched("2026-10-24T06:30:00Z");
    expect(s.immediate).toBe(false);
    expect(s.scheduledFor.toISOString()).toBe("2026-10-24T15:00:00.000Z");
    expect(local(s.scheduledFor)).toBe("2026-10-24T08:00");
    expect(s.localDate).toBe("2026-10-24");
    expect(s.timezone).toBe(LA);
  });

  it("daytime and disabled quiet hours deliver immediately; disabled never creates an all-day block", () => {
    const noon = sched("2026-10-24T19:00:00Z"); // 12:00 PDT
    expect(noon).toMatchObject({ immediate: true, localDate: null });
    expect(noon.scheduledFor.toISOString()).toBe("2026-10-24T19:00:00.000Z");
    expect(sched("2026-10-24T06:30:00Z", quiet("22:00", "08:00", LA, false)).immediate).toBe(true);
    expect(sched("2026-10-24T06:30:00Z", quiet("09:00", "09:00", LA, false)).immediate).toBe(true);
  });

  it("window edges: start inclusive, end exclusive", () => {
    expect(sched("2026-10-24T14:59:00Z")).toMatchObject({ immediate: false }); // 07:59 PDT
    expect(sched("2026-10-24T14:59:00Z").scheduledFor.toISOString()).toBe("2026-10-24T15:00:00.000Z");
    expect(sched("2026-10-24T15:00:00Z").immediate).toBe(true); // exactly 08:00
    expect(sched("2026-10-25T04:59:00Z").immediate).toBe(true); // 21:59 PDT
    const start = sched("2026-10-25T05:00:00Z"); // exactly 22:00 PDT Oct 24
    expect(start.immediate).toBe(false);
    expect(start.scheduledFor.toISOString()).toBe("2026-10-25T15:00:00.000Z"); // next local morning, Oct 25 08:00
  });

  it("after midnight the same local morning is used (no extra day)", () => {
    const s = sched("2026-10-24T08:30:00Z"); // 01:30 PDT Oct 24
    expect(s.scheduledFor.toISOString()).toBe("2026-10-24T15:00:00.000Z");
    expect(s.localDate).toBe("2026-10-24");
  });
});

describe("delivery schedule — digest slot versus quiet window", () => {
  it("a digest slot inside quiet hours is moved to the end of the window, never sent in quiet hours", () => {
    expect(sched("2026-10-24T06:30:00Z", quiet(), "03:00").scheduledFor.toISOString()).toBe("2026-10-24T15:00:00.000Z");
    expect(sched("2026-10-24T08:00:00Z", quiet(), "00:30").scheduledFor.toISOString()).toBe("2026-10-24T15:00:00.000Z"); // 01:00 now
    expect(sched("2026-10-24T06:30:00Z", quiet(), "22:00").scheduledFor.toISOString()).toBe("2026-10-24T15:00:00.000Z"); // slot == start
    for (const slot of ["22:00", "23:30", "00:00", "03:00", "07:59"]) {
      const s = sched("2026-10-24T06:30:00Z", quiet(), slot);
      expect(inQuietHours(quiet(), s.scheduledFor)).toBe(false);
    }
  });

  it("a digest slot later than quiet end uses the later slot", () => {
    const s = sched("2026-10-24T06:30:00Z", quiet(), "12:00");
    expect(s.scheduledFor.toISOString()).toBe("2026-10-24T19:00:00.000Z"); // 12:00 PDT
    expect(local(s.scheduledFor)).toBe("2026-10-24T12:00");
    expect(sched("2026-10-24T06:30:00Z", quiet("22:00", "07:00"), "08:00").scheduledFor.toISOString()).toBe("2026-10-24T15:00:00.000Z");
  });

  it("same-day window (09:00–17:00): slot at the end is used, slot inside moves to the end", () => {
    const base = "2026-10-24T17:00:00Z"; // 10:00 PDT
    expect(sched(base, quiet("09:00", "17:00"), "17:00").scheduledFor.toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(sched(base, quiet("09:00", "17:00"), "12:00").scheduledFor.toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(sched(base, quiet("09:00", "17:00"), "18:30").scheduledFor.toISOString()).toBe("2026-10-25T01:30:00.000Z");
    expect(sched(base, quiet("09:00", "17:00"), "18:30").localDate).toBe("2026-10-24");
  });

  it("works in other zones (Asia/Tokyo has no DST)", () => {
    const s = sched("2026-10-24T14:30:00Z", quiet("22:00", "08:00", "Asia/Tokyo")); // 23:30 JST Oct 24
    expect(s.scheduledFor.toISOString()).toBe("2026-10-24T23:00:00.000Z"); // 08:00 JST Oct 25
    expect(s.localDate).toBe("2026-10-25");
  });
});

describe("delivery schedule — DST (local calendar days, never now + 24 h)", () => {
  it("spring forward: Mar 7 23:30 PST -> Mar 8 08:00 PDT (7.5 h later, not 24 h)", () => {
    const now = at("2026-03-08T07:30:00Z");
    expect(local(now)).toBe("2026-03-07T23:30");
    const s = sched("2026-03-08T07:30:00Z");
    expect(s.scheduledFor.toISOString()).toBe("2026-03-08T15:00:00.000Z");
    expect(s.localDate).toBe("2026-03-08");
    expect(s.scheduledFor.getTime() - now.getTime()).toBe(7.5 * 3600_000);
  });

  it("spring forward: results either side of the missing hour land on the same digest", () => {
    expect(sched("2026-03-08T09:30:00Z").scheduledFor.toISOString()).toBe("2026-03-08T15:00:00.000Z"); // 01:30 PST
    expect(sched("2026-03-08T10:30:00Z").scheduledFor.toISOString()).toBe("2026-03-08T15:00:00.000Z"); // 03:30 PDT
  });

  it("spring forward: a digest slot inside the missing hour resolves forward (02:30 -> 03:30 PDT)", () => {
    const s = sched("2026-03-08T07:30:00Z", quiet("22:00", "01:00"), "02:30");
    expect(s.scheduledFor.toISOString()).toBe("2026-03-08T10:30:00.000Z");
    expect(local(s.scheduledFor)).toBe("2026-03-08T03:30");
  });

  it("spring forward: a quiet end inside the missing hour resolves forward and is never inside quiet hours", () => {
    const q = quiet("22:00", "02:30");
    const s = sched("2026-03-08T07:30:00Z", q, "01:00"); // slot inside the window -> its end
    expect(s.scheduledFor.toISOString()).toBe("2026-03-08T10:30:00.000Z");
    expect(inQuietHours(q, s.scheduledFor)).toBe(false);
  });

  it("fall back: Oct 31 23:30 PDT -> Nov 1 08:00 PST (9.5 h later in real time, not 24 h)", () => {
    const now = at("2026-11-01T06:30:00Z");
    expect(local(now)).toBe("2026-10-31T23:30");
    const s = sched("2026-11-01T06:30:00Z");
    expect(s.scheduledFor.toISOString()).toBe("2026-11-01T16:00:00.000Z");
    expect(s.scheduledFor.getTime() - now.getTime()).toBe(9.5 * 3600_000);
    expect(s.localDate).toBe("2026-11-01");
  });

  it("fall back: both occurrences of the repeated 01:30 map to ONE logical local-date group", () => {
    const first = sched("2026-11-01T08:30:00Z"); // 01:30 PDT
    const second = sched("2026-11-01T09:30:00Z"); // 01:30 PST
    expect(first.scheduledFor.toISOString()).toBe("2026-11-01T16:00:00.000Z");
    expect(second.scheduledFor.toISOString()).toBe("2026-11-01T16:00:00.000Z");
    expect(first.localDate).toBe("2026-11-01");
    expect(second.localDate).toBe(first.localDate);
  });

  it("fall back: a repeated wall time picks the earliest occurrence not before now", () => {
    const q = quiet("22:00", "01:20");
    // First 01:15 (PDT, 08:15Z): the first 01:20 (08:20Z) is still ahead.
    expect(sched("2026-11-01T08:15:00Z", q, "23:00").scheduledFor.toISOString()).toBe("2026-11-01T08:20:00.000Z");
    // Second 01:15 (PST, 09:15Z): the first 01:20 has already passed, so the repeated one (09:20Z) is used.
    expect(sched("2026-11-01T09:15:00Z", q, "23:00").scheduledFor.toISOString()).toBe("2026-11-01T09:20:00.000Z");
  });

  it("a digest slot in the repeated hour uses its first occurrence at or after now", () => {
    const s = sched("2026-11-01T06:30:00Z", quiet("22:00", "01:00"), "01:30");
    expect(s.scheduledFor.toISOString()).toBe("2026-11-01T08:30:00.000Z"); // 01:30 PDT
  });
});

describe("delivery schedule — invalid and ambiguous policy", () => {
  it("rejects invalid IANA zones and invalid times in the pure helper", () => {
    expect(() => sched("2026-10-24T06:30:00Z", quiet("22:00", "08:00", "Nope/Zone"))).toThrow(ScheduleError);
    expect(() => sched("2026-10-24T06:30:00Z", quiet("22:00", "08:00", "UTC+3"))).toThrow(ScheduleError);
    expect(() => sched("2026-10-24T06:30:00Z", quiet(), "8:00")).toThrow(ScheduleError);
    expect(() => parseHHmm("24:00")).toThrow(ScheduleError);
    expect(() => parseHHmm("07:60")).toThrow(ScheduleError);
    expect(parseHHmm("07:05")).toEqual({ h: 7, m: 5 });
  });

  it("settings writes reject invalid zones, bad times and an enabled equal start/end with a useful message", () => {
    const { db } = makeTestDb();
    const now = new Date("2026-10-24T00:00:00Z");
    const reject = (patch: Parameters<typeof patchSettings>[1], re: RegExp) => {
      try { patchSettings(db, patch, now); throw new Error("expected rejection"); }
      catch (e) { expect(e).toBeInstanceOf(DomainError); expect((e as DomainError).httpStatus).toBe(400); expect((e as Error).message).toMatch(re); }
    };
    reject({ notifications: { quietHours: { timezone: "Nope/Zone" } } }, /Unknown IANA timezone/);
    reject({ notifications: { quietHours: { timezone: "UTC+3" } } }, /Unknown IANA timezone/);
    reject({ notifications: { quietHours: { enabled: true, start: "09:00", end: "09:00" } } }, /same time.*ambiguous/i);
    reject({ notifications: { quietHours: { start: "9:00" } } }, /HH:mm/);
    reject({ notifications: { digestTime: "25:00" } }, /HH:mm/);
    // Disabled equal times are harmless; enabled distinct times are accepted.
    expect(() => patchSettings(db, { notifications: { quietHours: { enabled: false, start: "09:00", end: "09:00" } } }, now)).not.toThrow();
    expect(() => patchSettings(db, { notifications: { quietHours: { enabled: true, start: "21:00", end: "06:00" } } }, now)).not.toThrow();
  });

  it("a stored equal start/end is treated as no quiet hours so a ready commit can never fail on it", () => {
    expect(inQuietHours(quiet("09:00", "09:00"), at("2026-10-24T17:00:00Z"))).toBe(false);
    expect(sched("2026-10-24T17:00:00Z", quiet("09:00", "09:00")).immediate).toBe(true);
  });
});
