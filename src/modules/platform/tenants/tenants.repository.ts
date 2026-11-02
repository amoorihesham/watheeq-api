import { and, count, eq, ilike, or, type SQL, sql } from 'drizzle-orm';
import type { Executor } from '@/db/pool.js';
import { files, roles, subscriptions, tenantMembers, tenants, users } from '@/db/schema/index.js';
import { containing } from '@/db/search.js';
import type { PageRequestType } from '@/http/list.js';
import { riyadhToday, subscriptionStateIs } from '@/modules/subscriptions/index.js';
import type { ListTenantsQueryType, NewTenantType, OwnerAccountType, TenantRowType } from './tenants.types.js';

const activeMembers = sql<number>`(
  select count(*)::int from ${tenantMembers}
  join ${users} on ${users.id} = ${tenantMembers.userId}
  where ${tenantMembers.tenantId} = ${tenants.id} and ${users.isActive}
)`;

const storedBytes = sql<number>`(
  select coalesce(sum(${files.sizeBytes}), 0)::float8 from ${files} where ${files.tenantId} = ${tenants.id}
)`;

/** Platform code: reads across tenants, reached only behind `requireRole("operator")` (P1.1). */
export function createTenantsRepository() {
  const detailColumns = {
    tenant: { id: tenants.id, name: tenants.name, slug: tenants.slug, createdAt: tenants.createdAt },
    owner: { id: users.id, email: users.email, userName: users.userName, verifiedAt: users.emailVerifiedAt, invitationEmail: users.invitationEmail },
    subscription: subscriptions,
    activeUsers: activeMembers,
    storedBytes,
    today: riyadhToday,
  };

  return {
    insertTenant(db: Executor, values: NewTenantType): Promise<TenantRowType[]> {
      return db.insert(tenants).values(values).returning();
    },

    insertSystemRole(db: Executor, tenantId: string, name: string): Promise<{ id: string }[]> {
      return db.insert(roles).values({ tenantId, name, isSystem: true }).returning({ id: roles.id });
    },

    insertAdminMember(db: Executor, tenantId: string, userId: string, roleId: string) {
      return db.insert(tenantMembers).values({ tenantId, userId, roleId });
    },

    listWhere(filters: Omit<ListTenantsQueryType, 'cursor' | 'limit'>): SQL | undefined {
      return and(filters.state === 'all' ? undefined : subscriptionStateIs(filters.state), filters.q ? or(ilike(tenants.name, containing(filters.q)), ilike(tenants.slug, containing(filters.q))) : undefined);
    },

    page(db: Executor, page: PageRequestType) {
      return db
        .select({ ...detailColumns, sortValues: page.sortValues })
        .from(tenants)
        .innerJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
        .innerJoin(users, eq(users.id, tenants.ownerId))
        .where(page.where)
        .orderBy(...page.orderBy)
        .limit(page.limit);
    },

    async count(db: Executor, where: SQL | undefined): Promise<number> {
      const [row] = await db.select({ total: count() }).from(tenants).innerJoin(subscriptions, eq(subscriptions.tenantId, tenants.id)).where(where);
      return row?.total ?? 0;
    },

    findById(db: Executor, tenantId: string) {
      return db.select(detailColumns).from(tenants).innerJoin(subscriptions, eq(subscriptions.tenantId, tenants.id)).innerJoin(users, eq(users.id, tenants.ownerId)).where(eq(tenants.id, tenantId));
    },

    findOwner(db: Executor, tenantId: string): Promise<OwnerAccountType[]> {
      return db
        .select({
          id: users.id,
          email: users.email,
          userName: users.userName,
          emailVerifiedAt: users.emailVerifiedAt,
        })
        .from(tenants)
        .innerJoin(users, eq(users.id, tenants.ownerId))
        .where(eq(tenants.id, tenantId));
    },
  };
}
