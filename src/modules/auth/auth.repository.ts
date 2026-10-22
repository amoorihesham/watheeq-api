import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Executor } from "@/db/pool.js";
import {
  passwordTokens,
  refreshTokens,
  rolePermissions,
  roles,
  subscriptions,
  tenantMembers,
  users,
} from "@/db/schema/index.js";
import { riyadhToday } from "@/modules/subscriptions/index.js";
import type {
  AccountType,
  NewPasswordTokenType,
  NewRefreshTokenType,
  NewUserType,
  PasswordTokenPurposeType,
  UserSummaryType,
} from "./auth.types.js";

const accountColumns = {
  id: users.id,
  email: users.email,
  userName: users.userName,
  passwordHash: users.passwordHash,
  role: users.role,
  isActive: users.isActive,
  emailVerifiedAt: users.emailVerifiedAt,
  tenantId: tenantMembers.tenantId,
  roleId: roles.id,
  roleName: roles.name,
  roleIsSystem: roles.isSystem,
  rolePermissions: sql<string[]>`array(
    select ${rolePermissions.permission} from ${rolePermissions} where ${rolePermissions.roleId} = ${roles.id}
  )`,
};

const roleOfMember = and(
  eq(roles.tenantId, tenantMembers.tenantId),
  eq(roles.id, tenantMembers.roleId),
);

export function createAuthRepository() {
  return {
    insertUser(db: Executor, values: NewUserType): Promise<UserSummaryType[]> {
      return db
        .insert(users)
        .values(values)
        .returning({ id: users.id, email: users.email, userName: users.userName });
    },

    findAccountByEmail(db: Executor, email: string): Promise<AccountType[]> {
      return db
        .select(accountColumns)
        .from(users)
        .leftJoin(tenantMembers, eq(tenantMembers.userId, users.id))
        .leftJoin(roles, roleOfMember)
        .where(eq(users.email, email));
    },

    findAccountById(db: Executor, userId: string): Promise<AccountType[]> {
      return db
        .select(accountColumns)
        .from(users)
        .leftJoin(tenantMembers, eq(tenantMembers.userId, users.id))
        .leftJoin(roles, roleOfMember)
        .where(eq(users.id, userId));
    },

    insertRefreshToken(db: Executor, values: NewRefreshTokenType) {
      return db.insert(refreshTokens).values(values);
    },

    /**
     * Revokes a valid token and returns its user in one statement. Of two concurrent refreshes with the same token,
     * only one matches `revoked_at IS NULL`, so only one gets a row back.
     */
    consumeRefreshToken(db: Executor, tokenHash: string): Promise<{ userId: string }[]> {
      return db
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(refreshTokens.tokenHash, tokenHash),
            isNull(refreshTokens.revokedAt),
            gt(refreshTokens.expiresAt, sql`now()`),
          ),
        )
        .returning({ userId: refreshTokens.userId });
    },

    revokeRefreshToken(db: Executor, tokenHash: string) {
      return db
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
    },

    findSubscriptionStatus(
      db: Executor,
      tenantId: string,
    ): Promise<{ endDate: string; graceDays: number; today: string }[]> {
      return db
        .select({
          endDate: subscriptions.endDate,
          graceDays: subscriptions.graceDays,
          today: riyadhToday,
        })
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, tenantId));
    },

    insertPasswordToken(db: Executor, values: NewPasswordTokenType) {
      return db.insert(passwordTokens).values(values);
    },

    /** Marks the user's unused links as used (of one purpose, or all), so none of them works any more. */
    retirePasswordTokens(db: Executor, userId: string, purpose?: PasswordTokenPurposeType) {
      return db
        .update(passwordTokens)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(passwordTokens.userId, userId),
            isNull(passwordTokens.usedAt),
            purpose ? eq(passwordTokens.purpose, purpose) : undefined,
          ),
        );
    },

    /**
     * Uses a valid link of the given purpose and returns its user in one statement. Of two concurrent submissions
     * of the same link, only one matches `used_at IS NULL`, so only one gets a row back.
     */
    consumePasswordToken(
      db: Executor,
      tokenHash: string,
      purpose: PasswordTokenPurposeType,
    ): Promise<{ userId: string }[]> {
      return db
        .update(passwordTokens)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(passwordTokens.tokenHash, tokenHash),
            eq(passwordTokens.purpose, purpose),
            isNull(passwordTokens.usedAt),
            gt(passwordTokens.expiresAt, sql`now()`),
          ),
        )
        .returning({ userId: passwordTokens.userId });
    },

    setPassword(db: Executor, userId: string, passwordHash: string) {
      return db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    /** Revokes every live refresh token of the user except one, signing out their other sessions. */
    revokeOtherRefreshTokens(db: Executor, userId: string, keepTokenHash: string) {
      return db
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(refreshTokens.userId, userId),
            isNull(refreshTokens.revokedAt),
            ne(refreshTokens.tokenHash, keepTokenHash),
          ),
        );
    },

    /** Revokes every live refresh token of the user, signing out all their sessions. */
    revokeUserRefreshTokens(db: Executor, userId: string) {
      return db
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    },

    setVerifiedPassword(db: Executor, userId: string, passwordHash: string) {
      return db
        .update(users)
        .set({ passwordHash, emailVerifiedAt: sql`now()` })
        .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
        .returning({ id: users.id });
    },
  };
}
