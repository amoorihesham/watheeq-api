import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { tenantMemberRoles } from "@/db/schema/tenant-members.js";
import type { userRoles } from "@/db/schema/users.js";
import type { createAuthController } from "./auth.controller.js";
import type { createAuthRepository } from "./auth.repository.js";
import type {
  accessTokenPayloadSchema,
  createOperatorRequestSchema,
  loginRequestSchema,
  tenantClaimSchema,
  verifyEmailRequestSchema,
} from "./auth.schemas.js";
import type { createAuthService } from "./auth.service.js";

export type UserRoleType = (typeof userRoles.enumValues)[number];
export type TenantMemberRoleType = (typeof tenantMemberRoles.enumValues)[number];

export interface NewUserType {
  email: string;
  userName: string;
  /** Null for a first Tenant Admin, who sets a password through the verification link. */
  passwordHash: string | null;
  role: UserRoleType;
  emailVerifiedAt: Date | null;
}

export interface UserSummaryType {
  id: string;
  email: string;
  userName: string;
}

/** A user with their membership, as login and refresh read it. Tenant fields are null for operators. */
export interface AccountType {
  id: string;
  email: string;
  userName: string;
  passwordHash: string | null;
  role: UserRoleType;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  tenantId: string | null;
  tenantRole: TenantMemberRoleType | null;
}

/** Until Phase 3: `roleId` is null, `roleName` is the membership enum, `permissions` is empty (Phase 0 spec, P0.18). */
export type TenantClaimType = z.infer<typeof tenantClaimSchema>;

export type AccessTokenPayloadType = z.infer<typeof accessTokenPayloadSchema>;

/** The signed-in user: returned by the auth endpoints and attached to the request by `authenticate()`. */
export interface AuthUserType {
  id: string;
  email: string;
  userName: string;
  role: UserRoleType;
  tenant: TenantClaimType | null;
}

export type CreateOperatorRequestType = z.infer<typeof createOperatorRequestSchema>;
export type VerifyEmailRequestType = z.infer<typeof verifyEmailRequestSchema>;
export type LoginRequestType = z.infer<typeof loginRequestSchema>;

export interface LoginResponseType {
  user: AuthUserType;
}
export type RefreshResponseType = LoginResponseType;
export type MeResponseType = LoginResponseType;

export interface NewEmailVerificationType {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface PendingUserType {
  email: string;
  userName: string;
}

export interface NewRefreshTokenType {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface AuthTokensType {
  accessToken: string;
  refreshToken: string;
}

export interface AuthSessionType {
  user: AuthUserType;
  tokens: AuthTokensType;
}

export interface AuthSettingsType {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

export interface AuthRouterDepsType {
  db: Db;
  config: Config;
}

export type AuthRepositoryType = ReturnType<typeof createAuthRepository>;
export type AuthServiceType = ReturnType<typeof createAuthService>;
export type AuthControllerType = ReturnType<typeof createAuthController>;
