import type { Tx } from "@/db/pool.js";
import type { EmailMessageType } from "@/email/index.js";
import { createAuthRepository } from "../auth.repository.js";
import type { PasswordTokenPurposeType, PendingUserType, UserSummaryType } from "../auth.types.js";
import { generateOpaqueToken, hashToken } from "./tokens.js";

// Used by the tenants and users modules to onboard users; auth keeps ownership of credentials and links (P1.15).
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

/** Retires the user's older links of this purpose and issues a new one. Returns the raw token, which only the email carries. */
export async function issuePasswordToken(
  tx: Tx,
  userId: string,
  purpose: PasswordTokenPurposeType,
  ttlSeconds: number,
): Promise<string> {
  await repo.retirePasswordTokens(tx, userId, purpose);
  const token = generateOpaqueToken();
  await repo.insertPasswordToken(tx, {
    userId,
    purpose,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });
  return token;
}

/** For a deactivated user: no emailed link works any more, and every session is signed out at its next refresh. */
export async function endUserAccess(tx: Tx, userId: string): Promise<void> {
  await repo.retirePasswordTokens(tx, userId);
  await repo.revokeUserRefreshTokens(tx, userId);
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

/** The email with a password reset link (Phase 2 spec, 4.3). */
export function passwordResetEmail(
  user: { email: string; userName: string },
  token: string,
  appBaseUrl: string,
): EmailMessageType {
  const link = new URL("/reset-password", appBaseUrl);
  link.searchParams.set("token", token);
  return {
    to: user.email,
    subject: "إعادة تعيين كلمة المرور في وثيق | Reset your Watheeq password",
    text: [
      `مرحبا ${user.userName}،`,
      "لاختيار كلمة مرور جديدة لحسابك في وثيق، افتح الرابط التالي. يعمل الرابط مرة واحدة وينتهي قريبا.",
      link.toString(),
      "",
      `Hello ${user.userName},`,
      "To choose a new password for your Watheeq account, open this link. It works once and expires soon.",
      link.toString(),
      "",
      "If you did not ask for this, you can ignore this email; your password stays the same.",
    ].join("\n"),
  };
}

/** The email an invited user receives; the link is the same `/verify-email` page as the first Tenant Admin's (P2.5). */
export function invitationEmail(
  user: { email: string; userName: string },
  invitedBy: { userName: string; tenantName: string },
  token: string,
  appBaseUrl: string,
): EmailMessageType {
  const link = new URL("/verify-email", appBaseUrl);
  link.searchParams.set("token", token);
  return {
    to: user.email,
    subject: `دعوة للانضمام إلى ${invitedBy.tenantName} في وثيق | Join ${invitedBy.tenantName} on Watheeq`,
    text: [
      `مرحبا ${user.userName}،`,
      `دعاك ${invitedBy.userName} للانضمام إلى ${invitedBy.tenantName} في وثيق. لتفعيل حسابك واختيار كلمة المرور، افتح الرابط التالي:`,
      link.toString(),
      "",
      `Hello ${user.userName},`,
      `${invitedBy.userName} invited you to join ${invitedBy.tenantName} on Watheeq. To activate your account and choose your password, open this link:`,
      link.toString(),
      "",
      "If you did not expect this email, you can ignore it.",
    ].join("\n"),
  };
}
