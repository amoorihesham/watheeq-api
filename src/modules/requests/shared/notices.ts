import type { Tx } from '@/db/pool.js';
import { type NotificationKindType, notify } from '@/modules/notifications/index.js';
import type { RequestRowType, StageDefRowType } from '../requests.types.js';
import type { TransitionType } from './stages.js';

/** `REQ-42-2026`, as the API shows it. */
export const numberOf = (row: Pick<RequestRowType, 'number' | 'year'>) => `REQ-${row.number}-${row.year}`;

type NoticeRequestType = Pick<RequestRowType, 'id' | 'tenantId' | 'number' | 'year' | 'title'>;

/** Tells `recipients` about `request` inside the action's transaction; the actor is never told (R7.11). */
export function notifyAbout(
  tx: Tx,
  request: NoticeRequestType,
  notice: {
    kind: NotificationKindType;
    recipients: readonly string[];
    actorId: string;
    /** The kind's own values, beyond `{number, title}` (Phase 7 spec, 4.3). */
    data?: Record<string, unknown>;
  },
): Promise<void> {
  return notify(tx, {
    tenantId: request.tenantId,
    recipients: notice.recipients,
    actorId: notice.actorId,
    kind: notice.kind,
    requestId: request.id,
    data: { number: numberOf(request), title: request.title, ...notice.data },
  });
}

/**
 * Turns an action's stage transitions into notifications (Phase 7 spec, 4.3): `request.stage_assigned` for each
 * person new to an active run, `request.stage_held` to the handler for a held run. `before` holds the assignees
 * of runs that existed before the action (refresh, handler escalation, reassignment); a run the action started
 * has none, so everybody on it is new.
 */
export async function notifyStageChanges(
  tx: Tx,
  request: NoticeRequestType & Pick<RequestRowType, 'handlerId'>,
  actorId: string,
  stages: readonly StageDefRowType[],
  transitions: readonly TransitionType[],
  before: ReadonlyMap<string, readonly string[]> = new Map(),
): Promise<void> {
  for (const transition of transitions) {
    const stage = stages.find((candidate) => candidate.id === transition.stage)?.name;
    if (transition.state === 'active') {
      const known = new Set(before.get(transition.run));
      await notifyAbout(tx, request, {
        kind: 'request.stage_assigned',
        recipients: transition.assignees.filter((userId) => !known.has(userId)),
        actorId,
        data: { stage },
      });
    } else if (transition.state === 'held' && request.handlerId) {
      await notifyAbout(tx, request, {
        kind: 'request.stage_held',
        recipients: [request.handlerId],
        actorId,
        data: { stage },
      });
    }
  }
}
