import type { ErrorDetail } from "@/http/errors.js";
import { addDays } from "@/modules/subscriptions/index.js";
import { MAX_PERIOD_DAYS } from "../calendar.constants.js";
import type {
  CalendarPeriodType,
  MonthDayType,
  RecurringPeriodType,
  WeekShapeType,
} from "../calendar.types.js";
import { toHijri } from "./hijri.js";
import { occurrenceOf } from "./occurrences.js";
import { daysBetweenDates } from "./riyadh-time.js";
import { canonicalWeek } from "./rows.js";

/** A period's definition with every field present, null where its kind or recurrence has none. */
export interface PeriodDefinitionType {
  kind: "holiday" | "season";
  name: string;
  recurrence: "once" | "gregorian" | "hijri";
  startDate: string | null;
  endDate: string | null;
  start: MonthDayType | null;
  end: MonthDayType | null;
  week: WeekShapeType | null;
  rank: number | null;
}

export function definitionOf(period: CalendarPeriodType): PeriodDefinitionType {
  const once = period.recurrence === "once";
  const season = period.kind === "season";
  return {
    kind: period.kind,
    name: period.name,
    recurrence: period.recurrence,
    startDate: once ? period.startDate : null,
    endDate: once ? period.endDate : null,
    start: once ? null : period.start,
    end: once ? null : period.end,
    week: season ? canonicalWeek(period.week) : null,
    rank: season ? period.rank : null,
  };
}

export const sameDefinition = (a: PeriodDefinitionType, b: PeriodDefinitionType) =>
  JSON.stringify(a) === JSON.stringify(b);

const isBefore = (a: MonthDayType, b: MonthDayType) =>
  a.month < b.month || (a.month === b.month && a.day < b.day);

const pad = (n: number) => String(n).padStart(2, "0");

/** Days in a Gregorian month of a leap year, so 29 February is allowed. */
const leapMonthDays = (month: number) => new Date(Date.UTC(2028, month, 0)).getUTCDate();

/**
 * The longest any occurrence can be: one-off ranges exactly, Gregorian rules in a leap year, Hijri rules with
 * every month at 30 days.
 */
function longestDays(def: PeriodDefinitionType): number {
  if (def.recurrence === "once") {
    return daysBetweenDates(def.startDate ?? "", def.endDate ?? "") + 1;
  }
  const start = def.start ?? { month: 1, day: 1 };
  const end = def.end ?? start;
  const wraps = isBefore(end, start);
  if (def.recurrence === "hijri") {
    return (end.month - start.month + (wraps ? 12 : 0)) * 30 + end.day - start.day + 1;
  }
  const endYear = wraps ? 2029 : 2028;
  const endDay = Math.min(end.day, new Date(Date.UTC(endYear, end.month, 0)).getUTCDate());
  return (
    daysBetweenDates(
      `2028-${pad(start.month)}-${pad(start.day)}`,
      `${endYear}-${pad(end.month)}-${pad(endDay)}`,
    ) + 1
  );
}

/** What is wrong with a whole definition, created or produced by an edit (R4.4, R4.5, P4.12). */
export function definitionProblems(def: PeriodDefinitionType): ErrorDetail[] {
  const once = def.recurrence === "once";
  const season = def.kind === "season";
  const needed: [keyof PeriodDefinitionType, boolean][] = [
    ["startDate", once],
    ["endDate", once],
    ["start", !once],
    ["end", !once],
    ["week", season],
    ["rank", season],
  ];
  const problems: ErrorDetail[] = needed.flatMap(([path, need]): ErrorDetail[] => {
    const present = def[path] !== null;
    if (need && !present) {
      return [{ path, code: "required" }];
    }
    return !need && present ? [{ path, code: "not_allowed" }] : [];
  });
  if (problems.length > 0) {
    return problems;
  }
  if (once && (def.endDate ?? "") < (def.startDate ?? "")) {
    return [{ path: "endDate", code: "end_before_start" }];
  }
  if (!once) {
    const maxDay = (month: number) => (def.recurrence === "hijri" ? 30 : leapMonthDays(month));
    for (const path of ["start", "end"] as const) {
      const monthDay = def[path];
      if (monthDay && monthDay.day > maxDay(monthDay.month)) {
        problems.push({ path: `${path}.day`, code: "invalid_day" });
      }
    }
    if (problems.length > 0) {
      return problems;
    }
  }
  return longestDays(def) > MAX_PERIOD_DAYS[def.kind]
    ? [{ path: once ? "endDate" : "end", code: "period_too_long" }]
    : [];
}

/** The year a date falls in, in the period's own calendar. */
export const ownYearOf = (period: RecurringPeriodType, date: string) =>
  period.recurrence === "hijri" ? toHijri(date).year : Number(date.slice(0, 4));

/** True when an occurrence of this version, after adjustments, has started on or before today (R4.8). */
export function hasBegun(period: RecurringPeriodType, today: string): boolean {
  const years = new Set(period.overrides.map((o) => o.year));
  for (
    let year = ownYearOf(period, period.validFrom) - 1;
    year <= ownYearOf(period, today);
    year++
  ) {
    years.add(year);
  }
  return [...years].some((year) => {
    const occurrence = occurrenceOf(period, year);
    return occurrence !== null && occurrence.startDate <= today;
  });
}

/** The occurrence a rule computes for `year` before any adjustment, within its validity. */
export const computedOccurrence = (period: RecurringPeriodType, year: number) =>
  occurrenceOf({ ...period, overrides: [] }, year);

export const tomorrowOf = (today: string) => addDays(today, 1);
