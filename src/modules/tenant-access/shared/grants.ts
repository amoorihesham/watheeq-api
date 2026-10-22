import type { Executor } from "@/db/pool.js";
import { PERMISSION_CATALOG, PERMISSION_SCOPES } from "../tenant-access.config.js";
import { createTenantAccessRepository } from "../tenant-access.repository.js";
import type {
  GrantMapType,
  GrantType,
  PermissionScopeType,
  TenantPermissionType,
} from "../tenant-access.types.js";
import { systemRoleGrants } from "./permissions.js";

const repo = createTenantAccessRepository();

const isCatalogKey = (key: string): key is TenantPermissionType =>
  Object.hasOwn(PERMISSION_CATALOG, key);

const rank = (scope: PermissionScopeType) => PERMISSION_SCOPES.indexOf(scope);

/** A role's grants as a map; the system role holds the whole catalog, and keys no longer in it are ignored. */
export function grantMapOf(role: {
  isSystem: boolean;
  grants: readonly { permission: string; scope: PermissionScopeType }[];
}): GrantMapType {
  const grants = role.isSystem
    ? systemRoleGrants()
    : role.grants.flatMap(({ permission, scope }) =>
        isCatalogKey(permission) ? [{ key: permission, scope }] : [],
      );
  return new Map(grants.map(({ key, scope }) => [key, scope]));
}

/**
 * The subset rule (D2, Phase 3 spec 4.3): the grants in `wanted` that `held` does not cover, one per permission at
 * the widest scope wanted. A grant is covered when `held` has the same permission at the same or a wider scope.
 * Empty means allowed.
 */
export function missingGrants(held: GrantMapType, wanted: Iterable<GrantType>): GrantType[] {
  const widest = new Map<TenantPermissionType, PermissionScopeType>();
  for (const { key, scope } of wanted) {
    const seen = widest.get(key);
    if (seen === undefined || rank(seen) < rank(scope)) {
      widest.set(key, scope);
    }
  }
  return [...widest].flatMap(([key, scope]) => {
    const heldScope = held.get(key);
    return heldScope === undefined || rank(heldScope) < rank(scope) ? [{ key, scope }] : [];
  });
}

/**
 * What the member holds right now, read in the caller's transaction instead of trusting a token that may be
 * 30 minutes old (R3.12, P3.4). A deactivated member, or a user outside the tenant, holds nothing.
 */
export async function loadMemberGrants(
  executor: Executor,
  tenantId: string,
  userId: string,
): Promise<GrantMapType> {
  const rows = await repo.memberRoleGrants(executor, tenantId, userId);
  const [first] = rows;
  if (!first?.isActive) {
    return new Map();
  }
  return grantMapOf({
    isSystem: first.isSystem,
    grants: rows.flatMap(({ permission, scope }) =>
      permission && scope ? [{ permission, scope }] : [],
    ),
  });
}
