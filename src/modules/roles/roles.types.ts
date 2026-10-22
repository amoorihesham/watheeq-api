import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type {
  GrantType,
  PermissionScopeType,
  TenantPermissionType,
} from "@/modules/tenant-access/index.js";
import type { createRolesController } from "./roles.controller.js";
import type { createRolesRepository } from "./roles.repository.js";
import type { createRoleRequestSchema, updateRoleRequestSchema } from "./roles.schemas.js";
import type { createRolesService } from "./roles.service.js";

/** A role row, without its grants. */
export interface RoleRowType {
  id: string;
  name: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** One stored grant of a role. */
export interface GrantRowType {
  roleId: string;
  permission: string;
  scope: PermissionScopeType;
}

/** A role as the API returns it; the system role lists its computed grants (P3.8). */
export interface RoleType extends RoleRowType {
  permissions: GrantType[];
  /** Users holding the role, active or not: the role can be deleted only at zero (R3.7). */
  memberCount: number;
}

export type CreateRoleRequestType = z.input<typeof createRoleRequestSchema>;
export type UpdateRoleRequestType = z.input<typeof updateRoleRequestSchema>;

export interface ListPermissionsResponseType {
  permissions: { key: TenantPermissionType; scopes: readonly PermissionScopeType[] }[];
}
export interface ListRolesResponseType {
  roles: RoleType[];
}
export interface RoleResponseType {
  role: RoleType;
}

export interface RolesRouterDepsType {
  db: Db;
  config: Config;
}

export type RolesRepositoryType = ReturnType<typeof createRolesRepository>;
export type RolesServiceType = ReturnType<typeof createRolesService>;
export type RolesControllerType = ReturnType<typeof createRolesController>;
