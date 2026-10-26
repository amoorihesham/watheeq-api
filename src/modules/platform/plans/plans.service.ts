import { sql } from "drizzle-orm";
import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import { byName } from "@/db/order.js";
import type { Db } from "@/db/pool.js";
import { plans } from "@/db/schema/index.js";
import { withTx } from "@/db/tx.js";
import { AppError } from "@/http/errors.js";
import { listPage } from "@/http/list.js";
import type { PageType } from "@/http/respond.js";
import { validate } from "@/http/validate.js";
import {
  createPlanRequestSchema,
  listPlansQuerySchema,
  planIdSchema,
  updatePlanRequestSchema,
} from "./plans.schemas.js";
import type {
  CreatePlanRequestType,
  PlansRepositoryType,
  PlanType,
  UpdatePlanRequestType,
} from "./plans.types.js";

/** A non-UUID id is answered like an unknown one, never as a database cast error. */
function existingPlanId(planId: string): string {
  if (!planIdSchema.safeParse(planId).success) {
    throw new AppError("NOT_FOUND");
  }
  return planId;
}

export function createPlansService({ db, repo }: { db: Db; repo: PlansRepositoryType }) {
  return {
    /** A duplicate name (any case) reaches the error handler as PLAN_NAME_TAKEN and rolls back the audit entry too. */
    create(input: CreatePlanRequestType, context: AuditContextType): Promise<PlanType> {
      const values = validate(createPlanRequestSchema, input);
      return withTx(db, async (tx) => {
        const [plan] = await repo.insert(tx, values);
        if (!plan) {
          throw new Error("insert returned no row");
        }
        await writeAuditEntry(tx, {
          tenantId: null,
          ...context,
          action: "plan.created",
          resourceType: "plan",
          resourceId: plan.id,
          details: { after: plan },
        });
        return plan;
      });
    },

    list(input: unknown): Promise<PageType<PlanType>> {
      const query = validate(listPlansQuerySchema, input);
      return listPage({
        db,
        list: "plans",
        query,
        keys: [
          { expr: byName(plans.name), type: "text" },
          { expr: sql`${plans.id}`, type: "uuid" },
        ],
        direction: "asc",
        where: () => undefined,
        selectPage: repo.page,
        count: repo.count,
      });
    },

    async get(planId: string): Promise<PlanType> {
      const [plan] = await repo.findById(db, existingPlanId(planId));
      if (!plan) {
        throw new AppError("NOT_FOUND");
      }
      return plan;
    },

    /** Changes the plan only; subscriptions keep the terms they copied (R1.2, D14). */
    update(
      planId: string,
      input: UpdatePlanRequestType,
      context: AuditContextType,
    ): Promise<PlanType> {
      const id = existingPlanId(planId);
      const changes = validate(updatePlanRequestSchema, input);
      return withTx(db, async (tx) => {
        const [before] = await repo.findByIdForUpdate(tx, id);
        if (!before) {
          throw new AppError("NOT_FOUND");
        }
        const [after] = await repo.update(tx, id, changes);
        if (!after) {
          throw new Error("update returned no row");
        }
        await writeAuditEntry(tx, {
          tenantId: null,
          ...context,
          action: "plan.updated",
          resourceType: "plan",
          resourceId: id,
          details: { before, after },
        });
        return after;
      });
    },
  };
}
