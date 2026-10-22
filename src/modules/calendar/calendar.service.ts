import { z } from "zod";
import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import { AppError } from "@/http/errors.js";
import { validate } from "@/http/validate.js";
import { addDays } from "@/modules/subscriptions/index.js";
import { MAX_DAYS_AHEAD } from "./calendar.config.js";
import {
  calendarDateSchema,
  calendarQuerySchema,
  dayViewQuerySchema,
  weekShapeSchema,
} from "./calendar.schemas.js";
import type {
  CalendarDaysResponseType,
  CalendarDayType,
  CalendarRepositoryType,
  CalendarResponseType,
  HoursVersionType,
  PeriodViewType,
} from "./calendar.types.js";
import { toHijri } from "./shared/hijri.js";
import { loadCalendar } from "./shared/load.js";
import { nextOccurrence } from "./shared/occurrences.js";
import { msToTime } from "./shared/riyadh-time.js";
import { canonicalWeek, sameWeek, toCalendarPeriod } from "./shared/rows.js";
import { dayHours, holidaysOn, seasonOn } from "./shared/week.js";

const effectiveFromOf = (value: string) =>
  validate(z.object({ effectiveFrom: calendarDateSchema }), { effectiveFrom: value }).effectiveFrom;

/** The past is fixed: a change may affect only dates after today (P4.7, Q10). */
function assertAfterToday(date: string, today: string): void {
  if (date <= today) {
    throw new AppError("CALENDAR_DATE_LOCKED");
  }
}

function assertWithinReach(date: string, today: string, path: string): void {
  if (date > addDays(today, MAX_DAYS_AHEAD)) {
    throw new AppError("VALIDATION_FAILED", [{ path, code: "too_far_ahead" }]);
  }
}

export function createCalendarService({ db, repo }: { db: Db; repo: CalendarRepositoryType }) {
  const todayOf = async (executor: Executor) => (await repo.today(executor)).rows[0]?.today ?? "";

  return {
    /** The rules; versions ended by an edit and one-off periods already over are listed on request. */
    async get(tenantId: string, input: unknown): Promise<CalendarResponseType> {
      const query = validate(calendarQuerySchema, input);
      const [today, hours, rows, overrides] = await Promise.all([
        todayOf(db),
        repo.listHours(db, tenantId),
        repo.listPeriods(db, tenantId),
        repo.listOverrides(db, tenantId),
      ]);
      const periods: PeriodViewType[] = rows
        .map((row) => {
          const period = toCalendarPeriod(row, overrides);
          return { ...period, replacesId: row.replacesId, next: nextOccurrence(period, today) };
        })
        .filter((period) => {
          const ended =
            period.recurrence === "once" ? period.endDate < today : period.validUntil !== null;
          return query.includeEnded === "true" || !ended;
        });
      return {
        today,
        hours: hours.map((version) => ({ ...version, week: canonicalWeek(version.week) })),
        periods,
      };
    },

    /** Each date's Hijri date, hours, holidays, and season (R4.11). */
    async days(tenantId: string, input: unknown): Promise<CalendarDaysResponseType> {
      const { from, to } = validate(dayViewQuerySchema, input);
      const calendar = await loadCalendar(db, tenantId);
      const days: CalendarDayType[] = [];
      for (let date = from; date <= to; date = addDays(date, 1)) {
        const hours = dayHours(calendar, date);
        const season = seasonOn(calendar, date);
        days.push({
          date,
          hijriDate: toHijri(date),
          working: hours !== null,
          ...(hours ? { start: msToTime(hours.start), end: msToTime(hours.end) } : {}),
          holidays: holidaysOn(calendar, date).map(({ id, name }) => ({ id, name })),
          ...(season ? { season: { id: season.id, name: season.name } } : {}),
        });
      }
      return { days };
    },

    /** Creates or replaces the hours version starting after today (R4.3). */
    setHours(
      tenantId: string,
      effectiveFromInput: string,
      input: unknown,
      context: AuditContextType,
    ): Promise<HoursVersionType> {
      const effectiveFrom = effectiveFromOf(effectiveFromInput);
      const week = canonicalWeek(validate(weekShapeSchema, input));
      return withTx(db, async (tx) => {
        await repo.lock(tx, tenantId);
        const today = await todayOf(tx);
        assertAfterToday(effectiveFrom, today);
        assertWithinReach(effectiveFrom, today, "effectiveFrom");
        const [before] = await repo.findHours(tx, tenantId, effectiveFrom);
        if (before && sameWeek(before.week, week)) {
          return { effectiveFrom, week };
        }
        await repo.upsertHours(tx, tenantId, effectiveFrom, week);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "calendar.hours_set",
          resourceType: "working_hours",
          resourceId: effectiveFrom,
          details: {
            effectiveFrom,
            before: before ? canonicalWeek(before.week) : null,
            after: week,
          },
        });
        return { effectiveFrom, week };
      });
    },

    /** Removes a version that is not yet in force; the one in force today never can be (R4.3). */
    deleteHours(
      tenantId: string,
      effectiveFromInput: string,
      context: AuditContextType,
    ): Promise<void> {
      const effectiveFrom = effectiveFromOf(effectiveFromInput);
      return withTx(db, async (tx) => {
        await repo.lock(tx, tenantId);
        const [version] = await repo.findHours(tx, tenantId, effectiveFrom);
        if (!version) {
          throw new AppError("NOT_FOUND");
        }
        assertAfterToday(effectiveFrom, await todayOf(tx));
        await repo.deleteHours(tx, tenantId, effectiveFrom);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "calendar.hours_deleted",
          resourceType: "working_hours",
          resourceId: effectiveFrom,
          details: { effectiveFrom, week: canonicalWeek(version.week) },
        });
      });
    },
  };
}
