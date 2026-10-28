import { type AnyColumn, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { orgUnits, rolePermissions, roles, tenantMembers, users } from '@/db/schema/index.js';
import type { TenantPermissionType } from '../tenant-access.types.js';

// In a raw sql template an alias renders as its name only, so each FROM and JOIN names the table before it.
const caller = alias(tenantMembers, 'scope_caller');
const callerUser = alias(users, 'scope_caller_user');
const callerRole = alias(roles, 'scope_caller_role');
const callerGrant = alias(rolePermissions, 'scope_caller_grant');
const callerUnit = alias(orgUnits, 'scope_caller_unit');
const departmentUnit = alias(orgUnits, 'scope_department_unit');

/**
 * True for a row the caller may see under `permission` (R3.14, Phase 3 spec 4.3), given the row's owner and
 * unit. Resolved inside the query from the caller's current unit and role, so a move or a role edit applies on
 * the next request whatever the token says (R3.16). The caller always reaches themselves when they hold the
 * permission at any scope; with no unit, section and department scope reach nobody else; a deactivated caller or
 * one without the grant reaches nothing.
 */
export function withinScope({ tenantId, callerId, permission, ownerId, unitId }: { tenantId: string; callerId: string; permission: TenantPermissionType; ownerId: AnyColumn; unitId: AnyColumn }): SQL {
  const scope = sql`case when ${callerRole.isSystem} then 'organization' else ${callerGrant.scope}::text end`;
  const department = sql`coalesce(${callerUnit.parentId}, ${callerUnit.id})`;
  return sql`exists (
    select 1 from ${tenantMembers} ${caller}
    join ${users} ${callerUser} on ${callerUser.id} = ${caller.userId}
    join ${roles} ${callerRole} on ${callerRole.tenantId} = ${caller.tenantId} and ${callerRole.id} = ${caller.roleId}
    left join ${rolePermissions} ${callerGrant} on ${callerGrant.roleId} = ${callerRole.id} and ${callerGrant.permission} = ${permission}
    left join ${orgUnits} ${callerUnit} on ${callerUnit.tenantId} = ${caller.tenantId} and ${callerUnit.id} = ${caller.unitId}
    where ${caller.tenantId} = ${tenantId} and ${caller.userId} = ${callerId} and ${callerUser.isActive}
      and ${scope} is not null
      and (
        ${ownerId} = ${caller.userId}
        or ${scope} = 'organization'
        or (${scope} = 'section' and ${unitId} = ${caller.unitId})
        or (${scope} = 'department' and ${unitId} in (
          select ${departmentUnit.id} from ${orgUnits} ${departmentUnit}
          where ${departmentUnit.tenantId} = ${caller.tenantId}
            and (${departmentUnit.id} = ${department} or ${departmentUnit.parentId} = ${department})
        ))
      )
  )`;
}
