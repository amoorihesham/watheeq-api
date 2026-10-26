import { count, eq, getTableColumns, type SQL, sql } from "drizzle-orm";
import type { Executor } from "@/db/pool.js";
import { plans } from "@/db/schema/index.js";
import type { PageRequestType } from "@/http/list.js";
import type { NewPlanType, PlanChangesType, PlanType } from "./plans.types.js";

export function createPlansRepository() {
  return {
    insert(db: Executor, values: NewPlanType): Promise<PlanType[]> {
      return db.insert(plans).values(values).returning();
    },

    page(db: Executor, page: PageRequestType) {
      return db
        .select({ ...getTableColumns(plans), sortValues: page.sortValues })
        .from(plans)
        .where(page.where)
        .orderBy(...page.orderBy)
        .limit(page.limit);
    },

    async count(db: Executor, where: SQL | undefined): Promise<number> {
      const [row] = await db.select({ total: count() }).from(plans).where(where);
      return row?.total ?? 0;
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
