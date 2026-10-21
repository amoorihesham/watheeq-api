import { eq, sql } from "drizzle-orm";
import { byName } from "@/db/order.js";
import type { Executor } from "@/db/pool.js";
import { plans } from "@/db/schema/index.js";
import type { NewPlanType, PlanChangesType, PlanType } from "./plans.types.js";

export function createPlansRepository() {
  return {
    insert(db: Executor, values: NewPlanType): Promise<PlanType[]> {
      return db.insert(plans).values(values).returning();
    },

    list(db: Executor): Promise<PlanType[]> {
      return db.select().from(plans).orderBy(byName(plans.name));
    },

    findById(db: Executor, planId: string): Promise<PlanType[]> {
      return db.select().from(plans).where(eq(plans.id, planId));
    },

    /** Locks the row, so the audited "before" is the state this transaction replaces. */
    findByIdForUpdate(db: Executor, planId: string): Promise<PlanType[]> {
      return db.select().from(plans).where(eq(plans.id, planId)).for("update");
    },

    update(db: Executor, planId: string, changes: PlanChangesType): Promise<PlanType[]> {
      return db
        .update(plans)
        .set({ ...changes, updatedAt: sql`now()` })
        .where(eq(plans.id, planId))
        .returning();
    },
  };
}
