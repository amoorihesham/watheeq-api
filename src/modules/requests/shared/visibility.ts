import { type AnyColumn, and, eq, or, type SQL, sql } from "drizzle-orm";
import {
  informationRequests,
  requestStageAssignees,
  requestStageRuns,
  requests,
} from "@/db/schema/index.js";
import { withinScope } from "@/modules/tenant-access/index.js";

/** The caller's `permission` scope over the request's owner and one of its recorded units (T29). */
const scoped = (
  tenantId: string,
  callerId: string,
  permission: "request.view" | "request.review",
  unit: AnyColumn,
) =>
  withinScope({
    tenantId,
    callerId,
    permission,
    ownerId: requests.requesterId,
    unitId: unit,
  });

/** True while the request is in review and the caller holds `request.review`. */
export const reviewableBy = (tenantId: string, callerId: string): SQL =>
  and(
    eq(requests.state, "in_review"),
    scoped(tenantId, callerId, "request.review", requests.requesterUnitId),
  ) as SQL;

/** The caller is recorded as an assignee of the request's live (active or held) stage run. */
export const isLiveAssignee = (callerId: string): SQL =>
  sql`exists (
    select 1 from ${requestStageRuns}
    join ${requestStageAssignees} on ${requestStageAssignees.runId} = ${requestStageRuns.id}
    where ${requestStageRuns.requestId} = ${requests.id}
      and ${requestStageRuns.state} in ('active', 'held')
      and ${requestStageAssignees.userId} = ${callerId}
  )`;

/**
 * The one condition for "the caller may see this request" (R6.7), used by the list, the read, and every action's
 * lookup, so anything outside it is 404. Resolved from the caller's current unit and role, so a move or a role
 * edit applies on the next request.
 */
export function visibleRequests(tenantId: string, callerId: string): SQL {
  return or(
    eq(requests.requesterId, callerId),
    eq(requests.handlerId, callerId),
    isLiveAssignee(callerId),
    reviewableBy(tenantId, callerId),
    scoped(tenantId, callerId, "request.view", requests.requesterUnitId),
    scoped(tenantId, callerId, "request.view", requests.handlerUnitId),
  ) as SQL;
}

/**
 * "Waiting on me" (R6.8): the caller is an assignee of the live stage run, or the requester of a request whose
 * information request is open.
 */
export function waitingOnMe(_tenantId: string, callerId: string): SQL {
  return or(
    and(eq(requests.state, "in_progress"), isLiveAssignee(callerId)),
    and(
      eq(requests.requesterId, callerId),
      sql`exists (
        select 1 from ${informationRequests}
        where ${informationRequests.tenantId} = ${requests.tenantId}
          and ${informationRequests.requestId} = ${requests.id}
          and ${informationRequests.state} = 'open'
      )`,
    ),
  ) as SQL;
}
