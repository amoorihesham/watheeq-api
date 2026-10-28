import { WEEKDAYS } from '../calendar.constants.js';
import type { CalendarPeriodType, CalendarType, DayHoursType, SpanType, WeekShapeType } from '../calendar.types.js';
import { coversDate } from './occurrences.js';
import { timeToMs, weekdayIndexOf } from './riyadh-time.js';

function spanOn(week: WeekShapeType, date: string): SpanType | null {
  const rule = week.days[WEEKDAYS[weekdayIndexOf(date)] ?? 'sun'];
  if (rule === 'off') {
    return null;
  }
  return rule === 'default' ? week : rule;
}

/** The version with the latest `effectiveFrom` on or before `date`. */
function versionOn(calendar: CalendarType, date: string): WeekShapeType | null {
  let found: { effectiveFrom: string; week: WeekShapeType } | null = null;
  for (const version of calendar.hours) {
    if (version.effectiveFrom <= date && (!found || version.effectiveFrom > found.effectiveFrom)) {
      found = version;
    }
  }
  return found?.week ?? null;
}

/** The holidays covering `date`, working day or not. */
export const holidaysOn = (calendar: CalendarType, date: string): CalendarPeriodType[] => calendar.periods.filter((p) => p.kind === 'holiday' && coversDate(p, date));

/** The highest-ranked season covering `date` (P4.9), whether or not the date is a working day. */
export function seasonOn(calendar: CalendarType, date: string) {
  let top: Extract<CalendarPeriodType, { kind: 'season' }> | null = null;
  for (const period of calendar.periods) {
    if (period.kind === 'season' && (!top || period.rank > top.rank) && coversDate(period, date)) {
      top = period;
    }
  }
  return top;
}

/**
 * A date's working hours, or null when it is not a working day (R4.6): off under the normal hours or a holiday
 * wins, then the highest-ranked season, then the normal hours. Before the tenant's first version nothing works.
 */
export function dayHours(calendar: CalendarType, date: string): DayHoursType | null {
  const week = versionOn(calendar, date);
  const normal = week && spanOn(week, date);
  if (!normal) {
    return null;
  }
  if (calendar.periods.some((p) => p.kind === 'holiday' && coversDate(p, date))) {
    return null;
  }
  const season = seasonOn(calendar, date);
  const span = season ? spanOn(season.week, date) : normal;
  return span && { start: timeToMs(span.start), end: timeToMs(span.end) };
}
