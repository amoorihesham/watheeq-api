import { type AuditContextType, writeAuditEntry } from '@/audit/index.js';
import type { Executor, Tx } from '@/db/pool.js';
import { AppError } from '@/http/errors.js';
import { type AssigneeContextType, type AssigneeLevelType, type AssigneeTargetType, nextLevel, peopleAtLevel, resolveAssignees } from '@/modules/positions/index.js';
import { createRequestsRepository } from '../requests.repository.js';
import type { RequestRowType, SlaType, StageDefRowType, StageRunRowType } from '../requests.types.js';
import { closeRequest } from './sla.js';

const repo = createRequestsRepository();

/** Who acts, and the audit context that describes the action. */
export interface ActorType {
  id: string;
  audit: AuditContextType;
}

/** One start, skip, hold, escalation, or completion an action caused, as the action's audit entry lists it (4.1). */
export interface TransitionType {
  run: string;
  stage: string;
  state: StageRunRowType['state'];
  assignees: string[];
  level: AssigneeLevelType | null;
}

type ResolutionType = { kind: 'assigned'; level: AssigneeLevelType; userIds: string[]; escalated: boolean } | { kind: 'skip' } | { kind: 'held' };

const contextOf = (request: RequestRowType): AssigneeContextType => ({
  handlerId: request.handlerId,
  requesterId: request.requesterId,
});

const targetOf = (stage: StageDefRowType): AssigneeTargetType => (stage.targetPositionId ? { position: stage.targetPositionId } : { builtin: stage.targetBuiltin as NonNullable<StageDefRowType['targetBuiltin']> });

const transitionOf = (run: Pick<StageRunRowType, 'id' | 'workflowStageId' | 'state' | 'level'>, assignees: string[]): TransitionType => ({
  run: run.id,
  stage: run.workflowStageId,
  state: run.state,
  assignees,
  level: run.level,
});

/**
 * Resolves a stage's target for the request as it is now (Q16-Q21): the people and level found, or what the
 * stage's fallback says when nobody is: skip, climb levels (held when the chain ends), or hold.
 */
async function resolveStage(tx: Tx, request: RequestRowType, stage: StageDefRowType): Promise<ResolutionType> {
  const options = { excludeParties: stage.excludeParties };
  const resolved = await resolveAssignees(tx, request.tenantId, targetOf(stage), contextOf(request), options);
  if (resolved.userIds.length > 0) {
    return { kind: 'assigned', ...resolved, escalated: false };
  }
  switch (stage.whenUnresolved) {
    case 'skip':
      return { kind: 'skip' };
    case 'hold':
      return { kind: 'held' };
    case 'escalate': {
      const above = await nextLevel(tx, request.tenantId, resolved.level, contextOf(request), options);
      return above ? { kind: 'assigned', ...above, escalated: true } : { kind: 'held' };
    }
  }
}

/**
 * Starts the stage at `index` of the version's stages in the caller's transaction, passing over stages whose
 * fallback is skip; after the last stage it completes the request and returns the closure record (R6.13, R6.15).
 * `request` must show the accepted request as it is now. Every run it creates is added to `transitions`.
 */
export async function startStage(tx: Tx, request: RequestRowType, stages: StageDefRowType[], index: number, actor: ActorType, transitions: TransitionType[]): Promise<SlaType | null> {
  const now = await repo.now(tx);
  for (let at = index; at < stages.length; at++) {
    const stage = stages[at];
    if (!stage || !request.workflowVersionId) {
      throw new Error('a stage runs on an accepted request');
    }
    const resolution = await resolveStage(tx, request, stage);
    const base = {
      tenantId: request.tenantId,
      requestId: request.id,
      workflowVersionId: request.workflowVersionId,
      workflowStageId: stage.id,
      ordinal: stage.ordinal,
      startedAt: now,
    };
    if (resolution.kind === 'skip') {
      const [run] = await repo.insertRun(tx, { ...base, state: 'skipped', endedAt: now });
      if (!run) {
        throw new Error('the run insert returned no row');
      }
      transitions.push(transitionOf(run, []));
      continue;
    }
    const assigned = resolution.kind === 'assigned';
    const [run] = await repo.insertRun(tx, {
      ...base,
      state: assigned ? 'active' : 'held',
      level: assigned ? resolution.level : null,
      escalated: assigned && resolution.escalated,
    });
    if (!run) {
      throw new Error('the run insert returned no row');
    }
    const userIds = assigned ? resolution.userIds : [];
    await repo.replaceAssignees(tx, request.tenantId, run.id, userIds);
    transitions.push(transitionOf(run, userIds));
    return null;
  }

  return closeRequest(tx, request, { outcome: 'completed', actorId: actor.id });
}

/**
 * Audits the completion of a request that `startStage` closed, after the action's own entry, so the entries read
 * in the order things happened. A null closure means the request did not complete.
 */
export async function auditCompletion(tx: Tx, request: RequestRowType, actor: ActorType, closure: SlaType | null): Promise<void> {
  if (closure) {
    await writeAuditEntry(tx, {
      tenantId: request.tenantId,
      ...actor.audit,
      action: 'request.completed',
      resourceType: 'request',
      resourceId: request.id,
      details: { outcome: 'completed', closure },
    });
  }
}

const indexOfStage = (stages: StageDefRowType[], stageId: string): number => stages.findIndex((stage) => stage.id === stageId);

/** Whether the person is a recorded assignee of the run and still among the people at its level (R6.14). */
export async function qualifiesFor(tx: Executor, request: RequestRowType, run: StageRunRowType, stage: StageDefRowType, userId: string): Promise<boolean> {
  if (!run.level) {
    return false;
  }
  const recorded = await repo.assigneesOf(tx, request.tenantId, [run.id]);
  if (!recorded.some((assignee) => assignee.userId === userId)) {
    return false;
  }
  const current = await peopleAtLevel(tx, request.tenantId, run.level, contextOf(request), {
    excludeParties: stage.excludeParties,
  });
  return current.includes(userId);
}

export async function assigneeIdsOf(tx: Executor, request: RequestRowType, run: StageRunRowType) {
  return (await repo.assigneesOf(tx, request.tenantId, [run.id])).map((a) => a.userId);
}

/** Completes the active run and starts the next stage, or completes the request after the last (R6.15). */
export async function completeRun(tx: Tx, request: RequestRowType, stages: StageDefRowType[], run: StageRunRowType, comment: string | undefined, actor: ActorType, transitions: TransitionType[]): Promise<SlaType | null> {
  const assignees = await assigneeIdsOf(tx, request, run);
  const ended = await repo.now(tx);
  await repo.updateRun(tx, request.tenantId, run.id, {
    state: 'completed',
    endedAt: ended,
    endedBy: actor.id,
    comment: comment ?? null,
  });
  transitions.push(transitionOf({ ...run, state: 'completed' }, assignees));
  return startStage(tx, request, stages, indexOfStage(stages, run.workflowStageId) + 1, actor, transitions);
}

/**
 * Returns to the nearest earlier stage that ran to completion, which starts again from its position; stages that
 * were skipped are passed over (R6.16). 409 NO_EARLIER_STAGE when there is none.
 */
export async function returnRun(tx: Tx, request: RequestRowType, stages: StageDefRowType[], run: StageRunRowType, reason: string, actor: ActorType, transitions: TransitionType[]): Promise<SlaType | null> {
  const [earlier] = await repo.latestCompletedBefore(tx, request.tenantId, request.id, run.ordinal);
  if (!earlier) {
    throw new AppError('NO_EARLIER_STAGE');
  }
  const assignees = await assigneeIdsOf(tx, request, run);
  await repo.updateRun(tx, request.tenantId, run.id, {
    state: 'returned',
    endedAt: await repo.now(tx),
    endedBy: actor.id,
    comment: reason,
  });
  transitions.push(transitionOf({ ...run, state: 'returned' }, assignees));
  return startStage(tx, request, stages, indexOfStage(stages, earlier.workflowStageId), actor, transitions);
}

/** Keeps only the listed assignees (R6.17); the caller has checked they are a subset. */
export async function narrowRun(tx: Tx, request: RequestRowType, run: StageRunRowType, userIds: string[]): Promise<void> {
  await repo.replaceAssignees(tx, request.tenantId, run.id, userIds);
  await repo.updateRun(tx, request.tenantId, run.id, { narrowed: true });
}

/** Moves the run to the next level up that has anybody, or 409 NO_HIGHER_LEVEL (R6.17). */
export async function escalateRun(tx: Tx, request: RequestRowType, stage: StageDefRowType, run: StageRunRowType): Promise<{ level: AssigneeLevelType; userIds: string[] }> {
  const above = run.level
    ? await nextLevel(tx, request.tenantId, run.level, contextOf(request), {
        excludeParties: stage.excludeParties,
      })
    : null;
  if (!above) {
    throw new AppError('NO_HIGHER_LEVEL');
  }
  await repo.replaceAssignees(tx, request.tenantId, run.id, above.userIds);
  await repo.updateRun(tx, request.tenantId, run.id, { level: above.level, escalated: true });
  return above;
}

/**
 * Resolves the live run's stage again and replaces its assignees and level in place, clearing narrowing and
 * escalation; the fallback applies when nobody is found, and a skip starts the next stage (R6.18). `request` must
 * show the handler the run is to be resolved for.
 */
export async function refreshRun(tx: Tx, request: RequestRowType, stages: StageDefRowType[], run: StageRunRowType, actor: ActorType, transitions: TransitionType[]): Promise<SlaType | null> {
  const index = indexOfStage(stages, run.workflowStageId);
  const stage = stages[index];
  if (!stage) {
    throw new Error('a run belongs to a stage of its version');
  }
  const resolution = await resolveStage(tx, request, stage);
  if (resolution.kind === 'skip') {
    await repo.updateRun(tx, request.tenantId, run.id, {
      state: 'skipped',
      endedAt: await repo.now(tx),
      endedBy: actor.id,
    });
    transitions.push(transitionOf({ ...run, state: 'skipped' }, []));
    return startStage(tx, request, stages, index + 1, actor, transitions);
  }
  const assigned = resolution.kind === 'assigned';
  const patch = {
    state: assigned ? ('active' as const) : ('held' as const),
    level: assigned ? resolution.level : null,
    narrowed: false,
    escalated: assigned && resolution.escalated,
  };
  const userIds = assigned ? resolution.userIds : [];
  await repo.replaceAssignees(tx, request.tenantId, run.id, userIds);
  await repo.updateRun(tx, request.tenantId, run.id, patch);
  transitions.push(transitionOf({ ...run, ...patch }, userIds));
  return null;
}
