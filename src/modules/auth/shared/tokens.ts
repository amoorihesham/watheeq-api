import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { JWT_ALGORITHM, JWT_ISSUER, REFRESH_TOKEN_BYTES } from "../auth.config.js";
import { accessTokenPayloadSchema } from "../auth.schemas.js";
import type { AccessTokenPayloadType, AuthUserType } from "../auth.types.js";

const keyOf = (secret: string) => new TextEncoder().encode(secret);

/** Payload: `{ sub, iss, iat, exp, username, email, role, tenant }` (Phase 0 spec, 4.3). */
export function signAccessToken(
  user: AuthUserType,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const claims: Omit<AccessTokenPayloadType, "sub"> = {
    username: user.userName,
    email: user.email,
    role: user.role,
    tenant: user.tenant,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject(user.id)
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(keyOf(secret));
}

/** The user in a valid token, or null for a missing, tampered, expired, foreign, or malformed one. Never throws. */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AuthUserType | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
    });
    const claims = accessTokenPayloadSchema.safeParse(payload);
    if (!claims.success) {
      return null;
    }
    const { sub, username, email, role, tenant } = claims.data;
    return { id: sub, userName: username, email, role, tenant };
  } catch {
    return null;
  }
}

/** A random 256-bit token for refresh tokens and verification links; only its hash is stored. */
export function generateOpaqueToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
}

/** Only this hash is stored, so a database leak yields no usable refresh tokens or links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
