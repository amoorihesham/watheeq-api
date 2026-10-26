import { and, count, eq, type SQL, sql } from "drizzle-orm";
import type { Executor } from "@/db/pool.js";
import { rolePermissions, roles, tenantMembers } from "@/db/schema/index.js";
import type { PageRequestType } from "@/http/list.js";
import type { GrantType } from "@/modules/tenant-access/index.js";
import type { GrantRowType, RoleRowType } from "./roles.types.js";

const roleColumns = {
  id: roles.id,
  name: roles.name,
  isSystem: roles.isSystem,
  createdAt: roles.createdAt,
  updatedAt: roles.updatedAt,
};

const grantColumns = {
  roleId: rolePermissions.roleId,
  permission: rolePermissions.permission,
  scope: rolePermissions.scope,
};

const ofTenant = (tenantId: string, roleId: string) =>
  and(eq(roles.tenantId, tenantId), eq(roles.id, roleId));

/** Tenant code: every query is filtered by the caller's tenant (T2). */
export function createRolesRepository() {
  return {
    page(db: Executor, page: PageRequestType) {
      return db
        .select({ ...roleColumns, sortValues: page.sortValues })
        .from(roles)
        .where(page.where)
        .orderBy(...page.orderBy)
        .limit(page.limit);
    },

    async count(db: Executor, where: SQL | undefined): Promise<number> {
      const [row] = await db.select({ total: count() }).from(roles).where(where);
      return row?.total ?? 0;
    },

    findById(db: Executor, tenantId: string, roleId: string): Promise<RoleRowType[]> {
      return db.select(roleColumns).from(roles).where(ofTenant(tenantId, roleId));
    },

    /**
     * Locks the role. Two edits then run one after the other, so neither can add its grants beside the other's
     * (P3.5); a concurrent assignment checks its foreign key with a key-share lock, which waits for this one.
     */
    findByIdForUpdate(db: Executor, tenantId: string, roleId: string): Promise<RoleRowType[]> {
      return db.select(roleColumns).from(roles).where(ofTenant(tenantId, roleId)).for("update");
    },

    listGrants(db: Executor, tenantId: string, roleId?: string): Promise<GrantRowType[]> {
      return db
        .select(grantColumns)
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.tenantId, tenantId),
            roleId ? eq(rolePermissions.roleId, roleId) : undefined,
          ),
        );
    },

    countMembersByRole(
      db: Executor,
      tenantId: string,
      roleId?: string,
    ): Promise<{ roleId: string; memberCount: number }[]> {
      return db
        .select({ roleId: tenantMembers.roleId, memberCount: count() })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenantId, tenantId),
            roleId ? eq(tenantMembers.roleId, roleId) : undefined,
          ),
        )
        .groupBy(tenantMembers.roleId);
    },

    insert(db: Executor, tenantId: string, name: string): Promise<RoleRowType[]> {
      return db.insert(roles).values({ tenantId, name }).returning(roleColumns);
    },

    insertGrants(db: Executor, tenantId: string, roleId: string, grants: GrantType[]) {
      return db
        .insert(rolePermissions)
        .values(grants.map(({ key, scope }) => ({ tenantId, roleId, permission: key, scope })));
    },

    deleteGrants(db: Executor, tenantId: string, roleId: string) {
      return db
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleId, roleId)));
    },

    touch(db: Executor, tenantId: string, roleId: string, name: string): Promise<RoleRowType[]> {
      return db
        .update(roles)
        .set({ name, updatedAt: sql`now()` })
        .where(ofTenant(tenantId, roleId))
        .returning(roleColumns);
    },

    delete(db: Executor, tenantId: string, roleId: string) {
      return db.delete(roles).where(ofTenant(tenantId, roleId));
    },
  };
}
