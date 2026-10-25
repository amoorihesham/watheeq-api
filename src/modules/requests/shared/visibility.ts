import { type AnyColumn, and, eq, or, type SQL, sql } from "drizzle-orm";
import { requests } from "@/db/schema/index.js";
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

/**
 * The one condition for "the caller may see this request" (R6.7), used by the list, the read, and every action's
 * lookup, so anything outside it is 404. Resolved from the caller's current unit and role, so a move or a role
 * edit applies on the next request. Step 6.2 adds the branch for assignees of the live stage run.
 */
export function visibleRequests(tenantId: string, callerId: string): SQL {
  return or(
    eq(requests.requesterId, callerId),
    eq(requests.handlerId, callerId),
    reviewableBy(tenantId, callerId),
    scoped(tenantId, callerId, "request.view", requests.requesterUnitId),
    scoped(tenantId, callerId, "request.view", requests.handlerUnitId),
  ) as SQL;
}

/**
 * "Waiting on me" (R6.8). Step 6.2 adds the stages the caller is an assignee of and 6.3 the open information
 * requests the caller must answer; until then nothing waits on anybody.
 */
export function waitingOnMe(_tenantId: string, _callerId: string): SQL {
  return sql`false`;
}
