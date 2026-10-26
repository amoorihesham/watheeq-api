export const ACCESS_COOKIE = "wq_access";
export const REFRESH_COOKIE = "wq_refresh";

const BASE_COOKIE_FLAGS = { httpOnly: true, secure: true, sameSite: "lax" } as const;
export const ACCESS_COOKIE_FLAGS = { ...BASE_COOKIE_FLAGS, path: "/" } as const;
// Scoped to /auth, so the refresh token is sent only to the auth routes, never with ordinary requests.
export const REFRESH_COOKIE_FLAGS = { ...BASE_COOKIE_FLAGS, path: "/auth" } as const;

export const JWT_ALGORITHM = "HS256";
// Checked on every verify, so a token signed by another system with the same key is rejected.
export const JWT_ISSUER = "watheeq_api";
export const REFRESH_TOKEN_BYTES = 32;

// OWASP minimum for argon2id: 19 MiB memory, 2 iterations, 1 lane.
export const PASSWORD_HASH_PARAMS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

// Verified when the email is unknown, so login takes the same time whether or not the account exists.
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$eWPul0GindNkMPrbnycrWg$u9p80R/pP6Mk+S374/3kbEH/hcBF7PJQ6E164MT2WGk";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_USER_NAME_LENGTH = 100;

export const TOKEN_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const TOKEN_CLEANUP_BATCH_SIZE = 1000;
