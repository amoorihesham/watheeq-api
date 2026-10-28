import type { z } from 'zod';
import type { AuthConfigType } from '@/config/config.js';
import type { Db } from '@/db/pool.js';
import type { PermissionScopeType } from '@/modules/tenant-access/index.js';
import type { createRolesController } from './roles.controller.js';
import type { createRolesRepository } from './roles.repository.js';
import type { permissionResponseSchema, roleResponseSchema } from './roles.responses.js';
import type { createRoleRequestSchema, listPermissionsQuerySchema, listRolesQuerySchema, updateRoleRequestSchema } from './roles.schemas.js';
import type { createRolesService } from './roles.service.js';

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
export type RoleType = z.output<typeof roleResponseSchema>;

export type CreateRoleRequestType = z.output<typeof createRoleRequestSchema>;
export type UpdateRoleRequestType = z.output<typeof updateRoleRequestSchema>;

export type PermissionType = z.output<typeof permissionResponseSchema>;
export type ListRolesQueryType = z.output<typeof listRolesQuerySchema>;
export type ListPermissionsQueryType = z.output<typeof listPermissionsQuerySchema>;

export interface RolesRouterDepsType {
  db: Db;
  auth: AuthConfigType;
}

export type RolesRepositoryType = ReturnType<typeof createRolesRepository>;
export type RolesServiceType = ReturnType<typeof createRolesService>;
export type RolesControllerType = ReturnType<typeof createRolesController>;
