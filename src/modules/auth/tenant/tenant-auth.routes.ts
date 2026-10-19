import express from "express";
import { z } from "zod";
import type { Db } from "../../../db/pool.js";
import { AppError } from "../../../http/errors.js";
import { validate } from "../../../http/validate.js";
import { noStore } from "../../../middleware/no-store.js";
import type { TenantSessionLifetimes } from "../../../middleware/require-user.js";
import { clientIp } from "../shared/client-ip.js";
import {
  clearSessionCookie,
  readCookie,
  setSessionCookie,
  TENANT_COOKIE,
} from "../shared/cookies.js";
import { csrfTokenFor } from "../shared/csrf.js";
import type { LoginThrottleSettings } from "../shared/ip-throttle.js";
import { checkCredentials } from "../shared/login.js";
import { generateToken, hashToken, isWellFormedToken } from "../shared/tokens.js";
import {
  findUserForLogin,
  recordWrongPassword,
  replaceSession,
  revokeSession,
} from "./tenant-store.js";

// Passwords are checked against a 256-character cap before any hashing work (spec section 5).
const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(256),
});

const USER_AGENT_MAX_LENGTH = 512;

export function tenantAuthRouter(
  db: Db,
  lifetimes: TenantSessionLifetimes,
  throttle: LoginThrottleSettings,
  authenticate: express.RequestHandler,
): express.Router {
  const router = express.Router();

  router.use("/auth", noStore);

  router.post("/auth/login", async (req, res) => {
    const { email, password } = validate(loginBody, req.body);

    const ip = clientIp(req);
    const user = await checkCredentials(db, throttle, {
      realm: "tenant",
      ip,
      password,
      find: () => findUserForLogin(db, email),
      recordWrongPassword: (account) => recordWrongPassword(db, account, throttle),
      log: req.log,
    });

    // A new token on every login: a token planted before login (fixation) never becomes a logged-in session.
    const presented = readCookie(req, TENANT_COOKIE);
    const presentedHash =
      presented !== undefined && isWellFormedToken(presented) ? hashToken(presented) : undefined;
    const sessionToken = generateToken();
    await replaceSession(db, presentedHash, {
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      absoluteLifetimeSeconds: lifetimes.absoluteLifetimeSeconds,
      userAgent: req.get("user-agent")?.slice(0, USER_AGENT_MAX_LENGTH),
      ip,
    });

    setSessionCookie(res, TENANT_COOKIE, sessionToken);
    req.log.info({ userId: user.id, tenantId: user.tenantId }, "tenant user logged in");
    res.json({
      user: { id: user.id, email, tenantId: user.tenantId },
      csrfToken: csrfTokenFor(sessionToken),
    });
  });

  router.post("/auth/logout", authenticate, async (req, res) => {
    const auth = requireAuth(req);
    await revokeSession(db, auth.user.tenantId, auth.sessionId);
    clearSessionCookie(res, TENANT_COOKIE);
    req.log.info({ userId: auth.user.id, tenantId: auth.user.tenantId }, "tenant user logged out");
    res.status(204).end();
  });

  // The browser app keeps the CSRF token in memory and recovers it here after a reload.
  // It is derived from the session cookie, so it is the same token login returned.
  router.get("/auth/session", authenticate, (req, res) => {
    const auth = requireAuth(req);
    const sessionToken = readCookie(req, TENANT_COOKIE);
    if (sessionToken === undefined) {
      throw new AppError("UNAUTHENTICATED");
    }
    res.json({ user: auth.user, csrfToken: csrfTokenFor(sessionToken) });
  });

  return router;
}

function requireAuth(req: express.Request): NonNullable<express.Request["userAuth"]> {
  if (!req.userAuth) {
    throw new AppError("UNAUTHENTICATED");
  }
  return req.userAuth;
}
