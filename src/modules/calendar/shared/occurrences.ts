import type {
  CalendarPeriodType,
  DateRangeType,
  MonthDayType,
  RecurringPeriodType,
} from "../calendar.types.js";
import { hijriToGregorian, toHijri } from "./hijri.js";

function gregorianDate(year: number, { month, day }: MonthDayType): string {
  // 29 February falls on the 28th in other years.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(Math.min(day, lastDay))}`;
}

function place(period: RecurringPeriodType, year: number, monthDay: MonthDayType): string | null {
  return period.recurrence === "hijri"
    ? hijriToGregorian(year, monthDay.month, monthDay.day)
    : gregorianDate(year, monthDay);
}

const isBefore = (a: MonthDayType, b: MonthDayType) =>
  a.month < b.month || (a.month === b.month && a.day < b.day);

/**
 * The occurrence of `year` (in the period's own calendar), after its adjustment, or null. A version owns the
 * occurrences whose computed start lies in its validity (P4.8); an end before the start wraps into the next year.
 */
export function occurrenceOf(period: RecurringPeriodType, year: number): DateRangeType | null {
  const startDate = place(period, year, period.start);
  const endDate = place(period, isBefore(period.end, period.start) ? year + 1 : year, period.end);
  if (startDate === null || endDate === null) {
    return null;
  }
  if (
    startDate < period.validFrom ||
    (period.validUntil !== null && startDate > period.validUntil)
  ) {
    return null;
  }
  const override = period.overrides.find((o) => o.year === year);
  if (override === undefined) {
    return { startDate, endDate };
  }
  return override.action === "skip"
    ? null
    : { startDate: override.startDate, endDate: override.endDate };
}

export function coversDate(period: CalendarPeriodType, date: string): boolean {
  if (period.recurrence === "once") {
    return period.startDate <= date && date <= period.endDate;
  }
  const year = period.recurrence === "hijri" ? toHijri(date).year : Number(date.slice(0, 4));
  // The previous year's occurrence may wrap into this one, and a moved occurrence may lie anywhere.
  const years = new Set([year - 1, year, ...period.overrides.map((o) => o.year)]);
  for (const candidate of years) {
    const occurrence = occurrenceOf(period, candidate);
    if (occurrence && occurrence.startDate <= date && date <= occurrence.endDate) {
      return true;
    }
  }
  return false;
}

/** The first occurrence that has not ended by `today`, after adjustments, or null. */
export function nextOccurrence(period: CalendarPeriodType, today: string): DateRangeType | null {
  if (period.recurrence === "once") {
    return period.endDate >= today
      ? { startDate: period.startDate, endDate: period.endDate }
      : null;
  }
  const year = period.recurrence === "hijri" ? toHijri(today).year : Number(today.slice(0, 4));
  for (let candidate = year - 1; candidate <= year + 2; candidate++) {
    const occurrence = occurrenceOf(period, candidate);
    if (occurrence && occurrence.endDate >= today) {
      return occurrence;
    }
  }
  return null;
}
