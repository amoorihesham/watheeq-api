import { z } from 'zod';
import { idSchema } from '@/http/validate.js';
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH, MAX_USER_NAME_LENGTH, MIN_PASSWORD_LENGTH } from './auth.constants.js';

// The database check requires lower(btrim(email)), so every email is normalized before it reaches a query.
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(MAX_EMAIL_LENGTH));

export const userNameSchema = z.string().trim().min(1).max(MAX_USER_NAME_LENGTH);

export const newPasswordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

export const createOperatorRequestSchema = z.strictObject({
  email: emailSchema,
  userName: userNameSchema,
  password: newPasswordSchema,
});

// No minimum length at login: the policy applies when a password is set. The cap stops hashing huge inputs.
export const loginRequestSchema = z
  .strictObject({
    email: emailSchema,
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  })
  .meta({ id: 'LoginRequest' });

const tokenAndPasswordShape = {
  token: z.string().min(1).max(200),
  password: newPasswordSchema,
};

export const verifyEmailRequestSchema = z.strictObject(tokenAndPasswordShape).meta({ id: 'VerifyEmailRequest' });

export const changePasswordRequestSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
    newPassword: newPasswordSchema,
  })
  .meta({ id: 'ChangePasswordRequest' });

export const passwordResetRequestSchema = z.strictObject({ email: emailSchema }).meta({ id: 'PasswordResetRequest' });

export const resetPasswordRequestSchema = z.strictObject(tokenAndPasswordShape).meta({ id: 'ResetPasswordRequest' });

// Token schemas stay lenient: a JWT carries standard claims (iss, iat, exp) these do not list.
export const tenantClaimSchema = z.object({
  id: idSchema,
  roleId: idSchema,
  roleName: z.string(),
  permissions: z.array(z.string()),
});

/** The claims `authenticate()` relies on; `iss`, `iat`, and `exp` are checked by `jwtVerify` itself. */
export const accessTokenPayloadSchema = z.object({
  sub: idSchema,
  username: z.string(),
  email: z.string(),
  role: z.enum(['user', 'operator']),
  tenant: tenantClaimSchema.nullable(),
});
