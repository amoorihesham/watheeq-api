import { and, asc, eq, sql } from "drizzle-orm";
import type { Executor } from "@/db/pool.js";
import { calendarPeriodOverrides, calendarPeriods, workingHours } from "@/db/schema/index.js";
import { riyadhToday } from "@/modules/subscriptions/index.js";
import type { HoursVersionType, WeekShapeType } from "./calendar.types.js";

const hoursColumns = { effectiveFrom: workingHours.effectiveFrom, week: workingHours.week };

const ofVersion = (tenantId: string, effectiveFrom: string) =>
  and(eq(workingHours.tenantId, tenantId), eq(workingHours.effectiveFrom, effectiveFrom));

/** Tenant code: every query is filtered by the caller's tenant (T2). */
export function createCalendarRepository() {
  return {
    /**
     * Serializes every calendar change of one tenant until the transaction ends (P4.10). The key differs from
     * the seat lock's, so a calendar edit never waits for an invitation.
     */
    lock(db: Executor, tenantId: string) {
      return db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`calendar:${tenantId}`}, 0))`,
      );
    },

    today(db: Executor) {
      return db.execute<{ today: string }>(sql`select ${riyadhToday} as today`);
    },

    listHours(db: Executor, tenantId: string): Promise<HoursVersionType[]> {
      return db
        .select(hoursColumns)
        .from(workingHours)
        .where(eq(workingHours.tenantId, tenantId))
        .orderBy(asc(workingHours.effectiveFrom));
    },

    findHours(db: Executor, tenantId: string, effectiveFrom: string): Promise<HoursVersionType[]> {
      return db.select(hoursColumns).from(workingHours).where(ofVersion(tenantId, effectiveFrom));
    },

    upsertHours(
      db: Executor,
      tenantId: string,
      effectiveFrom: string,
      week: WeekShapeType,
    ): Promise<HoursVersionType[]> {
      return db
        .insert(workingHours)
        .values({ tenantId, effectiveFrom, week })
        .onConflictDoUpdate({
          target: [workingHours.tenantId, workingHours.effectiveFrom],
          set: { week, updatedAt: sql`now()` },
        })
        .returning(hoursColumns);
    },

    deleteHours(db: Executor, tenantId: string, effectiveFrom: string) {
      return db.delete(workingHours).where(ofVersion(tenantId, effectiveFrom));
    },

    listPeriods(db: Executor, tenantId: string) {
      return db
        .select()
        .from(calendarPeriods)
        .where(eq(calendarPeriods.tenantId, tenantId))
        .orderBy(asc(calendarPeriods.createdAt), asc(calendarPeriods.id));
    },

    listOverrides(db: Executor, tenantId: string) {
      return db
        .select()
        .from(calendarPeriodOverrides)
        .where(eq(calendarPeriodOverrides.tenantId, tenantId))
        .orderBy(asc(calendarPeriodOverrides.year));
    },
  };
}
