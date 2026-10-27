import { describe, expect, it } from "vitest";
import { validate } from "../src/http/validate.js";
import {
  addWorkingDays,
  CalendarExhaustedError,
  type CalendarPeriodType,
  type CalendarType,
  coversDate,
  dayHours,
  fromRiyadh,
  hijriMonthLength,
  hijriToGregorian,
  occurrenceOf,
  type RecurringPeriodType,
  toHijri,
  toRiyadh,
  type WeekShapeType,
  weekShapeSchema,
  weekView,
  workingDaysBetween,
} from "../src/modules/calendar/index.js";

const riyadh = (local: string) => new Date(`${local}:00+03:00`);
const hours = (start: string, end: string) => ({ start, end });

const sunToThu = (start: string, end: string): WeekShapeType => ({
  start,
  end,
  days: {
    sun: "default",
    mon: "default",
    tue: "default",
    wed: "default",
    thu: "default",
    fri: "off",
    sat: "off",
  },
});

// Al-Noor, as in the spec's section 3. Shorter Thursdays start on 2026-11-01 (R4.3).
const ramadanHours = {
  id: "ramadan",
  name: "Ramadan hours",
  kind: "season",
  rank: 10,
  // Every weekday "default": the season never turns a normal day off into a working one (R4.5).
  week: {
    start: "10:00",
    end: "15:00",
    days: {
      sun: "default",
      mon: "default",
      tue: "default",
      wed: "default",
      thu: "default",
      fri: "default",
      sat: "default",
    },
  },
  recurrence: "hijri",
  start: { month: 9, day: 1 },
  end: { month: 9, day: 30 },
  validFrom: "2026-10-23",
  validUntil: null,
  overrides: [],
} satisfies CalendarPeriodType;

const holiday = (
  id: string,
  recurrence: "gregorian" | "hijri",
  start: [number, number],
  end: [number, number],
): RecurringPeriodType => ({
  id,
  name: id,
  kind: "holiday",
  recurrence,
  start: { month: start[0], day: start[1] },
  end: { month: end[0], day: end[1] },
  validFrom: "2026-10-23",
  validUntil: null,
  overrides: [],
});

const alNoor: CalendarType = {
  hours: [
    { effectiveFrom: "2026-01-10", week: sunToThu("08:00", "16:00") },
    {
      effectiveFrom: "2026-11-01",
      week: {
        ...sunToThu("08:00", "16:00"),
        days: { ...sunToThu("08:00", "16:00").days, thu: hours("08:00", "13:00") },
      },
    },
  ],
  periods: [
    ramadanHours,
    holiday("Founding Day", "gregorian", [2, 22], [2, 22]),
    holiday("Eid al-Fitr", "hijri", [10, 1], [10, 4]),
    holiday("National Day", "gregorian", [9, 23], [9, 23]),
  ],
};

const asTimes = (h: { start: number; end: number } | null) =>
  h && [h.start / 3_600_000, h.end / 3_600_000];

describe("Riyadh time", () => {
  it("converts both ways at UTC+3", () => {
    expect(toRiyadh(new Date("2026-10-24T22:30:00Z"))).toEqual({
      date: "2026-10-25",
      ms: 5_400_000,
    });
    expect(fromRiyadh("2026-10-25", 5_400_000)).toEqual(new Date("2026-10-24T22:30:00Z"));
  });

  it("keeps a fractional millisecond out of the offset", () => {
    expect(fromRiyadh("2026-10-25", 57_599_999.5).toISOString()).toBe("2026-10-25T12:59:59.999Z");
  });
});

describe("Umm al-Qura conversion (P4.6)", () => {
  // Announced Saudi dates: 1 Ramadan, Eid al-Fitr (1 Shawwal), Eid al-Adha (10 Dhu al-Hijjah).
  it.each([
    ["2025-03-01", 1446, 9, 1],
    ["2025-03-30", 1446, 10, 1],
    ["2025-06-06", 1446, 12, 10],
    ["2026-02-18", 1447, 9, 1],
    ["2026-03-20", 1447, 10, 1],
    ["2026-05-27", 1447, 12, 10],
  ])("%s is %i-%i-%i AH, both ways", (date, year, month, day) => {
    expect(toHijri(date)).toEqual({ year, month, day });
    expect(hijriToGregorian(year, month, day)).toBe(date);
  });

  it("knows 29- and 30-day months, and puts day 30 of a 29-day month on its last day", () => {
    expect(hijriMonthLength(1448, 9)).toBe(29);
    expect(hijriMonthLength(1435, 9)).toBe(30);
    expect(hijriToGregorian(1448, 9, 30)).toBe("2027-03-08");
    expect(hijriToGregorian(1435, 9, 30)).toBe("2014-07-27");
  });

  it("returns null outside the Umm al-Qura data instead of an arithmetic guess", () => {
    expect(hijriToGregorian(1601, 1, 1)).toBeNull();
    expect(hijriToGregorian(1299, 12, 1)).toBeNull();
    expect(hijriToGregorian(1600, 1, 1)).not.toBeNull();
  });

  it("finds the first day of every month over two decades", () => {
    for (let year = 1440; year <= 1460; year++) {
      for (let month = 1; month <= 12; month++) {
        const start = hijriToGregorian(year, month, 1);
        expect(start && toHijri(start)).toEqual({ year, month, day: 1 });
      }
    }
  });
});

describe("occurrences (R4.4, R4.7, P4.8)", () => {
  const eid = holiday("Eid al-Fitr", "hijri", [10, 1], [10, 4]);

  it("places Hijri and Gregorian occurrences", () => {
    expect(occurrenceOf(eid, 1448)).toEqual({
      startDate: "2027-03-09",
      endDate: "2027-03-12",
    });
    expect(occurrenceOf(holiday("x", "gregorian", [9, 23], [9, 23]), 2027)).toEqual({
      startDate: "2027-09-23",
      endDate: "2027-09-23",
    });
  });

  it("puts 29 February on the 28th in other years", () => {
    const leap = holiday("leap", "gregorian", [2, 29], [2, 29]);
    expect(coversDate(leap, "2027-02-28")).toBe(true);
    expect(coversDate(leap, "2028-02-28")).toBe(false);
    expect(coversDate(leap, "2028-02-29")).toBe(true);
  });

  it("wraps an end before the start into the next year", () => {
    const newYear = holiday("new year", "gregorian", [12, 30], [1, 2]);
    expect(
      ["2026-12-29", "2026-12-30", "2027-01-02", "2027-01-03"].map((d) => coversDate(newYear, d)),
    ).toEqual([false, true, true, false]);
  });

  it("produces only the occurrences whose computed start lies in the version's validity", () => {
    // Edited on 2028-01-15 to 1-5 Shawwal: the old version ends that day, the new one starts the next.
    const old = { ...eid, validUntil: "2028-01-15" };
    const replacement = {
      ...eid,
      id: "eid-2",
      end: { month: 10, day: 5 },
      validFrom: "2028-01-16",
    };
    expect(occurrenceOf(old, 1448)?.endDate).toBe("2027-03-12");
    expect(occurrenceOf(old, 1449)).toBeNull();
    expect(occurrenceOf(replacement, 1448)).toBeNull();
    expect(occurrenceOf(replacement, 1449)).toEqual({
      startDate: "2028-02-26",
      endDate: "2028-03-01",
    });
    expect(occurrenceOf(eid, 1447)).toBeNull();
  });

  it("applies a moved or skipped year only to that year", () => {
    const moved = {
      ...eid,
      overrides: [
        { year: 1448, action: "move" as const, startDate: "2027-03-10", endDate: "2027-03-13" },
        { year: 1449, action: "skip" as const },
      ],
    };
    expect(coversDate(moved, "2027-03-09")).toBe(false);
    expect(coversDate(moved, "2027-03-13")).toBe(true);
    expect(coversDate(moved, "2028-02-26")).toBe(false);
    expect(occurrenceOf(moved, 1450)).toEqual({
      startDate: "2029-02-14",
      endDate: "2029-02-17",
    });
  });

  it("covers a one-off range inclusively", () => {
    const move: CalendarPeriodType = {
      id: "move",
      name: "office move",
      kind: "holiday",
      recurrence: "once",
      startDate: "2026-12-06",
      endDate: "2026-12-07",
    };
    expect(
      ["2026-12-05", "2026-12-06", "2026-12-07", "2026-12-08"].map((d) => coversDate(move, d)),
    ).toEqual([false, true, true, false]);
  });
});

describe("dayHours (R4.2, R4.3, R4.5, R4.6)", () => {
  it.each([
    ["2026-10-29", [8, 16]], // Thursday before the new version
    ["2026-11-05", [8, 13]], // Thursday after it
    ["2026-10-30", null], // Friday
    ["2027-02-08", [10, 15]], // 1 Ramadan 1448
    ["2027-02-11", [10, 15]], // a Ramadan Thursday: the season's span replaces 08:00-13:00
    ["2027-02-12", null], // a Ramadan Friday stays off
    ["2027-02-22", null], // Founding Day inside Ramadan: the holiday wins
    ["2027-03-08", [10, 15]], // 29 Ramadan, the last day of a 29-day month
    ["2027-03-09", null], // Eid al-Fitr
    ["2027-03-12", null],
    ["2027-03-14", [8, 16]], // back to normal hours
    ["2027-09-23", null], // National Day
    ["2026-01-09", null], // before the tenant's first version
  ])("%s", (date, expected) => {
    expect(asTimes(dayHours(alNoor, date))).toEqual(expected);
  });

  it("lets the higher-ranked season set the hours where seasons overlap", () => {
    const summer: CalendarPeriodType = {
      id: "summer",
      name: "Summer hours",
      kind: "season",
      rank: 5,
      week: sunToThu("07:00", "14:00"),
      recurrence: "gregorian",
      start: { month: 6, day: 1 },
      end: { month: 8, day: 31 },
      validFrom: "2014-01-01",
      validUntil: null,
      overrides: [],
    };
    const calendar: CalendarType = {
      hours: [{ effectiveFrom: "2014-01-01", week: sunToThu("08:00", "16:00") }],
      periods: [summer, { ...ramadanHours, validFrom: "2014-01-01" }],
    };
    expect(asTimes(dayHours(calendar, "2014-06-26"))).toEqual([7, 14]); // summer, before Ramadan 1435
    expect(asTimes(dayHours(calendar, "2014-07-01"))).toEqual([10, 15]); // both: Ramadan ranks higher
    const summerFirst = {
      ...calendar,
      periods: [{ ...summer, rank: 20 }, ...calendar.periods.slice(1)],
    };
    expect(asTimes(dayHours(summerFirst, "2014-07-01"))).toEqual([7, 14]);
  });

  it("lets a season turn a working weekday off, but never a day off into a working one", () => {
    const shortWeek = {
      ...ramadanHours,
      week: { ...ramadanHours.week, days: { ...ramadanHours.week.days, thu: "off" as const } },
    };
    const calendar = { ...alNoor, periods: [shortWeek] };
    expect(dayHours(calendar, "2027-02-11")).toBeNull();
    expect(dayHours(calendar, "2027-02-12")).toBeNull();
  });
});

describe("addWorkingDays (R4.9)", () => {
  it.each([
    ["Sunday 14:00 plus 5 days", "2026-10-25T14:00", 5, "2026-11-01T14:00"],
    ["the last day of Ramadan, 10:30, plus 1 day", "2027-03-08T10:30", 1, "2027-03-14T08:48"],
    ["before opening: reported at that day's closing", "2026-10-25T07:00", 1, "2026-10-25T16:00"],
    ["on a Friday: from Sunday's opening", "2026-10-30T11:00", 1, "2026-11-01T16:00"],
    ["after closing: from the next opening", "2026-10-25T18:00", 1, "2026-10-26T16:00"],
    ["at closing: a full day later", "2026-10-25T16:00", 2, "2026-10-27T16:00"],
    ["R1 at 80% of 5 days", "2026-10-25T14:00", 4, "2026-10-29T14:00"],
    ["a fraction of a day", "2026-10-25T08:00", 0.5, "2026-10-25T12:00"],
    // 0.05 + 15 * 0.93 is 14.000000000000002 in floating point: still a closing, not the next opening.
    ["93% of 15 days from 08:24", "2026-10-25T08:24", 15 * 0.93, "2026-11-11T16:00"],
    ["into a shorter Thursday", "2026-11-04T12:00", 1, "2026-11-05T10:30"],
    ["over Eid and a weekend", "2027-03-08T10:30", 2, "2027-03-15T08:48"],
  ])("%s", (_name, start, days, expected) => {
    expect(addWorkingDays(alNoor, riyadh(start), days)).toEqual(riyadh(expected));
  });

  it("returns the start itself for zero days", () => {
    const start = riyadh("2026-10-30T11:00");
    expect(addWorkingDays(alNoor, start, 0)).toBe(start);
  });

  it("rounds down to the whole minute", () => {
    // 08:00 + 1/7 of 8h = 09:08:34.28...
    expect(addWorkingDays(alNoor, riyadh("2026-10-25T08:00"), 1 / 7)).toEqual(
      riyadh("2026-10-25T09:08"),
    );
  });

  it("rejects a negative or non-finite number of days", () => {
    for (const days of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => addWorkingDays(alNoor, riyadh("2026-10-25T08:00"), days)).toThrow(RangeError);
    }
  });

  it("stops with CalendarExhaustedError when no working day can be found", () => {
    const nothing: CalendarType = { hours: [], periods: [] };
    expect(() => addWorkingDays(nothing, riyadh("2026-10-25T08:00"), 1)).toThrow(
      CalendarExhaustedError,
    );
  });
});

describe("workingDaysBetween (R4.10)", () => {
  const start = riyadh("2026-10-25T14:00");

  it.each([
    ["2026-10-29T08:00", 3.25],
    ["2026-10-25T14:00", 0],
    ["2026-10-25T16:00", 0.25],
    ["2026-10-31T12:00", 4.25], // Saturday: at Sunday's opening
    ["2026-11-01T14:00", 5],
  ])("from Sunday 14:00 to %s is %d", (to, expected) => {
    expect(workingDaysBetween(alNoor, start, riyadh(to))).toBe(expected);
  });

  it("is negative backwards", () => {
    expect(workingDaysBetween(alNoor, riyadh("2026-10-29T08:00"), start)).toBe(-3.25);
  });

  it("measures a Ramadan day and a normal day as one day each", () => {
    expect(workingDaysBetween(alNoor, riyadh("2027-03-08T10:30"), riyadh("2027-03-14T08:48"))).toBe(
      1,
    );
  });

  it("undoes addWorkingDays, up to the minute rounding, from random starts", () => {
    // A fixed-seed generator keeps the test reproducible.
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const from = riyadh("2026-10-01T00:00").getTime();
    const shortestDayMinutes = 5 * 60;
    for (let i = 0; i < 300; i++) {
      const s = new Date(from + Math.floor(random() * 500 * 86_400_000));
      const n = Math.round(random() * 3000) / 100;
      const deadline = addWorkingDays(alNoor, s, n);
      const measured = workingDaysBetween(alNoor, s, deadline);
      expect(measured).toBeLessThanOrEqual(n);
      expect(n - measured).toBeLessThan(1 / shortestDayMinutes);
    }
  });
});

describe("weekShapeSchema (R4.2)", () => {
  const detailsOf = (input: unknown) => {
    try {
      validate(weekShapeSchema, input);
      return [];
    } catch (error) {
      return (error as { details?: unknown }).details;
    }
  };
  // Clients send each weekday as {mode, start, end} (Phase 8, R8.4).
  const body = (week: WeekShapeType) => weekView(week);

  it("accepts a default span with weekday spans and days off, and stores the rules", () => {
    const week = sunToThu("08:00", "16:00");
    const shortThursdays = { ...week, days: { ...week.days, thu: hours("08:00", "13:00") } };
    expect(detailsOf(body(shortThursdays))).toEqual([]);
    expect(validate(weekShapeSchema, body(shortThursdays))).toEqual(shortThursdays);
    expect(detailsOf(body({ ...week, end: "24:00" }))).toEqual([]);
  });

  it("requires start and end for a custom day, and refuses them on a default or off day", () => {
    const days = body(sunToThu("08:00", "16:00")).days;
    expect(
      detailsOf({
        start: "08:00",
        end: "16:00",
        days: { ...days, thu: { mode: "custom", start: "08:00", end: null } },
      }),
    ).toEqual([{ path: "days.thu.end", code: "required" }]);
    expect(
      detailsOf({
        start: "08:00",
        end: "16:00",
        days: { ...days, fri: { mode: "off", start: "08:00", end: null } },
      }),
    ).toEqual([{ path: "days.fri.start", code: "not_allowed" }]);
    expect(
      detailsOf({
        start: "08:00",
        end: "16:00",
        days: { ...days, thu: { mode: "custom", start: "13:00", end: "08:00" } },
      }),
    ).toEqual([{ path: "days.thu.end", code: "end_before_start" }]);
    expect(
      detailsOf({
        start: "08:00",
        end: "16:00",
        days: { ...days, thu: { mode: "short", start: null, end: null } },
      }),
    ).toEqual([{ path: "days.thu.mode", code: "invalid_value" }]);
  });

  it("requires at least one working weekday", () => {
    const allOff = Object.fromEntries(
      ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((day) => [day, "off"]),
    ) as WeekShapeType["days"];
    expect(detailsOf(body({ start: "08:00", end: "16:00", days: allOff }))).toEqual([
      { path: "days", code: "no_working_day" },
    ]);
  });

  it("refuses a span that ends at or before its start, and times outside 00:00-24:00", () => {
    const week = sunToThu("08:00", "16:00");
    expect(detailsOf(body({ ...week, end: "08:00" }))).toEqual([
      { path: "end", code: "end_before_start" },
    ]);
    expect(detailsOf(body({ ...week, start: "24:30" }))).toEqual([
      { path: "start", code: "invalid_format" },
    ]);
  });

  it("requires every weekday and refuses unknown fields", () => {
    const { fri: _fri, ...sixDays } = body(sunToThu("08:00", "16:00")).days;
    expect(detailsOf({ start: "08:00", end: "16:00", days: sixDays })).toEqual([
      { path: "days.fri", code: "invalid_type" },
    ]);
    expect(detailsOf({ ...body(sunToThu("08:00", "16:00")), lunch: "12:00" })).toEqual([
      { path: "lunch", code: "unknown_field" },
    ]);
  });
});
