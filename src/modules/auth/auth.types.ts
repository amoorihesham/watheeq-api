import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { passwordTokenPurposes } from "@/db/schema/password-tokens.js";
import type { userRoles } from "@/db/schema/users.js";
import type { EmailSenderType } from "@/email/index.js";
import type { SubscriptionStatusType } from "@/modules/subscriptions/index.js";
import type { createAuthController } from "./auth.controller.js";
import type { createAuthRepository } from "./auth.repository.js";
import type {
  accessTokenPayloadSchema,
  changePasswordRequestSchema,
  createOperatorRequestSchema,
  loginRequestSchema,
  passwordResetRequestSchema,
  resetPasswordRequestSchema,
  tenantClaimSchema,
  verifyEmailRequestSchema,
} from "./auth.schemas.js";
import type { createAuthService } from "./auth.service.js";

export type UserRoleType = (typeof userRoles.enumValues)[number];

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
  roleId: string | null;
  roleName: string | null;
  roleIsSystem: boolean | null;
  /** The keys stored for the role; the system role has none (P3.8). */
  rolePermissions: string[] | null;
}

/** The user's role and its permission keys, read at login and refresh (Phase 3 spec, R3.13). */
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
export type ChangePasswordRequestType = z.infer<typeof changePasswordRequestSchema>;
export type PasswordResetRequestType = z.infer<typeof passwordResetRequestSchema>;
export type ResetPasswordRequestType = z.infer<typeof resetPasswordRequestSchema>;

export interface LoginResponseType {
  user: AuthUserType;
}
export type RefreshResponseType = LoginResponseType;
export interface MeResponseType {
  user: AuthUserType;
  /** Null for an operator. Lets the client explain why actions are disabled in Grace or Read-only (R1.11). */
  subscription: SubscriptionStatusType | null;
}

export type PasswordTokenPurposeType = (typeof passwordTokenPurposes.enumValues)[number];

export interface NewPasswordTokenType {
  userId: string;
  purpose: PasswordTokenPurposeType;
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
  appBaseUrl: string;
  passwordResetTtlSeconds: number;
}

export interface AuthRouterDepsType {
  db: Db;
  config: Config;
  emailSender: EmailSenderType;
}

export type AuthRepositoryType = ReturnType<typeof createAuthRepository>;
export type AuthServiceType = ReturnType<typeof createAuthService>;
export type AuthControllerType = ReturnType<typeof createAuthController>;
