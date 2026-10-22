import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Executor, Tx } from "@/db/pool.js";
import { DEFAULT_WEEK } from "../calendar.config.js";
import { createCalendarRepository } from "../calendar.repository.js";
import type { CalendarType } from "../calendar.types.js";
import { canonicalWeek, toCalendarPeriod } from "./rows.js";

const repo = createCalendarRepository();

/**
 * Everything the working-time functions need about one tenant: every hours version and every period version
 * with its adjustments, ended ones included, so past dates are answered by the rules that applied then (P4.8).
 */
export async function loadCalendar(db: Executor, tenantId: string): Promise<CalendarType> {
  const [hours, periods, overrides] = await Promise.all([
    repo.listHours(db, tenantId),
    repo.listPeriods(db, tenantId),
    repo.listOverrides(db, tenantId),
  ]);
  return {
    hours: hours.map((version) => ({ ...version, week: canonicalWeek(version.week) })),
    periods: periods.map((row) => toCalendarPeriod(row, overrides)),
  };
}

/** A new tenant's calendar: the default normal hours from `effectiveFrom`, audited (R4.1). */
export async function insertDefaultHours(
  tx: Tx,
  tenantId: string,
  effectiveFrom: string,
  context: AuditContextType,
): Promise<void> {
  await repo.upsertHours(tx, tenantId, effectiveFrom, DEFAULT_WEEK);
  await writeAuditEntry(tx, {
    tenantId,
    ...context,
    action: "calendar.hours_set",
    resourceType: "working_hours",
    resourceId: effectiveFrom,
    details: { effectiveFrom, before: null, after: DEFAULT_WEEK },
  });
}
