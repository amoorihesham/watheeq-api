import { z } from 'zod';
import { type AuditContextType, writeAuditEntry } from '@/audit/index.js';
import type { Db, Executor } from '@/db/pool.js';
import { withTx } from '@/db/tx.js';
import { AppError } from '@/http/errors.js';
import { validate } from '@/http/validate.js';
import { addDays } from '@/modules/subscriptions/index.js';
import { MAX_DAYS_AHEAD, MAX_PERIOD_DAYS } from './calendar.constants.js';
import { calendarDateSchema, overrideYearSchema } from './calendar.schemas.js';
import type {
  CalendarDaysResponseType,
  CalendarPeriodType,
  CalendarQueryType,
  CalendarRepositoryType,
  CalendarResponseType,
  CreatePeriodRequestType,
  DayViewQueryType,
  HoursVersionResponseType,
  PeriodOverrideRequestType,
  PeriodOverrideType,
  PeriodViewType,
  RecurringPeriodType,
  UpdatePeriodRequestType,
  WeekShapeInputType,
} from './calendar.types.js';
import { toHijri } from './shared/hijri.js';
import { loadCalendar } from './shared/load.js';
import { nextOccurrence } from './shared/occurrences.js';
import { toPeriodResponse } from './shared/period-response.js';
import { computedOccurrence, definitionOf, definitionProblems, hasBegun, type PeriodDefinitionType, sameDefinition, tomorrowOf } from './shared/period-rules.js';
import { daysBetweenDates, msToTime } from './shared/riyadh-time.js';
import { canonicalWeek, sameWeek, toCalendarPeriod, weekView } from './shared/rows.js';
import { dayHours, holidaysOn, seasonOn } from './shared/week.js';

const effectiveFromOf = (value: string) => validate(z.object({ effectiveFrom: calendarDateSchema }), { effectiveFrom: value }).effectiveFrom;

/** The past is fixed: a change may affect only dates after today (P4.7, Q10). */
function assertAfterToday(date: string, today: string): void {
  if (date <= today) {
    throw new AppError('CALENDAR_DATE_LOCKED');
  }
}

const yearOf = (value: string) => validate(overrideYearSchema, { year: value }).year;

function assertDefinition(def: PeriodDefinitionType): void {
  const problems = definitionProblems(def);
  if (problems.length > 0) {
    throw new AppError('VALIDATION_FAILED', problems);
  }
}

const isEnded = (period: CalendarPeriodType) => period.recurrence !== 'once' && period.validUntil !== null;

/** Whether a season still decides hours from today on, for the rank rule (Q9). */
const inForce = (period: CalendarPeriodType, today: string) => (period.recurrence === 'once' ? period.endDate >= today : period.validUntil === null);

const rowValues = (def: PeriodDefinitionType) => ({
  kind: def.kind,
  name: def.name,
  recurrence: def.recurrence,
  startDate: def.startDate,
  endDate: def.endDate,
  startMonth: def.start?.month ?? null,
  startDay: def.start?.day ?? null,
  endMonth: def.end?.month ?? null,
  endDay: def.end?.day ?? null,
  week: def.week,
  rank: def.rank,
});

/** The adjustments of occurrences that have not begun, which move to a replacement version (P4.8). */
const futureOverrideYears = (period: RecurringPeriodType, today: string) =>
  period.overrides
    .filter((override) => {
      const computed = computedOccurrence(period, override.year);
      const movedStart = override.action === 'move' ? override.startDate : null;
      return (computed === null || computed.startDate > today) && (movedStart ?? '9999') > today;
    })
    .map((override) => override.year);

/**
 * An adjustment applies to a version still in force, for a year it has an occurrence in, and only while that
 * occurrence (as computed, and as currently moved) has not begun (P4.7).
 */
function assertOverridable(period: CalendarPeriodType, year: number, today: string) {
  if (period.recurrence === 'once') {
    throw new AppError('VALIDATION_FAILED', [{ path: 'periodId', code: 'not_recurring' }]);
  }
  if (isEnded(period)) {
    throw new AppError('CALENDAR_PERIOD_ENDED');
  }
  const computed = computedOccurrence(period, year);
  if (computed === null) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'year', code: 'no_occurrence' }]);
  }
  const before = period.overrides.find((o) => o.year === year);
  assertAfterToday(computed.startDate, today);
  if (before?.action === 'move') {
    assertAfterToday(before.startDate, today);
  }
  return { before };
}

function assertWithinReach(date: string, today: string, path: string): void {
  if (date > addDays(today, MAX_DAYS_AHEAD)) {
    throw new AppError('VALIDATION_FAILED', [{ path, code: 'too_far_ahead' }]);
  }
}

export function createCalendarService({ db, repo }: { db: Db; repo: CalendarRepositoryType }) {
  const todayOf = async (executor: Executor) => (await repo.today(executor)).rows[0]?.today ?? '';

  async function viewsOf(executor: Executor, tenantId: string, today: string) {
    const [rows, overrides] = await Promise.all([repo.listPeriods(executor, tenantId), repo.listOverrides(executor, tenantId)]);
    return rows.map((row): PeriodViewType => {
      const period = toCalendarPeriod(row, overrides);
      return { ...period, replacesId: row.replacesId, next: nextOccurrence(period, today) };
    });
  }

  async function viewOf(executor: Executor, tenantId: string, periodId: string, today: string) {
    const view = (await viewsOf(executor, tenantId, today)).find((p) => p.id === periodId);
    if (!view) {
      throw new AppError('NOT_FOUND');
    }
    return view;
  }

  /** Seasons in force have distinct ranks, so overlapping seasons always have a winner (Q9). */
  function assertRankFree(def: PeriodDefinitionType, others: PeriodViewType[], today: string, except: string): void {
    const taken = others.some((p) => p.id !== except && p.kind === 'season' && p.rank === def.rank && inForce(p, today));
    if (def.kind === 'season' && taken) {
      throw new AppError('VALIDATION_FAILED', [{ path: 'rank', code: 'rank_taken' }]);
    }
  }

  /** Locks the calendar, reads today, and loads one period version with its adjustments. */
  async function lockAndLoad(tx: Executor, tenantId: string, periodId: string) {
    await repo.lock(tx, tenantId);
    const today = await todayOf(tx);
    const views = await viewsOf(tx, tenantId, today);
    const period = views.find((p) => p.id === periodId);
    if (!period) {
      throw new AppError('NOT_FOUND');
    }
    return { today, views, period };
  }

  return {
    /** The rules; versions ended by an edit and one-off periods already over are listed on request. */
    async get(tenantId: string, query: CalendarQueryType): Promise<CalendarResponseType> {
      const today = await todayOf(db);
      const [hours, views] = await Promise.all([repo.listHours(db, tenantId), viewsOf(db, tenantId, today)]);
      const periods = views.filter((period) => query.includeEnded === 'true' || inForce(period, today));
      return {
        today,
        hours: hours.map((version) => ({ ...version, week: weekView(version.week) })),
        periods: periods.map(toPeriodResponse),
      };
    },

    /** Each date's Hijri date, hours, holidays, and season (R4.11). */
    async days(tenantId: string, { from, to }: DayViewQueryType): Promise<CalendarDaysResponseType> {
      const calendar = await loadCalendar(db, tenantId);
      const days: CalendarDaysResponseType['days'] = [];
      for (let date = from; date <= to; date = addDays(date, 1)) {
        const hours = dayHours(calendar, date);
        const season = seasonOn(calendar, date);
        days.push({
          date,
          hijriDate: toHijri(date),
          working: hours !== null,
          start: hours ? msToTime(hours.start) : null,
          end: hours ? msToTime(hours.end) : null,
          holidays: holidaysOn(calendar, date).map(({ id, name }) => ({ id, name })),
          season: season ? { id: season.id, name: season.name } : null,
        });
      }
      return { from, to, days };
    },

    /** Creates or replaces the hours version starting after today (R4.3). */
    setHours(tenantId: string, effectiveFromInput: string, shape: WeekShapeInputType, context: AuditContextType): Promise<HoursVersionResponseType> {
      const effectiveFrom = effectiveFromOf(effectiveFromInput);
      const week = canonicalWeek(shape);
      return withTx(db, async (tx) => {
        await repo.lock(tx, tenantId);
        const today = await todayOf(tx);
        assertAfterToday(effectiveFrom, today);
        assertWithinReach(effectiveFrom, today, 'effectiveFrom');
        const [before] = await repo.findHours(tx, tenantId, effectiveFrom);
        if (before && sameWeek(before.week, week)) {
          return { effectiveFrom, week: weekView(week) };
        }
        await repo.upsertHours(tx, tenantId, effectiveFrom, week);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: 'calendar.hours_set',
          resourceType: 'working_hours',
          resourceId: effectiveFrom,
          details: {
            effectiveFrom,
            before: before ? canonicalWeek(before.week) : null,
            after: week,
          },
        });
        return { effectiveFrom, week: weekView(week) };
      });
    },

    /** Removes a version that is not yet in force; the one in force today never can be (R4.3). */
    deleteHours(tenantId: string, effectiveFromInput: string, context: AuditContextType): Promise<void> {
      const effectiveFrom = effectiveFromOf(effectiveFromInput);
      return withTx(db, async (tx) => {
        await repo.lock(tx, tenantId);
        const [version] = await repo.findHours(tx, tenantId, effectiveFrom);
        if (!version) {
          throw new AppError('NOT_FOUND');
        }
        assertAfterToday(effectiveFrom, await todayOf(tx));
        await repo.deleteHours(tx, tenantId, effectiveFrom);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: 'calendar.hours_deleted',
          resourceType: 'working_hours',
          resourceId: effectiveFrom,
          details: { effectiveFrom, week: canonicalWeek(version.week) },
        });
      });
    },

    /** Adds a holiday or season (R4.4, R4.5); a recurring one applies from tomorrow (P4.8). */
    create(tenantId: string, body: CreatePeriodRequestType, context: AuditContextType): Promise<PeriodViewType> {
      const def: PeriodDefinitionType = {
        kind: body.kind,
        name: body.name,
        recurrence: body.recurrence,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        start: body.start ?? null,
        end: body.end ?? null,
        week: body.week ? canonicalWeek(body.week) : null,
        rank: body.rank ?? null,
      };
      assertDefinition(def);
      return withTx(db, async (tx) => {
        await repo.lock(tx, tenantId);
        const today = await todayOf(tx);
        if (def.startDate !== null) {
          assertAfterToday(def.startDate, today);
          assertWithinReach(def.startDate, today, 'startDate');
        }
        assertRankFree(def, await viewsOf(tx, tenantId, today), today, '');
        const [row] = await repo.insertPeriod(tx, {
          tenantId,
          ...rowValues(def),
          validFrom: def.recurrence === 'once' ? null : tomorrowOf(today),
        });
        if (!row) {
          throw new Error('insert returned no row');
        }
        const view = await viewOf(tx, tenantId, row.id, today);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: 'calendar.period_created',
          resourceType: 'calendar_period',
          resourceId: row.id,
          details: { ...def, validFrom: row.validFrom },
        });
        return view;
      });
    },

    /**
     * Changes a period for the future only (R4.8). A version none of whose occurrences has begun is edited in
     * place; otherwise it is ended today and replaced from tomorrow, taking the adjustments of later years
     * along (P4.8). The response then carries the replacement's new ID.
     */
    update(tenantId: string, periodId: string, body: UpdatePeriodRequestType, context: AuditContextType): Promise<PeriodViewType> {
      return withTx(db, async (tx) => {
        const { today, views, period } = await lockAndLoad(tx, tenantId, periodId);
        if (isEnded(period)) {
          throw new AppError('CALENDAR_PERIOD_ENDED');
        }
        const before = definitionOf(period);
        const after: PeriodDefinitionType = {
          ...before,
          name: body.name ?? before.name,
          startDate: body.startDate ?? before.startDate,
          endDate: body.endDate ?? before.endDate,
          start: body.start ?? before.start,
          end: body.end ?? before.end,
          week: body.week ? canonicalWeek(body.week) : before.week,
          rank: body.rank ?? before.rank,
        };
        assertDefinition(after);
        if (sameDefinition(before, after)) {
          return period;
        }
        assertRankFree(after, views, today, periodId);
        const audit = (resourceId: string, replacedId: string | null) =>
          writeAuditEntry(tx, {
            tenantId,
            ...context,
            action: 'calendar.period_updated',
            resourceType: 'calendar_period',
            resourceId,
            details: { before, after, replacedId },
          });

        if (period.recurrence === 'once') {
          assertAfterToday(period.startDate, today);
          assertAfterToday(after.startDate ?? '', today);
          assertWithinReach(after.startDate ?? '', today, 'startDate');
          await repo.updatePeriod(tx, tenantId, periodId, rowValues(after));
          await audit(periodId, null);
          return viewOf(tx, tenantId, periodId, today);
        }
        if (!hasBegun(period, today)) {
          // Nothing has happened yet, but the version must not reach back before tomorrow either.
          const validFrom = period.validFrom > today ? period.validFrom : tomorrowOf(today);
          await repo.updatePeriod(tx, tenantId, periodId, { ...rowValues(after), validFrom });
          await audit(periodId, null);
          return viewOf(tx, tenantId, periodId, today);
        }
        await repo.updatePeriod(tx, tenantId, periodId, { validUntil: today });
        const [replacement] = await repo.insertPeriod(tx, {
          tenantId,
          ...rowValues(after),
          validFrom: tomorrowOf(today),
          replacesId: periodId,
        });
        if (!replacement) {
          throw new Error('insert returned no row');
        }
        await repo.moveOverrides(tx, tenantId, periodId, futureOverrideYears(period, today), replacement.id);
        await audit(replacement.id, periodId);
        return viewOf(tx, tenantId, replacement.id, today);
      });
    },

    /** Removes a period that has not begun, or ends one that has; days up to today keep it (R4.8). */
    delete(tenantId: string, periodId: string, context: AuditContextType): Promise<void> {
      return withTx(db, async (tx) => {
        const { today, period } = await lockAndLoad(tx, tenantId, periodId);
        if (isEnded(period)) {
          throw new AppError('CALENDAR_PERIOD_ENDED');
        }
        let ended = false;
        if (period.recurrence === 'once') {
          assertAfterToday(period.startDate, today);
          await repo.deletePeriod(tx, tenantId, periodId);
        } else if (hasBegun(period, today)) {
          await repo.updatePeriod(tx, tenantId, periodId, { validUntil: today });
          await repo.moveOverrides(tx, tenantId, periodId, futureOverrideYears(period, today), null);
          ended = true;
        } else {
          await repo.deletePeriod(tx, tenantId, periodId);
        }
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: 'calendar.period_deleted',
          resourceType: 'calendar_period',
          resourceId: periodId,
          details: { definition: definitionOf(period), ended },
        });
      });
    },

    /** Moves or skips one year's occurrence of a recurring period, before it begins (R4.7). */
    setOverride(tenantId: string, periodId: string, yearInput: string, after: PeriodOverrideRequestType, context: AuditContextType): Promise<PeriodViewType> {
      const year = yearOf(yearInput);
      return withTx(db, async (tx) => {
        const { today, period } = await lockAndLoad(tx, tenantId, periodId);
        const { before } = assertOverridable(period, year, today);
        if (after.action === 'move') {
          if (after.endDate < after.startDate) {
            throw new AppError('VALIDATION_FAILED', [{ path: 'endDate', code: 'end_before_start' }]);
          }
          if (daysBetweenDates(after.startDate, after.endDate) + 1 > MAX_PERIOD_DAYS[period.kind]) {
            throw new AppError('VALIDATION_FAILED', [{ path: 'endDate', code: 'period_too_long' }]);
          }
          assertAfterToday(after.startDate, today);
          assertWithinReach(after.startDate, today, 'startDate');
        }
        const next: PeriodOverrideType = { year, ...after };
        if (JSON.stringify(before) === JSON.stringify(next)) {
          return period;
        }
        await repo.upsertOverride(tx, {
          tenantId,
          periodId,
          year,
          action: after.action,
          startDate: after.action === 'move' ? after.startDate : null,
          endDate: after.action === 'move' ? after.endDate : null,
        });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: 'calendar.override_set',
          resourceType: 'calendar_period',
          resourceId: periodId,
          details: { year, before: before ?? null, after: next },
        });
        return viewOf(tx, tenantId, periodId, today);
      });
    },

    /** Returns one year's occurrence to the rule, before it begins (R4.7). */
    deleteOverride(tenantId: string, periodId: string, yearInput: string, context: AuditContextType): Promise<void> {
      const year = yearOf(yearInput);
      return withTx(db, async (tx) => {
        const { today, period } = await lockAndLoad(tx, tenantId, periodId);
        const { before } = assertOverridable(period, year, today);
        if (!before) {
          throw new AppError('NOT_FOUND');
        }
        await repo.deleteOverride(tx, tenantId, periodId, year);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: 'calendar.override_deleted',
          resourceType: 'calendar_period',
          resourceId: periodId,
          details: { year, override: before },
        });
      });
    },
  };
}
