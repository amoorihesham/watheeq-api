import { eq, sql } from "drizzle-orm";
import { byName } from "@/db/order.js";
import type { Executor } from "@/db/pool.js";
import { files, roles, subscriptions, tenantMembers, tenants, users } from "@/db/schema/index.js";
import { riyadhToday } from "@/modules/subscriptions/index.js";
import type { NewTenantType, TenantOwnerType, TenantType } from "./tenants.types.js";

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
    tenant: tenants,
    subscription: subscriptions,
    activeUsers: activeMembers,
    storedBytes,
    today: riyadhToday,
  };

  return {
    insertTenant(db: Executor, values: NewTenantType): Promise<TenantType[]> {
      return db.insert(tenants).values(values).returning();
    },

    insertSystemRole(db: Executor, tenantId: string, name: string): Promise<{ id: string }[]> {
      return db
        .insert(roles)
        .values({ tenantId, name, isSystem: true })
        .returning({ id: roles.id });
    },

    insertAdminMember(db: Executor, tenantId: string, userId: string, roleId: string) {
      return db.insert(tenantMembers).values({ tenantId, userId, roleId });
    },

    list(db: Executor) {
      return db
        .select(detailColumns)
        .from(tenants)
        .innerJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
        .orderBy(byName(tenants.name));
    },

    findById(db: Executor, tenantId: string) {
      return db
        .select(detailColumns)
        .from(tenants)
        .innerJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
        .where(eq(tenants.id, tenantId));
    },

    findOwner(db: Executor, tenantId: string): Promise<TenantOwnerType[]> {
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
