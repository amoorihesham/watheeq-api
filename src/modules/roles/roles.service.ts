import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import { AppError, type ErrorDetail } from "@/http/errors.js";
import { validate } from "@/http/validate.js";
import {
  type GrantMapType,
  type GrantType,
  grantMapOf,
  loadMemberGrants,
  missingGrants,
  PERMISSION_CATALOG,
  type PermissionScopeType,
  TENANT_PERMISSIONS,
  type TenantPermissionType,
} from "@/modules/tenant-access/index.js";
import { createRoleRequestSchema, roleIdSchema, updateRoleRequestSchema } from "./roles.schemas.js";
import type {
  CreateRoleRequestType,
  GrantRowType,
  ListPermissionsResponseType,
  ListRolesResponseType,
  RoleRowType,
  RolesRepositoryType,
  RoleType,
  UpdateRoleRequestType,
} from "./roles.types.js";

/** A non-UUID id is answered like an unknown one, never as a database cast error. */
function existingRoleId(roleId: string): string {
  if (!roleIdSchema.safeParse(roleId).success) {
    throw new AppError("NOT_FOUND");
  }
  return roleId;
}

/** Grants in catalog order, so equal sets compare and audit the same whatever order a client sent. */
const listOf = (grants: GrantMapType): GrantType[] =>
  TENANT_PERMISSIONS.flatMap((key) => {
    const scope = grants.get(key);
    return scope ? [{ key, scope }] : [];
  });

const sameGrants = (a: GrantType[], b: GrantType[]) => JSON.stringify(a) === JSON.stringify(b);

const grantsOfRole = (role: RoleRowType, rows: GrantRowType[]): GrantMapType =>
  grantMapOf({ isSystem: role.isSystem, grants: rows.filter((row) => row.roleId === role.id) });

const toRole = (role: RoleRowType, rows: GrantRowType[], memberCount: number): RoleType => ({
  ...role,
  permissions: listOf(grantsOfRole(role, rows)),
  memberCount,
});

const isCatalogKey = (key: string): key is TenantPermissionType =>
  Object.hasOwn(PERMISSION_CATALOG, key);

/** Checks each requested grant against the catalog (R3.4); every problem is reported, by index. */
function catalogGrants(requested: { key: string; scope: PermissionScopeType }[]): GrantType[] {
  const details: ErrorDetail[] = [];
  const grants = new Map<TenantPermissionType, PermissionScopeType>();
  requested.forEach(({ key, scope }, index) => {
    if (!isCatalogKey(key)) {
      details.push({ path: `permissions.${index}.key`, code: "unknown_permission" });
    } else if (grants.has(key)) {
      details.push({ path: `permissions.${index}.key`, code: "duplicate_permission" });
    } else if (!(PERMISSION_CATALOG[key] as readonly string[]).includes(scope)) {
      details.push({ path: `permissions.${index}.scope`, code: "scope_not_allowed" });
    } else {
      grants.set(key, scope);
    }
  });
  if (details.length > 0) {
    throw new AppError("VALIDATION_FAILED", details);
  }
  return listOf(grants);
}

/** One detail per permission the actor lacks, or holds only at a narrower scope than `scope`. */
const notHeld = (missing: GrantType[]) =>
  new AppError(
    "PERMISSION_NOT_HELD",
    missing.map(({ key, scope }) => ({ path: key, code: "permission_not_held", scope })),
  );

export function createRolesService({ db, repo }: { db: Db; repo: RolesRepositoryType }) {
  /**
   * The subset rule (D2, R3.8) against the actor's role as it is now (R3.12), including the route's own
   * permission (P3.4): a token that still carries `role.manage` after it was removed is not enough.
   */
  async function assertWithinActor(
    executor: Executor,
    tenantId: string,
    actorId: string,
    wanted: GrantType[],
  ) {
    const held = await loadMemberGrants(executor, tenantId, actorId);
    const missing = missingGrants(held, [{ key: "role.manage", scope: "organization" }, ...wanted]);
    if (missing.length > 0) {
      throw notHeld(missing);
    }
  }

  async function loadRole(executor: Executor, tenantId: string, roleId: string) {
    const [role] = await repo.findById(executor, tenantId, roleId);
    if (!role) {
      throw new AppError("NOT_FOUND");
    }
    const [grants, [counted]] = await Promise.all([
      repo.listGrants(executor, tenantId, roleId),
      repo.countMembersByRole(executor, tenantId, roleId),
    ]);
    return toRole(role, grants, counted?.memberCount ?? 0);
  }

  /** Locks the role (P3.5) and reads it; the system role is never changed (R3.2). */
  async function lockEditableRole(executor: Executor, tenantId: string, roleId: string) {
    const [role] = await repo.findByIdForUpdate(executor, tenantId, roleId);
    if (!role) {
      throw new AppError("NOT_FOUND");
    }
    if (role.isSystem) {
      throw new AppError("ROLE_PROTECTED");
    }
    const grants = listOf(grantsOfRole(role, await repo.listGrants(executor, tenantId, roleId)));
    return { role, grants };
  }

  return {
    permissions(): ListPermissionsResponseType {
      return {
        permissions: TENANT_PERMISSIONS.map((key) => ({ key, scopes: PERMISSION_CATALOG[key] })),
      };
    },

    async list(tenantId: string): Promise<ListRolesResponseType> {
      const [rows, grants, counts] = await Promise.all([
        repo.list(db, tenantId),
        repo.listGrants(db, tenantId),
        repo.countMembersByRole(db, tenantId),
      ]);
      const memberCount = new Map(counts.map((row) => [row.roleId, row.memberCount]));
      return { roles: rows.map((role) => toRole(role, grants, memberCount.get(role.id) ?? 0)) };
    },

    get(tenantId: string, roleId: string): Promise<RoleType> {
      return loadRole(db, tenantId, existingRoleId(roleId));
    },

    /** A duplicate name (any case) reaches the error handler as ROLE_NAME_TAKEN (R3.5). */
    create(
      tenantId: string,
      actorId: string,
      input: CreateRoleRequestType,
      context: AuditContextType,
    ): Promise<RoleType> {
      const body = validate(createRoleRequestSchema, input);
      const grants = catalogGrants(body.permissions);
      return withTx(db, async (tx) => {
        await assertWithinActor(tx, tenantId, actorId, grants);
        const [role] = await repo.insert(tx, tenantId, body.name);
        if (!role) {
          throw new Error("insert returned no row");
        }
        if (grants.length > 0) {
          await repo.insertGrants(tx, tenantId, role.id, grants);
        }
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "role.created",
          resourceType: "role",
          resourceId: role.id,
          details: { name: role.name, isSystem: false, permissions: grants },
        });
        return { ...role, permissions: grants, memberCount: 0 };
      });
    },

    /**
     * Renames a role or replaces its grants (R3.6). Both the current and the new grants must be within the
     * actor's (R3.8), so nobody takes away powers they do not hold. A change reaches holders at their next refresh.
     */
    update(
      tenantId: string,
      roleId: string,
      actorId: string,
      input: UpdateRoleRequestType,
      context: AuditContextType,
    ): Promise<RoleType> {
      const id = existingRoleId(roleId);
      const body = validate(updateRoleRequestSchema, input);
      const requested =
        body.permissions === undefined ? undefined : catalogGrants(body.permissions);
      return withTx(db, async (tx) => {
        const { role: before, grants: beforeGrants } = await lockEditableRole(tx, tenantId, id);
        const name = body.name ?? before.name;
        const grants = requested ?? beforeGrants;
        await assertWithinActor(tx, tenantId, actorId, [...beforeGrants, ...grants]);

        const nameChanged = name !== before.name;
        const grantsChanged = !sameGrants(grants, beforeGrants);
        if (!nameChanged && !grantsChanged) {
          return loadRole(tx, tenantId, id);
        }
        await repo.touch(tx, tenantId, id, name);
        if (grantsChanged) {
          await repo.deleteGrants(tx, tenantId, id);
          if (grants.length > 0) {
            await repo.insertGrants(tx, tenantId, id, grants);
          }
        }
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "role.updated",
          resourceType: "role",
          resourceId: id,
          details: {
            before: {
              ...(nameChanged ? { name: before.name } : {}),
              ...(grantsChanged ? { permissions: beforeGrants } : {}),
            },
            after: {
              ...(nameChanged ? { name } : {}),
              ...(grantsChanged ? { permissions: grants } : {}),
            },
          },
        });
        return loadRole(tx, tenantId, id);
      });
    },

    /** Deletes a role nobody holds, active or not (R3.7). The lock makes the check hold under concurrency. */
    delete(
      tenantId: string,
      roleId: string,
      actorId: string,
      context: AuditContextType,
    ): Promise<void> {
      const id = existingRoleId(roleId);
      return withTx(db, async (tx) => {
        const { role, grants } = await lockEditableRole(tx, tenantId, id);
        await assertWithinActor(tx, tenantId, actorId, grants);
        const [holders] = await repo.countMembersByRole(tx, tenantId, id);
        if ((holders?.memberCount ?? 0) > 0) {
          throw new AppError("ROLE_IN_USE");
        }
        await repo.delete(tx, tenantId, id);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "role.deleted",
          resourceType: "role",
          resourceId: id,
          details: { name: role.name, permissions: grants },
        });
      });
    },
  };
}
