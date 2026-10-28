import { writeAuditEntry } from '@/audit/index.js';
import type { EscalationsJobConfigType } from '@/config/config.js';
import type { Db, Executor, Tx } from '@/db/pool.js';
import { withTx } from '@/db/tx.js';
import type { Logger } from '@/logging/logger.js';
import { addWorkingDays, type CalendarType, loadCalendar } from '@/modules/calendar/index.js';
import { type EscalationRuleType, type RecipientType, readEscalation } from '@/modules/escalation/index.js';
import { type NotificationKindType, notify } from '@/modules/notifications/index.js';
import { type AssigneeLevelType, type AssigneeTargetType, nextLevel, resolveAssignees } from '@/modules/positions/index.js';
import { holdersOf } from '@/modules/tenant-access/index.js';
import type { JobType } from '@/scheduler/index.js';
import { ESCALATION_RULE_STATES } from '../requests.constants.js';
import type { EscalationCandidateRowType, EscalationFiringType, LockedRequestRowType } from '../requests.types.js';
import { createEscalationsRepository } from './escalations.repository.js';
import { numberOf } from './notices.js';

const repo = createEscalationsRepository();

const KIND_OF_RULE: Record<EscalationRuleType, NotificationKindType> = {
  r0: 'request.review_overdue',
  r1: 'request.at_risk',
  r2: 'request.breached',
};

export interface CheckEscalationsOptionsType {
  logger: Logger;
  /** The job run's ID, recorded on each firing's audit entry. */
  runId: string;
  signal?: AbortSignal;
  /** The moment to check against; the database clock when omitted. */
  now?: Date;
  /** A run still firing after this long stops starting firings; the rest waits for the next run. */
  budgetMs: number;
  /** Runs after the candidates are read and before any firing: the window in which a request can change. */
  afterScan?: () => Promise<void>;
}

export type EscalationCountsType = {
  r0: number;
  r1: number;
  r2: number;
  skippedLocked: number;
  failed: number;
};

interface DueType {
  rule: EscalationRuleType;
  dueAt: Date;
  /** The request's deadline, for the rules that run against one. */
  deadline: Date | null;
}

/**
 * What is due on one candidate at `now` (Phase 7 spec, 4.3): R0 once its days after submission have passed, R2 once
 * the deadline has passed, and R1 from its share of the deadline until then (Q2).
 */
function dueOf(candidate: EscalationCandidateRowType, calendar: CalendarType, now: Date): DueType[] {
  if (candidate.state === 'in_review') {
    if (!candidate.r0.enabled || candidate.r0.fired) {
      return [];
    }
    const dueAt = addWorkingDays(calendar, candidate.submittedAt, candidate.r0.days);
    return now >= dueAt ? [{ rule: 'r0', dueAt, deadline: null }] : [];
  }
  if (!candidate.acceptedAt) {
    return [];
  }
  const deadline = addWorkingDays(calendar, candidate.acceptedAt, candidate.priorityDays);
  if (now > deadline) {
    return candidate.r2.enabled && !candidate.r2.fired ? [{ rule: 'r2', dueAt: deadline, deadline }] : [];
  }
  if (!candidate.r1.enabled || candidate.r1.fired || candidate.r2.fired) {
    return [];
  }
  const dueAt = addWorkingDays(calendar, candidate.acceptedAt, (candidate.priorityDays * candidate.r1.percent) / 100);
  return now >= dueAt ? [{ rule: 'r1', dueAt, deadline }] : [];
}

const targetOf = (recipient: RecipientType): AssigneeTargetType => ('position' in recipient ? { position: recipient.position } : { builtin: recipient.builtin });

interface TargetResultType {
  target: AssigneeTargetType;
  level: AssigneeLevelType;
  userIds: string[];
}

/** The people each target resolves to, climbing when a target finds nobody (Q4). */
async function resolveTargets(tx: Tx, request: LockedRequestRowType, recipients: RecipientType[]): Promise<TargetResultType[]> {
  const context = { requesterId: request.requesterId, handlerId: request.handlerId };
  const options = { excludeParties: false };
  const results: TargetResultType[] = [];
  for (const recipient of recipients) {
    const target = targetOf(recipient);
    let { level, userIds } = await resolveAssignees(tx, request.tenantId, target, context, options);
    if (userIds.length === 0) {
      const above = await nextLevel(tx, request.tenantId, level, context, options);
      if (above) {
        ({ level, userIds } = above);
      }
    }
    results.push({ target, level, userIds });
  }
  return results;
}

type FiringOutcomeType = 'fired' | 'skipped_locked' | 'stale';

/** Fires one rule on one request in one transaction (Phase 7 spec, 4.3 "Firing"). */
async function fire(db: Db, candidate: EscalationCandidateRowType, due: DueType, runId: string): Promise<FiringOutcomeType> {
  return withTx(db, async (tx) => {
    const [request] = await repo.lockForFiring(tx, candidate.tenantId, candidate.id);
    if (!request) {
      return 'skipped_locked';
    }
    const settings = await readEscalation(tx, request.tenantId);
    if (request.state !== ESCALATION_RULE_STATES[due.rule] || !settings?.[due.rule].enabled) {
      return 'stale';
    }
    const inserted = await repo.insertFiring(tx, {
      tenantId: request.tenantId,
      requestId: request.id,
      rule: due.rule,
      dueAt: due.dueAt,
    });
    if (inserted.length === 0) {
      return 'stale';
    }

    const targets = await resolveTargets(tx, request, settings[due.rule].recipients);
    const found = [...new Set(targets.flatMap((result) => result.userIds))];
    const noRecipients = found.length === 0;
    const recipients = noRecipients ? await holdersOf(tx, request.tenantId, 'escalation.manage') : found;
    const base = { number: numberOf(request), title: request.title };
    await notify(tx, {
      tenantId: request.tenantId,
      recipients,
      requestId: request.id,
      kind: noRecipients ? 'escalation.no_recipients' : KIND_OF_RULE[due.rule],
      data: noRecipients
        ? { ...base, rule: due.rule }
        : {
            ...base,
            dueAt: due.dueAt.toISOString(),
            ...(due.deadline ? { deadline: due.deadline.toISOString() } : {}),
          },
    });
    await writeAuditEntry(tx, {
      tenantId: request.tenantId,
      actor: { type: 'system' },
      action: 'request.escalated',
      resourceType: 'request',
      resourceId: request.id,
      details: {
        rule: due.rule,
        dueAt: due.dueAt,
        recipients,
        targets,
        noRecipients,
      },
      requestId: runId,
    });
    return 'fired';
  });
}

/**
 * One run of the escalation check (Phase 7 spec, 4.3): reads the candidates, works out what is due per tenant from
 * its calendar, and fires each rule in its own transaction. Stops starting firings when the budget is spent or the
 * signal aborts; the rest waits for the next run.
 */
export async function checkEscalations(db: Db, { logger, runId, signal, now: fixedNow, budgetMs, afterScan }: CheckEscalationsOptionsType): Promise<EscalationCountsType> {
  const counts: EscalationCountsType = { r0: 0, r1: 0, r2: 0, skippedLocked: 0, failed: 0 };
  const startedAt = Date.now();
  const now = fixedNow ?? (await repo.now(db));
  const candidates = await repo.candidates(db);
  await afterScan?.();

  const byTenant = Map.groupBy(candidates, (candidate) => candidate.tenantId);
  for (const [tenantId, tenantCandidates] of byTenant) {
    const stopped = () => signal?.aborted || Date.now() - startedAt >= budgetMs;
    if (stopped()) {
      break;
    }
    let calendar: CalendarType;
    try {
      calendar = await loadCalendar(db, tenantId);
    } catch (err) {
      counts.failed += 1;
      logger.error({ err, tenantId }, 'escalation check failed for the tenant');
      continue;
    }
    for (const candidate of tenantCandidates) {
      if (stopped()) {
        break;
      }
      try {
        for (const due of dueOf(candidate, calendar, now)) {
          const outcome = await fire(db, candidate, due, runId);
          if (outcome === 'fired') {
            counts[due.rule] += 1;
          } else if (outcome === 'skipped_locked') {
            counts.skippedLocked += 1;
          }
        }
      } catch (err) {
        counts.failed += 1;
        logger.error({ err, tenantId, requestId: candidate.id }, 'escalation check failed for the request');
      }
    }
  }
  return counts;
}

export function createEscalationsJob(settings: EscalationsJobConfigType): JobType {
  return {
    name: 'requests.escalations',
    intervalMs: settings.intervalMs,
    settings,
    run: ({ db, logger, signal, runId }) => checkEscalations(db, { logger, runId, signal, budgetMs: settings.budgetMs }),
  };
}

/** The rules that fired on a request, in the order they fired (R7.5). */
export function escalationsOf(executor: Executor, tenantId: string, requestId: string): Promise<EscalationFiringType[]> {
  return repo.firingsOf(executor, tenantId, requestId);
}
