import { and, eq, inArray, sql } from "drizzle-orm";
import { byName } from "@/db/order.js";
import type { Executor } from "@/db/pool.js";
import { escalationRecipients, escalationSettings, positions } from "@/db/schema/index.js";
import type {
  EscalationInputType,
  EscalationRuleType,
  PositionStateRowType,
  RecipientRowType,
  SettingsRowType,
} from "./escalation.types.js";

/** Tenant code: every query is filtered by the caller's tenant (T2). */
export function createEscalationRepository() {
  return {
    /** Serializes saves of one tenant's settings until the transaction ends; the key is this module's alone. */
    lockSettings(db: Executor, tenantId: string) {
      return db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`escalation:${tenantId}`}, 0))`,
      );
    },

    findSettings(db: Executor, tenantId: string): Promise<SettingsRowType[]> {
      return db
        .select({
          r0Enabled: escalationSettings.r0Enabled,
          r0Days: escalationSettings.r0Days,
          r1Enabled: escalationSettings.r1Enabled,
          r1Percent: escalationSettings.r1Percent,
          r2Enabled: escalationSettings.r2Enabled,
        })
        .from(escalationSettings)
        .where(eq(escalationSettings.tenantId, tenantId));
    },

    /** Built-in targets in catalog order, then positions by name. */
    recipients(db: Executor, tenantId: string): Promise<RecipientRowType[]> {
      return db
        .select({
          rule: escalationRecipients.rule,
          targetPositionId: escalationRecipients.targetPositionId,
          targetBuiltin: escalationRecipients.targetBuiltin,
          positionName: positions.name,
        })
        .from(escalationRecipients)
        .leftJoin(
          positions,
          and(
            eq(positions.tenantId, escalationRecipients.tenantId),
            eq(positions.id, escalationRecipients.targetPositionId),
          ),
        )
        .where(eq(escalationRecipients.tenantId, tenantId))
        .orderBy(
          escalationRecipients.rule,
          sql`${escalationRecipients.targetBuiltin} asc nulls last`,
          byName(positions.name),
          escalationRecipients.targetPositionId,
        );
    },

    /**
     * Locks the named positions against retiring (`FOR SHARE` pairs with the retire's `FOR UPDATE`) and returns
     * their state; a missing or foreign id is absent from the result. Ordered by id so two saves cannot deadlock.
     */
    lockPositions(
      db: Executor,
      tenantId: string,
      positionIds: string[],
    ): Promise<PositionStateRowType[]> {
      return db
        .select({ id: positions.id, retiredAt: positions.retiredAt })
        .from(positions)
        .where(and(eq(positions.tenantId, tenantId), inArray(positions.id, positionIds)))
        .orderBy(positions.id)
        .for("share");
    },

    upsertSettings(db: Executor, tenantId: string, input: EscalationInputType) {
      const values = {
        r0Enabled: input.r0.enabled,
        r0Days: input.r0.days,
        r1Enabled: input.r1.enabled,
        r1Percent: input.r1.percent,
        r2Enabled: input.r2.enabled,
      };
      return db
        .insert(escalationSettings)
        .values({ tenantId, ...values })
        .onConflictDoUpdate({
          target: escalationSettings.tenantId,
          set: { ...values, updatedAt: sql`now()` },
        });
    },

    deleteRecipients(db: Executor, tenantId: string) {
      return db.delete(escalationRecipients).where(eq(escalationRecipients.tenantId, tenantId));
    },

    async insertRecipients(db: Executor, tenantId: string, input: EscalationInputType) {
      const rules: EscalationRuleType[] = ["r0", "r1", "r2"];
      const values = rules.flatMap((rule) =>
        input[rule].recipients.map((target) => ({
          tenantId,
          rule,
          targetPositionId: "position" in target ? target.position : null,
          targetBuiltin: "builtin" in target ? target.builtin : null,
        })),
      );
      if (values.length > 0) {
        await db.insert(escalationRecipients).values(values);
      }
    },
  };
}
