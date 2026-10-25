import type { Tx } from "@/db/pool.js";
import {
  addWorkingDays,
  type CalendarType,
  loadCalendar,
  workingDaysBetween,
} from "@/modules/calendar/index.js";
import { createRequestsRepository } from "../requests.repository.js";
import type { RequestRowType, SlaSourceType, SlaType } from "../requests.types.js";

const repo = createRequestsRepository();

/** The SLA of a request accepted at `acceptedAt`, measured at `at` (R6.22, R6.23). */
function measure(
  calendar: CalendarType,
  acceptedAt: Date,
  priorityDays: number,
  at: Date,
  awaitingInfoDays: number,
): SlaType {
  const deadline = addWorkingDays(calendar, acceptedAt, priorityDays);
  const met = at <= deadline;
  return {
    deadline,
    elapsedDays: workingDaysBetween(calendar, acceptedAt, at),
    met,
    breachDays: met ? 0 : workingDaysBetween(calendar, deadline, at),
    awaitingInfoDays,
  };
}

/** The closure record of a closed request, or null while it is open. */
export function frozenSlaOf(request: SlaSourceType): SlaType | null {
  const { slaDeadline, elapsedDays, breachDays, slaMet } = request;
  if (!slaDeadline || elapsedDays === null || breachDays === null || slaMet === null) {
    return null;
  }
  return {
    deadline: slaDeadline,
    elapsedDays,
    met: slaMet,
    breachDays,
    awaitingInfoDays: request.awaitingInfoDays ?? 0,
  };
}

/**
 * The SLA of a request: null before acceptance, the frozen closure record once closed, otherwise computed now from
 * the given calendar, so it follows later calendar changes (Q6, D26). Phase 7 reads the live deadline from here.
 */
export function slaOf(
  request: SlaSourceType,
  calendar: CalendarType,
  now: Date = new Date(),
  awaitingInfoDays = 0,
): SlaType | null {
  if (!request.acceptedAt) {
    return null;
  }
  const frozen = frozenSlaOf(request);
  if (frozen) {
    return frozen;
  }
  return measure(calendar, request.acceptedAt, request.priorityDays, now, awaitingInfoDays);
}

export type OutcomeType = "completed" | "rejected" | "rejected_no_response" | "withdrawn";

/**
 * Closes a request, for every closing path (Phase 6 spec, 4.3): freezes the closure record of an accepted request
 * from the calendar as it is now (its past never changes, D26) and returns it; a request closed before acceptance
 * has an outcome and no SLA. The caller holds the request's row lock and audits.
 * It ends the live stage run as cancelled; step 6.3 also closes an open information request here.
 */
export async function closeRequest(
  tx: Tx,
  request: RequestRowType,
  closure: { outcome: OutcomeType; actorId: string; reason?: string },
): Promise<SlaType | null> {
  const closedAt = await repo.now(tx);
  await repo.cancelLiveRun(tx, request.tenantId, request.id, closedAt, closure.actorId);
  const record = request.acceptedAt
    ? measure(
        await loadCalendar(tx, request.tenantId),
        request.acceptedAt,
        request.priorityDays,
        closedAt,
        0,
      )
    : null;
  await repo.close(tx, request.tenantId, request.id, {
    closedAt,
    state: closure.outcome,
    closedBy: closure.actorId,
    closeReason: closure.reason ?? null,
    record,
  });
  return record;
}
