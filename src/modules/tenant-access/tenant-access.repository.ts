import { and, eq } from "drizzle-orm";
import type { Executor } from "@/db/pool.js";
import { rolePermissions, roles, tenantMembers, users } from "@/db/schema/index.js";

export function createTenantAccessRepository() {
  return {
    /** One row per stored grant of the member's role; a role with no grants gives one row with nulls. */
    memberRoleGrants(
      db: Executor,
      tenantId: string,
      userId: string,
    ): Promise<
      {
        isActive: boolean;
        isSystem: boolean;
        permission: string | null;
        scope: (typeof rolePermissions.$inferSelect)["scope"] | null;
      }[]
    > {
      return db
        .select({
          isActive: users.isActive,
          isSystem: roles.isSystem,
          permission: rolePermissions.permission,
          scope: rolePermissions.scope,
        })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .innerJoin(
          roles,
          and(eq(roles.tenantId, tenantMembers.tenantId), eq(roles.id, tenantMembers.roleId)),
        )
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)));
    },
  };
}
