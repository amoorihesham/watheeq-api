import type { Executor } from '@/db/pool.js';
import { createEscalationRepository } from '../escalation.repository.js';
import type { EscalationType, RecipientRowType, RecipientType } from '../escalation.types.js';

const repo = createEscalationRepository();

const toRecipient = (row: RecipientRowType): RecipientType => (row.targetPositionId ? { position: row.targetPositionId, name: row.positionName } : { builtin: row.targetBuiltin as NonNullable<RecipientRowType['targetBuiltin']> });

/** The tenant's escalation settings with each rule's recipients, or null while not configured (Q17). */
export async function readEscalation(executor: Executor, tenantId: string): Promise<EscalationType | null> {
  const [settings] = await repo.findSettings(executor, tenantId);
  if (!settings) {
    return null;
  }
  const rows = await repo.recipients(executor, tenantId);
  const recipientsOf = (rule: RecipientRowType['rule']) => rows.filter((row) => row.rule === rule).map(toRecipient);
  return {
    r0: { enabled: settings.r0Enabled, days: settings.r0Days, recipients: recipientsOf('r0') },
    r1: {
      enabled: settings.r1Enabled,
      percent: settings.r1Percent,
      recipients: recipientsOf('r1'),
    },
    r2: { enabled: settings.r2Enabled, recipients: recipientsOf('r2') },
  };
}

/** Phase 6 refuses a submission while this is false (Phase 5 spec, 4.3). */
export async function isEscalationConfigured(executor: Executor, tenantId: string): Promise<boolean> {
  return (await repo.findSettings(executor, tenantId)).length > 0;
}
