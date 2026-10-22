import { z } from "zod";
import {
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_USER_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "./auth.config.js";

// The database check requires lower(btrim(email)), so every email is normalized before it reaches a query.
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(MAX_EMAIL_LENGTH));

export const userNameSchema = z.string().trim().min(1).max(MAX_USER_NAME_LENGTH);

export const newPasswordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

export const createOperatorRequestSchema = z.object({
  email: emailSchema,
  userName: userNameSchema,
  password: newPasswordSchema,
});

// No minimum length at login: the policy applies when a password is set. The cap stops hashing huge inputs.
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1).max(200),
  password: newPasswordSchema,
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: newPasswordSchema,
});

export const passwordResetRequestSchema = z.object({ email: emailSchema });

export const resetPasswordRequestSchema = verifyEmailRequestSchema;

export const tenantClaimSchema = z.object({
  id: z.uuid(),
  roleId: z.uuid(),
  roleName: z.string(),
  permissions: z.array(z.string()),
});

/** The claims `authenticate()` relies on; `iss`, `iat`, and `exp` are checked by `jwtVerify` itself. */
export const accessTokenPayloadSchema = z.object({
  sub: z.uuid(),
  username: z.string(),
  email: z.string(),
  role: z.enum(["user", "operator"]),
  tenant: tenantClaimSchema.nullable(),
});
