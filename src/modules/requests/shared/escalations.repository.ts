import { and, asc, eq, sql } from "drizzle-orm";
import type { Executor } from "@/db/pool.js";
import { dateFromEpochMs } from "@/db/rows.js";
import { requestEscalations, requests } from "@/db/schema/index.js";
import type { EscalationRuleType } from "@/modules/escalation/index.js";
import type { EscalationCandidateRowType, LockedRequestRowType } from "../requests.types.js";

const ms = (column: string) => sql.raw(`(extract(epoch from ${column}) * 1000)::float8`);

type RawCandidateType = {
  tenant_id: string;
  id: string;
  year: number;
  number: number;
  title: string;
  state: "in_review" | "in_progress";
  submitted_ms: number;
  accepted_ms: number | null;
  priority_days: number;
  r0_enabled: boolean;
  r0_days: number;
  r1_enabled: boolean;
  r1_percent: number;
  r2_enabled: boolean;
  r0_fired: boolean;
  r1_fired: boolean;
  r2_fired: boolean;
};

export function createEscalationsRepository() {
  return {
    /** The database clock, read once per run (Phase 7 spec, 4.3). */
    async now(db: Executor): Promise<Date> {
      const { rows } = await db.execute<{ ms: number }>(sql`select ${ms("now()")} as ms`);
      return dateFromEpochMs(rows[0]?.ms ?? 0);
    },

    /**
     * Open requests of configured tenants where a rule that is on has not fired: R0 in review, R1 in progress with
     * neither R1 nor R2 fired, R2 in progress. Whether each is due is decided in memory, from the tenant's calendar.
     */
    async candidates(db: Executor): Promise<EscalationCandidateRowType[]> {
      const fired = (rule: EscalationRuleType) =>
        sql`exists (select 1 from request_escalations e where e.request_id = r.id and e.rule = ${rule})`;
      const { rows } = await db.execute<RawCandidateType>(sql`
        select r.tenant_id, r.id, r.year, r.number, r.title, r.state,
          ${ms("r.submitted_at")} as submitted_ms, ${ms("r.accepted_at")} as accepted_ms, r.priority_days,
          s.r0_enabled, s.r0_days, s.r1_enabled, s.r1_percent, s.r2_enabled,
          ${fired("r0")} as r0_fired, ${fired("r1")} as r1_fired, ${fired("r2")} as r2_fired
        from requests r
        join escalation_settings s on s.tenant_id = r.tenant_id
        where (r.state = 'in_review' and s.r0_enabled and not ${fired("r0")})
          or (r.state = 'in_progress' and s.r1_enabled and not ${fired("r1")} and not ${fired("r2")})
          or (r.state = 'in_progress' and s.r2_enabled and not ${fired("r2")})
        order by r.tenant_id, r.submitted_at, r.id`);
      return rows.map((row) => ({
        tenantId: row.tenant_id,
        id: row.id,
        year: row.year,
        number: row.number,
        title: row.title,
        state: row.state,
        submittedAt: dateFromEpochMs(row.submitted_ms),
        acceptedAt: dateFromEpochMs(row.accepted_ms),
        priorityDays: row.priority_days,
        r0: { enabled: row.r0_enabled, days: row.r0_days, fired: row.r0_fired },
        r1: { enabled: row.r1_enabled, percent: row.r1_percent, fired: row.r1_fired },
        r2: { enabled: row.r2_enabled, fired: row.r2_fired },
      }));
    },

    /** Locks the request unless someone else holds it (`SKIP LOCKED`); no row means "skip it until the next run". */
    lockForFiring(
      db: Executor,
      tenantId: string,
      requestId: string,
    ): Promise<LockedRequestRowType[]> {
      return db
        .select({
          id: requests.id,
          tenantId: requests.tenantId,
          year: requests.year,
          number: requests.number,
          title: requests.title,
          state: requests.state,
          requesterId: requests.requesterId,
          handlerId: requests.handlerId,
        })
        .from(requests)
        .where(and(eq(requests.tenantId, tenantId), eq(requests.id, requestId)))
        .for("update", { of: requests, skipLocked: true });
    },

    /** One row per rule per request; no row back means another process fired it. */
    insertFiring(
      db: Executor,
      values: { tenantId: string; requestId: string; rule: EscalationRuleType; dueAt: Date },
    ): Promise<{ rule: EscalationRuleType }[]> {
      return db
        .insert(requestEscalations)
        .values(values)
        .onConflictDoNothing()
        .returning({ rule: requestEscalations.rule });
    },

    /** The rules that fired on a request, in the order they fired. */
    firingsOf(
      db: Executor,
      tenantId: string,
      requestId: string,
    ): Promise<{ rule: EscalationRuleType; dueAt: Date; firedAt: Date }[]> {
      return db
        .select({
          rule: requestEscalations.rule,
          dueAt: requestEscalations.dueAt,
          firedAt: requestEscalations.firedAt,
        })
        .from(requestEscalations)
        .where(
          and(
            eq(requestEscalations.tenantId, tenantId),
            eq(requestEscalations.requestId, requestId),
          ),
        )
        .orderBy(asc(requestEscalations.firedAt), asc(requestEscalations.rule));
    },
  };
}
