import { and, asc, count, eq, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { byName } from "@/db/order.js";
import type { Executor } from "@/db/pool.js";
import { priorities } from "@/db/schema/index.js";
import type { PageRequestType, SortKeyType } from "@/http/list.js";
import type { PriorityRowType } from "./priorities.types.js";

const priorityColumns = {
  id: priorities.id,
  name: priorities.name,
  days: priorities.days,
  retiredAt: priorities.retiredAt,
};

/** Active priorities by place, then retired ones (no place) by name; the ID breaks ties. */
export const PRIORITY_SORT_KEYS: SortKeyType[] = [
  { expr: sql`coalesce(${priorities.sortOrder}, 999999999)`, type: "integer" },
  { expr: byName(priorities.name), type: "text" },
  { expr: sql`${priorities.id}`, type: "uuid" },
];

const ofTenant = (tenantId: string, priorityId: string) =>
  and(eq(priorities.tenantId, tenantId), eq(priorities.id, priorityId));

/** Tenant code: every query is filtered by the caller's tenant (T2). */
export function createPrioritiesRepository() {
  return {
    /**
     * Serializes every change to one tenant's order (create, reorder, retire, restore) until the transaction
     * ends. The key differs from the calendar's and the seat lock's, so those never wait for it.
     */
    lockOrder(db: Executor, tenantId: string) {
      return db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`priorities:${tenantId}`}, 0))`,
      );
    },

    /** The tenant's priorities that match the `retired` filter. */
    listWhere(tenantId: string, retired: string): SQL | undefined {
      return and(
        eq(priorities.tenantId, tenantId),
        retired === "all"
          ? undefined
          : retired === "true"
            ? isNotNull(priorities.retiredAt)
            : isNull(priorities.retiredAt),
      );
    },

    /** One page in the display order of `PRIORITY_SORT_KEYS`. */
    selectPage(db: Executor, page: PageRequestType) {
      return db
        .select({ ...priorityColumns, sortValues: page.sortValues })
        .from(priorities)
        .where(page.where)
        .orderBy(...page.orderBy)
        .limit(page.limit);
    },

    async count(db: Executor, where: SQL | undefined): Promise<number> {
      const [row] = await db.select({ total: count() }).from(priorities).where(where);
      return Number(row?.total ?? 0);
    },

    findById(db: Executor, tenantId: string, priorityId: string): Promise<PriorityRowType[]> {
      return db.select(priorityColumns).from(priorities).where(ofTenant(tenantId, priorityId));
    },

    findByIdForUpdate(
      db: Executor,
      tenantId: string,
      priorityId: string,
    ): Promise<PriorityRowType[]> {
      return db
        .select(priorityColumns)
        .from(priorities)
        .where(ofTenant(tenantId, priorityId))
        .for("update");
    },

    /** The ids of the active priorities in display order. */
    async activeIds(db: Executor, tenantId: string): Promise<string[]> {
      const rows = await db
        .select({ id: priorities.id })
        .from(priorities)
        .where(and(eq(priorities.tenantId, tenantId), isNull(priorities.retiredAt)))
        .orderBy(asc(priorities.sortOrder));
      return rows.map((row) => row.id);
    },

    /** The next free place at the end of the order; call under the order lock. */
    async nextPlace(db: Executor, tenantId: string): Promise<number> {
      const [row] = await db
        .select({ next: sql<number>`coalesce(max(${priorities.sortOrder}), 0) + 1` })
        .from(priorities)
        .where(and(eq(priorities.tenantId, tenantId), isNull(priorities.retiredAt)));
      return Number(row?.next ?? 1);
    },

    insert(
      db: Executor,
      values: { id: string; tenantId: string; name: string; days: number; sortOrder: number },
    ) {
      return db.insert(priorities).values(values);
    },

    update(
      db: Executor,
      tenantId: string,
      priorityId: string,
      patch: { name?: string; days?: number },
    ) {
      return db
        .update(priorities)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(ofTenant(tenantId, priorityId));
    },

    /** Retiring takes the priority out of the order; restoring puts it at `sortOrder`. */
    setRetired(
      db: Executor,
      tenantId: string,
      priorityId: string,
      place: { retired: true } | { retired: false; sortOrder: number },
    ) {
      return db
        .update(priorities)
        .set({
          retiredAt: place.retired ? sql`now()` : null,
          sortOrder: place.retired ? null : place.sortOrder,
          updatedAt: sql`now()`,
        })
        .where(ofTenant(tenantId, priorityId));
    },

    /**
     * Gives the active priorities the places 1..n in the given order. Their places are negated first, because the
     * unique key is checked row by row and a swap would collide; negating keeps every active row ordered and
     * distinct, so the "active means ordered" check holds throughout.
     */
    async setOrder(db: Executor, tenantId: string, ids: string[]) {
      await db
        .update(priorities)
        .set({ sortOrder: sql`-${priorities.sortOrder}` })
        .where(and(eq(priorities.tenantId, tenantId), isNull(priorities.retiredAt)));
      for (const [index, id] of ids.entries()) {
        await db
          .update(priorities)
          .set({ sortOrder: index + 1, updatedAt: sql`now()` })
          .where(ofTenant(tenantId, id));
      }
    },
  };
}
