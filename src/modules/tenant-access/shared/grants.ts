import type { Executor } from "@/db/pool.js";
import { AppError } from "@/http/errors.js";
import {
  PERMISSION_CATALOG,
  PERMISSION_SCOPES,
  TENANT_PERMISSIONS,
} from "../tenant-access.config.js";
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

const storedGrants = (rows: { permission: string | null; scope: PermissionScopeType | null }[]) =>
  rows.flatMap(({ permission, scope }) => (permission && scope ? [{ permission, scope }] : []));

/** A grant map as a list in catalog order, so equal sets compare and audit the same. */
export const grantListOf = (grants: GrantMapType): GrantType[] =>
  TENANT_PERMISSIONS.flatMap((key) => {
    const scope = grants.get(key);
    return scope ? [{ key, scope }] : [];
  });

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
  return grantMapOf({ isSystem: first.isSystem, grants: storedGrants(rows) });
}

/** The grants of one of the tenant's roles, or null when the tenant has no such role. */
export async function loadRoleGrants(
  executor: Executor,
  tenantId: string,
  roleId: string,
): Promise<GrantMapType | null> {
  const rows = await repo.roleGrants(executor, tenantId, roleId);
  const [first] = rows;
  return first ? grantMapOf({ isSystem: first.isSystem, grants: storedGrants(rows) }) : null;
}

/** A grant the actor asks for; `path` is the request body entry that asked for it, when an input did. */
export interface WantedGrantType extends GrantType {
  path?: string;
}

/**
 * Throws PERMISSION_NOT_HELD unless the actor's role, as it is now, covers `wanted` (D2, R3.12). Callers include
 * the route's own permission, so a token that still carries it after it was removed is not enough (P3.4).
 * Each detail is the body entry (`path`) that asked for a grant the actor does not hold; a refusal that no input
 * caused (the route's own permission, the grants of an existing role) has no details (Phase 8 spec 4.2.5).
 */
export async function assertGrantsHeld(
  executor: Executor,
  tenantId: string,
  actorId: string,
  wanted: Iterable<WantedGrantType>,
): Promise<void> {
  const held = await loadMemberGrants(executor, tenantId, actorId);
  const refused = [...wanted].filter((grant) => missingGrants(held, [grant]).length > 0);
  if (refused.length > 0) {
    const paths = new Set(refused.flatMap(({ path }) => (path === undefined ? [] : [path])));
    throw new AppError(
      "PERMISSION_NOT_HELD",
      [...paths].map((path) => ({ path, code: "permission_not_held" })),
    );
  }
}

/** The active members whose role grants `permission` at any scope, or is the system role (T26). */
export const holdersOf = (
  executor: Executor,
  tenantId: string,
  permission: TenantPermissionType,
): Promise<string[]> => repo.holders(executor, tenantId, permission);
