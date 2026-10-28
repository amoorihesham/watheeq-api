import { and, count, eq, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';
import { byName } from '@/db/order.js';
import type { Executor } from '@/db/pool.js';
import { services, serviceWorkflows, workflows } from '@/db/schema/index.js';
import type { PageRequestType, SortKeyType } from '@/http/list.js';
import type { AllowedWorkflowRowType, ServiceRowType, WorkflowChoiceType, WorkflowStateRowType } from './services.types.js';
import type { FormFieldType } from './shared/form.js';

const serviceColumns = {
  id: services.id,
  name: services.name,
  description: services.description,
  retiredAt: services.retiredAt,
  form: services.form,
  formRevision: services.formRevision,
};

/** By name, then ID (T20). */
export const SERVICE_SORT_KEYS: SortKeyType[] = [
  { expr: byName(services.name), type: 'text' },
  { expr: sql`${services.id}`, type: 'uuid' },
];

const ofTenant = (tenantId: string, serviceId: string) => and(eq(services.tenantId, tenantId), eq(services.id, serviceId));

/** Tenant code: every query is filtered by the caller's tenant (T2). */
export function createServicesRepository() {
  return {
    /** The tenant's services that match the `retired` filter. */
    listWhere(tenantId: string, retired: string): SQL | undefined {
      return and(eq(services.tenantId, tenantId), retired === 'all' ? undefined : retired === 'true' ? isNotNull(services.retiredAt) : isNull(services.retiredAt));
    },

    selectPage(db: Executor, page: PageRequestType) {
      return db
        .select({ ...serviceColumns, sortValues: page.sortValues })
        .from(services)
        .where(page.where)
        .orderBy(...page.orderBy)
        .limit(page.limit);
    },

    async count(db: Executor, where: SQL | undefined): Promise<number> {
      const [row] = await db.select({ total: count() }).from(services).where(where);
      return Number(row?.total ?? 0);
    },

    findById(db: Executor, tenantId: string, serviceId: string): Promise<ServiceRowType[]> {
      return db.select(serviceColumns).from(services).where(ofTenant(tenantId, serviceId));
    },

    /** Locks the service, so saves, retiring, and restoring of it run one after the other. */
    findByIdForUpdate(db: Executor, tenantId: string, serviceId: string): Promise<ServiceRowType[]> {
      return db.select(serviceColumns).from(services).where(ofTenant(tenantId, serviceId)).for('update');
    },

    /** The allowed workflows of the given services, by workflow name. */
    workflowsOf(db: Executor, tenantId: string, serviceIds: string[]): Promise<AllowedWorkflowRowType[]> {
      if (serviceIds.length === 0) {
        return Promise.resolve([]);
      }
      return db
        .select({
          serviceId: serviceWorkflows.serviceId,
          id: workflows.id,
          name: workflows.name,
          isDefault: serviceWorkflows.isDefault,
          retiredAt: workflows.retiredAt,
        })
        .from(serviceWorkflows)
        .innerJoin(workflows, and(eq(workflows.tenantId, serviceWorkflows.tenantId), eq(workflows.id, serviceWorkflows.workflowId)))
        .where(and(eq(serviceWorkflows.tenantId, tenantId), inArray(serviceWorkflows.serviceId, serviceIds)))
        .orderBy(byName(workflows.name), workflows.id);
    },

    /**
     * Locks the named workflows against retiring (`FOR SHARE` pairs with the retire's `FOR UPDATE`) and returns
     * their state; a missing or foreign id is absent. Ordered by id so two saves cannot deadlock.
     */
    lockWorkflows(db: Executor, tenantId: string, workflowIds: string[]): Promise<WorkflowStateRowType[]> {
      if (workflowIds.length === 0) {
        return Promise.resolve([]);
      }
      return db
        .select({ id: workflows.id, retiredAt: workflows.retiredAt })
        .from(workflows)
        .where(and(eq(workflows.tenantId, tenantId), inArray(workflows.id, workflowIds)))
        .orderBy(workflows.id)
        .for('share');
    },

    insert(db: Executor, values: { id: string; tenantId: string; name: string; description: string | null }) {
      return db.insert(services).values(values);
    },

    update(db: Executor, tenantId: string, serviceId: string, patch: { name?: string; description?: string | null }) {
      return db
        .update(services)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(ofTenant(tenantId, serviceId));
    },

    async replaceWorkflows(db: Executor, tenantId: string, serviceId: string, choices: WorkflowChoiceType[]) {
      await db.delete(serviceWorkflows).where(and(eq(serviceWorkflows.tenantId, tenantId), eq(serviceWorkflows.serviceId, serviceId)));
      await db.insert(serviceWorkflows).values(
        choices.map((choice) => ({
          tenantId,
          serviceId,
          workflowId: choice.id,
          isDefault: choice.isDefault,
        })),
      );
    },

    setForm(db: Executor, tenantId: string, serviceId: string, form: FormFieldType[], revision: number) {
      return db.update(services).set({ form, formRevision: revision, updatedAt: sql`now()` }).where(ofTenant(tenantId, serviceId));
    },

    setRetired(db: Executor, tenantId: string, serviceId: string, retired: boolean) {
      return db
        .update(services)
        .set({ retiredAt: retired ? sql`now()` : null, updatedAt: sql`now()` })
        .where(ofTenant(tenantId, serviceId));
    },
  };
}
