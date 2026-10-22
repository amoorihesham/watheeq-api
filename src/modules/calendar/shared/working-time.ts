import { addDays } from "@/modules/subscriptions/index.js";
import { MAX_WORKING_DAY_SEARCH_DAYS } from "../calendar.config.js";
import type { CalendarType, DayHoursType } from "../calendar.types.js";
import { fromRiyadh, toRiyadh } from "./riyadh-time.js";
import { dayHours } from "./week.js";

/** No working day within the search bound: a defect, since validation guarantees working days (P4.12). */
export class CalendarExhaustedError extends Error {
  constructor(from: string) {
    super(`no working day within ${MAX_WORKING_DAY_SEARCH_DAYS} days after ${from}`);
    this.name = "CalendarExhaustedError";
  }
}

interface WorkingDayType {
  date: string;
  hours: DayHoursType;
}

/** A point in working time: a working day and how far through its hours, from 0 to 1. */
interface PositionType extends WorkingDayType {
  fraction: number;
}

// Sums of fractions such as 0.7 + 0.3 must land exactly on whole days.
const snap = (value: number) => Math.round(value * 1e9) / 1e9;

function nextWorkingDay(calendar: CalendarType, after: string): WorkingDayType {
  let date = after;
  for (let i = 0; i < MAX_WORKING_DAY_SEARCH_DAYS; i++) {
    date = addDays(date, 1);
    const hours = dayHours(calendar, date);
    if (hours) {
      return { date, hours };
    }
  }
  throw new CalendarExhaustedError(after);
}

/** Outside working hours, a moment is at the start of the next working day (R4.9). */
function positionOf(calendar: CalendarType, instant: Date): PositionType {
  const { date, ms } = toRiyadh(instant);
  const hours = dayHours(calendar, date);
  if (hours) {
    const fraction = Math.min(1, Math.max(0, (ms - hours.start) / (hours.end - hours.start)));
    return { date, hours, fraction };
  }
  return { ...nextWorkingDay(calendar, date), fraction: 0 };
}

/**
 * `start` plus `days` working days, each counting as one whatever its length (P4.2), with the start's fraction of
 * its day carried over to the target day (P4.3). A result at a day's opening is reported at the previous working
 * day's closing. Rounded down to the minute.
 */
export function addWorkingDays(calendar: CalendarType, start: Date, days: number): Date {
  if (!Number.isFinite(days) || days < 0) {
    throw new RangeError(`days must be a finite number of at least 0, got ${days}`);
  }
  if (days === 0) {
    return start;
  }
  const from = positionOf(calendar, start);
  const total = snap(from.fraction + days);
  let whole = Math.floor(total);
  let fraction = snap(total - whole);
  if (fraction === 0) {
    whole -= 1;
    fraction = 1;
  }
  let day: WorkingDayType = from;
  for (let i = 0; i < whole; i++) {
    day = nextWorkingDay(calendar, day.date);
  }
  const ms = day.hours.start + fraction * (day.hours.end - day.hours.start);
  const result = fromRiyadh(day.date, ms).getTime();
  return new Date(Math.floor(result / 60_000) * 60_000);
}

/** Working time from `from` to `to` in the same day units as `addWorkingDays`; negative when `to` is earlier (R4.10). */
export function workingDaysBetween(calendar: CalendarType, from: Date, to: Date): number {
  if (to < from) {
    return -workingDaysBetween(calendar, to, from);
  }
  const a = positionOf(calendar, from);
  const b = positionOf(calendar, to);
  let whole = 0;
  for (let date = a.date; date < b.date; whole++) {
    date = nextWorkingDay(calendar, date).date;
  }
  return snap(whole + b.fraction - a.fraction);
}
