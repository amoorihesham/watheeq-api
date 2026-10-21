import type { Tx } from "@/db/pool.js";
import type { EmailMessageType } from "@/email/index.js";
import { createAuthRepository } from "../auth.repository.js";
import type { PendingUserType, UserSummaryType } from "../auth.types.js";
import { generateOpaqueToken, hashToken } from "./tokens.js";

// Used by the tenants module to onboard a first Tenant Admin; auth keeps ownership of users and links (P1.15).
const repo = createAuthRepository();

/** Inserts a tenant user who has no password until they verify their email. */
export async function insertPendingUser(tx: Tx, user: PendingUserType): Promise<UserSummaryType> {
  const [row] = await repo.insertUser(tx, {
    ...user,
    passwordHash: null,
    role: "user",
    emailVerifiedAt: null,
  });
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
}

/** Retires the user's older links and issues a new one. Returns the raw token, which only the email carries. */
export async function issueEmailVerification(
  tx: Tx,
  userId: string,
  ttlSeconds: number,
): Promise<string> {
  await repo.retireEmailVerifications(tx, userId);
  const token = generateOpaqueToken();
  await repo.insertEmailVerification(tx, {
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });
  return token;
}

export function verificationEmail(
  user: { email: string; userName: string },
  token: string,
  appBaseUrl: string,
): EmailMessageType {
  const link = new URL("/verify-email", appBaseUrl);
  link.searchParams.set("token", token);
  return {
    to: user.email,
    subject: "تأكيد بريدك في وثيق | Verify your Watheeq email",
    text: [
      `مرحبا ${user.userName}،`,
      "لتفعيل حسابك في وثيق واختيار كلمة المرور، افتح الرابط التالي:",
      link.toString(),
      "",
      `Hello ${user.userName},`,
      "To activate your Watheeq account and choose your password, open this link:",
      link.toString(),
      "",
      "If you did not expect this email, you can ignore it.",
    ].join("\n"),
  };
}
