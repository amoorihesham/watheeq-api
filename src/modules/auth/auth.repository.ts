import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Executor } from "@/db/pool.js";
import { refreshTokens, tenantMembers, users } from "@/db/schema/index.js";
import type {
  AccountType,
  NewRefreshTokenType,
  NewUserType,
  UserSummaryType,
} from "./auth.types.js";

const accountColumns = {
  id: users.id,
  email: users.email,
  userName: users.userName,
  passwordHash: users.passwordHash,
  role: users.role,
  isActive: users.isActive,
  tenantId: tenantMembers.tenantId,
  tenantRole: tenantMembers.role,
};

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
        .where(eq(users.email, email));
    },

    findAccountById(db: Executor, userId: string): Promise<AccountType[]> {
      return db
        .select(accountColumns)
        .from(users)
        .leftJoin(tenantMembers, eq(tenantMembers.userId, users.id))
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
  };
}
