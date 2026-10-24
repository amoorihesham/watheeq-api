import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { EmailSenderType } from "@/email/index.js";
import type { OrgUnitKindType } from "@/modules/org/index.js";
import type { USER_STATUSES } from "./users.config.js";
import type { createUsersController } from "./users.controller.js";
import type { createUsersRepository } from "./users.repository.js";
import type {
  assignRoleRequestSchema,
  inviteUserRequestSchema,
  listUsersQuerySchema,
  updateUserRequestSchema,
} from "./users.schemas.js";
import type { createUsersService } from "./users.service.js";

/** `invited`: has not set a password yet; `inactive`: deactivated. */
export type UserStatusType = (typeof USER_STATUSES)[number];

export interface UserRoleSummaryType {
  id: string;
  name: string;
  isSystem: boolean;
}

/** A tenant user as the API returns it. */
export interface UserType {
  id: string;
  email: string;
  userName: string;
  unit: { id: string; name: string; kind: OrgUnitKindType } | null;
  isManager: boolean;
  role: UserRoleSummaryType;
  isOwner: boolean;
  status: UserStatusType;
  createdAt: Date;
}

/** A user and their membership, as the repository reads them. */
export interface UserRowType {
  id: string;
  email: string;
  userName: string;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  roleId: string;
  roleName: string;
  roleIsSystem: boolean;
  unitId: string | null;
  isManager: boolean;
  positionId: string | null;
  unitName: string | null;
  unitKind: OrgUnitKindType | null;
  isOwner: boolean;
}

export interface NewMemberType {
  tenantId: string;
  userId: string;
  unitId: string | null;
  isManager: boolean;
  roleId: string;
}

export interface MemberChangesType {
  unitId?: string | null;
  isManager?: boolean;
  roleId?: string;
  positionId?: null;
}

export type InviteUserRequestType = z.input<typeof inviteUserRequestSchema>;
export type UpdateUserRequestType = z.input<typeof updateUserRequestSchema>;
export type AssignRoleRequestType = z.input<typeof assignRoleRequestSchema>;
export type ListUsersQueryType = z.output<typeof listUsersQuerySchema>;

/** The signed-in user acting on another user. */
export interface CallerType {
  id: string;
  userName: string;
}

export interface UserResponseType {
  user: UserType;
}
export interface ListUsersResponseType {
  users: UserType[];
  total: number;
}

export interface UsersSettingsType {
  appBaseUrl: string;
  invitationTtlSeconds: number;
}

export interface UsersRouterDepsType {
  db: Db;
  config: Config;
  emailSender: EmailSenderType;
}

export type UsersRepositoryType = ReturnType<typeof createUsersRepository>;
export type UsersServiceType = ReturnType<typeof createUsersService>;
export type UsersControllerType = ReturnType<typeof createUsersController>;
