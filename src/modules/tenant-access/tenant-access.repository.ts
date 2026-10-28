import { and, eq, exists, or } from 'drizzle-orm';
import type { Executor } from '@/db/pool.js';
import { rolePermissions, roles, tenantMembers, users } from '@/db/schema/index.js';

export function createTenantAccessRepository() {
  return {
    /** One row per stored grant of the role; a role with no grants gives one row with nulls, a missing role none. */
    roleGrants(
      db: Executor,
      tenantId: string,
      roleId: string,
    ): Promise<
      {
        isSystem: boolean;
        permission: string | null;
        scope: (typeof rolePermissions.$inferSelect)['scope'] | null;
      }[]
    > {
      return db
        .select({
          isSystem: roles.isSystem,
          permission: rolePermissions.permission,
          scope: rolePermissions.scope,
        })
        .from(roles)
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)));
    },

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
        scope: (typeof rolePermissions.$inferSelect)['scope'] | null;
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
        .innerJoin(roles, and(eq(roles.tenantId, tenantMembers.tenantId), eq(roles.id, tenantMembers.roleId)))
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)));
    },

    /** Active members whose role is the system role or stores the permission at any scope. */
    holders(db: Executor, tenantId: string, permission: string): Promise<string[]> {
      return db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .innerJoin(roles, and(eq(roles.tenantId, tenantMembers.tenantId), eq(roles.id, tenantMembers.roleId)))
        .where(
          and(
            eq(tenantMembers.tenantId, tenantId),
            eq(users.isActive, true),
            or(
              eq(roles.isSystem, true),
              exists(
                db
                  .select({ one: rolePermissions.roleId })
                  .from(rolePermissions)
                  .where(and(eq(rolePermissions.roleId, roles.id), eq(rolePermissions.permission, permission))),
              ),
            ),
          ),
        )
        .then((rows) => rows.map((row) => row.userId));
    },
  };
}
