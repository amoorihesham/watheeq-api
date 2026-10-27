import type { z } from "zod";
import type { AuthConfigType, LinksConfigType } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { EmailSenderType } from "@/email/index.js";
import type { OrgUnitKindType } from "@/modules/org/index.js";
import type { createUsersController } from "./users.controller.js";
import type { createUsersRepository } from "./users.repository.js";
import type { userResponseSchema } from "./users.responses.js";
import type {
  assignRoleRequestSchema,
  inviteUserRequestSchema,
  listUsersQuerySchema,
  updateUserRequestSchema,
} from "./users.schemas.js";
import type { createUsersService } from "./users.service.js";

/** A tenant user as the API returns it. */
export type UserType = z.output<typeof userResponseSchema>;
export type UserStatusType = UserType["status"];

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

export interface UsersSettingsType {
  appBaseUrl: string;
  invitationTtlSeconds: number;
}

export interface UsersRouterDepsType {
  db: Db;
  auth: AuthConfigType;
  links: LinksConfigType;
  emailSender: EmailSenderType;
}

export type UsersRepositoryType = ReturnType<typeof createUsersRepository>;
export type UsersServiceType = ReturnType<typeof createUsersService>;
export type UsersControllerType = ReturnType<typeof createUsersController>;
