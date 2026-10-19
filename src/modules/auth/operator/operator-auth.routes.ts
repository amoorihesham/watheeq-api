import express from "express";
import { z } from "zod";
import type { Db } from "../../../db/pool.js";
import { AppError } from "../../../http/errors.js";
import { validate } from "../../../http/validate.js";
import { noStore } from "../../../middleware/no-store.js";
import type { OperatorSessionLifetimes } from "../../../middleware/require-operator.js";
import { clientIp } from "../shared/client-ip.js";
import {
  clearSessionCookie,
  OPERATOR_COOKIE,
  readCookie,
  setSessionCookie,
} from "../shared/cookies.js";
import { csrfTokenFor } from "../shared/csrf.js";
import type { LoginThrottleSettings } from "../shared/ip-throttle.js";
import { checkCredentials } from "../shared/login.js";
import { generateToken, hashToken, isWellFormedToken } from "../shared/tokens.js";
import {
  findOperatorByEmail,
  recordWrongPassword,
  replaceSession,
  revokeSession,
} from "./operator-store.js";

// Passwords are checked against a 256-character cap before any hashing work (spec section 5).
const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(256),
});

const USER_AGENT_MAX_LENGTH = 512;

export function operatorAuthRouter(
  db: Db,
  lifetimes: OperatorSessionLifetimes,
  throttle: LoginThrottleSettings,
  authenticate: express.RequestHandler,
): express.Router {
  const router = express.Router();

  router.use("/operator/auth", noStore);

  router.post("/operator/auth/login", async (req, res) => {
    const { email, password } = validate(loginBody, req.body);

    const ip = clientIp(req);
    const operator = await checkCredentials(db, throttle, {
      realm: "operator",
      ip,
      password,
      find: () => findOperatorByEmail(db, email),
      recordWrongPassword: (account) => recordWrongPassword(db, account.id, throttle),
      log: req.log,
    });

    // A new token on every login: a token planted before login (fixation) never becomes a logged-in session.
    const presented = readCookie(req, OPERATOR_COOKIE);
    const presentedHash =
      presented !== undefined && isWellFormedToken(presented) ? hashToken(presented) : undefined;
    const sessionToken = generateToken();
    await replaceSession(db, presentedHash, {
      operatorId: operator.id,
      tokenHash: hashToken(sessionToken),
      absoluteLifetimeSeconds: lifetimes.absoluteLifetimeSeconds,
      userAgent: req.get("user-agent")?.slice(0, USER_AGENT_MAX_LENGTH),
      ip,
    });

    setSessionCookie(res, OPERATOR_COOKIE, sessionToken);
    req.log.info({ operatorId: operator.id }, "operator logged in");
    res.json({
      operator: { id: operator.id, email: operator.email },
      csrfToken: csrfTokenFor(sessionToken),
    });
  });

  router.post("/operator/auth/logout", authenticate, async (req, res) => {
    const auth = requireAuth(req);
    await revokeSession(db, auth.sessionId);
    clearSessionCookie(res, OPERATOR_COOKIE);
    req.log.info({ operatorId: auth.operator.id }, "operator logged out");
    res.status(204).end();
  });

  // The browser app keeps the CSRF token in memory and recovers it here after a reload.
  // It is derived from the session cookie, so it is the same token login returned.
  router.get("/operator/auth/session", authenticate, (req, res) => {
    const auth = requireAuth(req);
    const sessionToken = readCookie(req, OPERATOR_COOKIE);
    if (sessionToken === undefined) {
      throw new AppError("UNAUTHENTICATED");
    }
    res.json({ operator: auth.operator, csrfToken: csrfTokenFor(sessionToken) });
  });

  return router;
}

function requireAuth(req: express.Request): NonNullable<express.Request["operatorAuth"]> {
  if (!req.operatorAuth) {
    throw new AppError("UNAUTHENTICATED");
  }
  return req.operatorAuth;
}
