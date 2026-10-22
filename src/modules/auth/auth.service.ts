import { writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import type { EmailSenderType } from "@/email/index.js";
import { AppError } from "@/http/errors.js";
import { validate } from "@/http/validate.js";
import type { Logger } from "@/logging/logger.js";
import { toSubscriptionStatus } from "@/modules/subscriptions/index.js";
import { grantedPermissions } from "@/modules/tenant-access/index.js";
import { DUMMY_PASSWORD_HASH } from "./auth.config.js";
import { createAuthRepository } from "./auth.repository.js";
import {
  changePasswordRequestSchema,
  createOperatorRequestSchema,
  loginRequestSchema,
  passwordResetRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
} from "./auth.schemas.js";
import type {
  AccountType,
  AuthRepositoryType,
  AuthSessionType,
  AuthSettingsType,
  AuthUserType,
  ChangePasswordRequestType,
  CreateOperatorRequestType,
  LoginRequestType,
  MeResponseType,
  PasswordResetRequestType,
  ResetPasswordRequestType,
  UserSummaryType,
  VerifyEmailRequestType,
} from "./auth.types.js";
import { issuePasswordToken, passwordResetEmail } from "./shared/onboarding.js";
import { hashPassword, verifyPassword } from "./shared/passwords.js";
import { generateOpaqueToken, hashToken, signAccessToken } from "./shared/tokens.js";

const toAuthUser = (account: AccountType): AuthUserType => ({
  id: account.id,
  email: account.email,
  userName: account.userName,
  role: account.role,
  tenant:
    account.tenantId && account.roleId && account.roleName
      ? {
          id: account.tenantId,
          roleId: account.roleId,
          roleName: account.roleName,
          permissions: grantedPermissions({
            isSystem: account.roleIsSystem ?? false,
            permissions: account.rolePermissions ?? [],
          }),
        }
      : null,
});

export function createAuthService({
  db,
  repo,
  settings,
  emailSender,
}: {
  db: Db;
  repo: AuthRepositoryType;
  settings: AuthSettingsType;
  emailSender: EmailSenderType;
}) {
  async function issueSession(executor: Executor, account: AccountType): Promise<AuthSessionType> {
    const user = toAuthUser(account);
    const accessToken = await signAccessToken(
      user,
      settings.jwtSecret,
      settings.accessTokenTtlSeconds,
    );
    const refreshToken = generateOpaqueToken();
    await repo.insertRefreshToken(executor, {
      userId: account.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + settings.refreshTokenTtlSeconds * 1000),
    });
    return { user, tokens: { accessToken, refreshToken } };
  }

  return {
    /** Every failure is the same INVALID_CREDENTIALS, so the response does not reveal which emails exist. */
    async login(input: LoginRequestType): Promise<AuthSessionType> {
      const { email, password } = validate(loginRequestSchema, input);
      const [account] = await repo.findAccountByEmail(db, email);
      // An unverified Tenant Admin has no password yet, and is answered exactly like an unknown email (P1.17).
      if (!account?.passwordHash || !account.emailVerifiedAt) {
        await verifyPassword(DUMMY_PASSWORD_HASH, password);
        throw new AppError("INVALID_CREDENTIALS");
      }
      const passwordMatches = await verifyPassword(account.passwordHash, password);
      if (!passwordMatches || !account.isActive) {
        throw new AppError("INVALID_CREDENTIALS");
      }
      return issueSession(db, account);
    },

    /**
     * Rotates a refresh token: revokes it and issues a new session with the account's current data.
     * Returns null when the token is missing, unknown, revoked, or expired, or the user is inactive (P0.8).
     */
    refresh(refreshToken: string | undefined): Promise<AuthSessionType | null> {
      if (!refreshToken) {
        return Promise.resolve(null);
      }
      return withTx(db, async (tx) => {
        const [consumed] = await repo.consumeRefreshToken(tx, hashToken(refreshToken));
        if (!consumed) {
          return null;
        }
        const [account] = await repo.findAccountById(tx, consumed.userId);
        if (!account?.isActive || !account.emailVerifiedAt) {
          return null;
        }
        return issueSession(tx, account);
      });
    },

    async logout(refreshToken: string | undefined): Promise<void> {
      if (refreshToken) {
        await repo.revokeRefreshToken(db, hashToken(refreshToken));
      }
    },

    /**
     * Uses the link, sets the password, and marks the email verified, in one transaction (P1.15).
     * Unknown, used, expired, and replaced links all give VERIFICATION_INVALID.
     */
    async verifyEmail(input: VerifyEmailRequestType, requestId: string): Promise<void> {
      const { token, password } = validate(verifyEmailRequestSchema, input);
      const passwordHash = await hashPassword(password);
      await withTx(db, async (tx) => {
        const [link] = await repo.consumePasswordToken(tx, hashToken(token), "invitation");
        if (!link) {
          throw new AppError("VERIFICATION_INVALID");
        }
        const [verified] = await repo.setVerifiedPassword(tx, link.userId, passwordHash);
        if (!verified) {
          throw new AppError("VERIFICATION_INVALID");
        }
        const [account] = await repo.findAccountById(tx, link.userId);
        await writeAuditEntry(tx, {
          tenantId: account?.tenantId ?? null,
          actor: { type: "user", id: link.userId },
          action: "user.email_verified",
          resourceType: "user",
          resourceId: link.userId,
          requestId,
        });
      });
    },

    /**
     * Sets a new password after checking the current one, and signs out the user's other sessions (R2.16).
     * The session making the request keeps its refresh token.
     */
    async changePassword(
      user: AuthUserType,
      input: ChangePasswordRequestType,
      refreshToken: string | undefined,
      requestId: string,
    ): Promise<void> {
      const { currentPassword, newPassword } = validate(changePasswordRequestSchema, input);
      const [account] = await repo.findAccountById(db, user.id);
      if (
        !account?.passwordHash ||
        !(await verifyPassword(account.passwordHash, currentPassword))
      ) {
        throw new AppError("INVALID_CREDENTIALS");
      }
      const passwordHash = await hashPassword(newPassword);
      await withTx(db, async (tx) => {
        await repo.setPassword(tx, account.id, passwordHash);
        await repo.revokeOtherRefreshTokens(tx, account.id, hashToken(refreshToken ?? ""));
        await writeAuditEntry(tx, {
          tenantId: account.tenantId,
          actor: { type: account.role, id: account.id },
          action: "user.password_changed",
          resourceType: "user",
          resourceId: account.id,
          requestId,
        });
      });
    },

    /**
     * Validates the request now and returns the rest as work to run after responding (P2.7): the 204 goes out
     * before the account is even looked up, so neither the response nor its timing reveals whether it exists.
     * Only an active user who has set a password gets an email; an invited user uses their invitation (R2.17).
     */
    requestPasswordReset(input: PasswordResetRequestType, log: Logger): () => Promise<void> {
      const { email } = validate(passwordResetRequestSchema, input);
      return async () => {
        try {
          const [account] = await repo.findAccountByEmail(db, email);
          if (!account?.isActive || !account.emailVerifiedAt || !account.passwordHash) {
            return;
          }
          const token = await withTx(db, (tx) =>
            issuePasswordToken(tx, account.id, "reset", settings.passwordResetTtlSeconds),
          );
          await emailSender.send(passwordResetEmail(account, token, settings.appBaseUrl));
        } catch (err) {
          // The response is already sent; the token is never logged.
          log.warn({ err }, "password reset email failed");
        }
      };
    },

    /** Uses a reset link: sets the new password and signs out every session (R2.17). */
    async resetPassword(input: ResetPasswordRequestType, requestId: string): Promise<void> {
      const { token, password } = validate(resetPasswordRequestSchema, input);
      const passwordHash = await hashPassword(password);
      await withTx(db, async (tx) => {
        const [link] = await repo.consumePasswordToken(tx, hashToken(token), "reset");
        const [account] = link ? await repo.findAccountById(tx, link.userId) : [];
        // A user deactivated after requesting the link cannot use it; the rollback leaves the link unused.
        if (!account?.isActive) {
          throw new AppError("VERIFICATION_INVALID");
        }
        await repo.setPassword(tx, account.id, passwordHash);
        await repo.revokeUserRefreshTokens(tx, account.id);
        await writeAuditEntry(tx, {
          tenantId: account.tenantId,
          actor: { type: account.role, id: account.id },
          action: "user.password_reset",
          resourceType: "user",
          resourceId: account.id,
          requestId,
        });
      });
    },

    async me(user: AuthUserType): Promise<MeResponseType> {
      const [account] = await repo.findAccountById(db, user.id);
      if (!account) {
        throw new AppError("UNAUTHENTICATED");
      }
      const [status] = account.tenantId
        ? await repo.findSubscriptionStatus(db, account.tenantId)
        : [];
      return {
        user: toAuthUser(account),
        subscription: status ? toSubscriptionStatus(status, status.today) : null,
      };
    },
  };
}

/**
 * Inserts an operator account. Used only by the `operator:create` CLI; no HTTP endpoint creates operators (T13).
 * A taken email surfaces as the database's unique violation, translated centrally to EMAIL_TAKEN.
 */
export async function createOperator(
  db: Db,
  input: CreateOperatorRequestType,
): Promise<UserSummaryType> {
  const { email, userName, password } = validate(createOperatorRequestSchema, input);
  const [operator] = await createAuthRepository().insertUser(db, {
    email,
    userName,
    passwordHash: await hashPassword(password),
    role: "operator",
    // The deployer typed the address on the server; there is no link to confirm.
    emailVerifiedAt: new Date(),
  });
  if (!operator) {
    throw new Error("insert returned no row");
  }
  return operator;
}
