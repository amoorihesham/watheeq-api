import type { calendarPeriodOverrides, calendarPeriods } from '@/db/schema/index.js';
import { WEEKDAYS } from '../calendar.constants.js';
import type { CalendarPeriodType, DayRuleType, PeriodOverrideType, WeekShapeType, WeekViewType } from '../calendar.types.js';

type PeriodRowType = typeof calendarPeriods.$inferSelect;
type OverrideRowType = typeof calendarPeriodOverrides.$inferSelect;

const rule = (value: DayRuleType): DayRuleType => (typeof value === 'string' ? value : { start: value.start, end: value.end });

/**
 * A week shape in a fixed key order. `jsonb` stores keys in its own order, so responses and comparisons go
 * through this instead of the stored object.
 */
export function canonicalWeek(week: WeekShapeType): WeekShapeType {
  const days = Object.fromEntries(WEEKDAYS.map((day) => [day, rule(week.days[day])]));
  return { start: week.start, end: week.end, days: days as WeekShapeType['days'] };
}

/** A week shape as clients read it: every weekday is `{mode, start, end}` (Phase 8, R8.4). */
export function weekView(week: WeekShapeType): WeekViewType {
  const days = Object.fromEntries(
    WEEKDAYS.map((day) => {
      const value = week.days[day];
      return [day, typeof value === 'string' ? { mode: value, start: null, end: null } : { mode: 'custom', start: value.start, end: value.end }];
    }),
  );
  return { start: week.start, end: week.end, days: days as WeekViewType['days'] };
}

export const sameWeek = (a: WeekShapeType, b: WeekShapeType) => JSON.stringify(canonicalWeek(a)) === JSON.stringify(canonicalWeek(b));

function toOverride(row: OverrideRowType): PeriodOverrideType {
  if (row.action === 'skip') {
    return { year: row.year, action: 'skip' };
  }
  if (row.startDate === null || row.endDate === null) {
    throw new Error(`override ${row.periodId}/${row.year} has no dates`);
  }
  return { year: row.year, action: 'move', startDate: row.startDate, endDate: row.endDate };
}

/** A stored period version with its adjustments; the table's checks guarantee the columns of its kind. */
export function toCalendarPeriod(row: PeriodRowType, overrides: OverrideRowType[]): CalendarPeriodType {
  const broken = () => new Error(`calendar period ${row.id} does not match its kind`);
  const effect =
    row.kind === 'season'
      ? (() => {
          if (row.week === null || row.rank === null) {
            throw broken();
          }
          return { kind: 'season' as const, week: canonicalWeek(row.week), rank: row.rank };
        })()
      : { kind: 'holiday' as const };
  const base = { id: row.id, name: row.name, ...effect };
  if (row.recurrence === 'once') {
    if (row.startDate === null || row.endDate === null) {
      throw broken();
    }
    return { ...base, recurrence: 'once', startDate: row.startDate, endDate: row.endDate };
  }
  const { startMonth, startDay, endMonth, endDay, validFrom } = row;
  if (startMonth === null || startDay === null || endMonth === null || endDay === null || validFrom === null) {
    throw broken();
  }
  return {
    ...base,
    recurrence: row.recurrence,
    start: { month: startMonth, day: startDay },
    end: { month: endMonth, day: endDay },
    validFrom,
    validUntil: row.validUntil,
    overrides: overrides.filter((o) => o.periodId === row.id).map(toOverride),
  };
}
