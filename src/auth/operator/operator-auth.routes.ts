import express from "express";
import { z } from "zod";
import type { Db } from "../../db/pool.js";
import { AppError } from "../../http/errors.js";
import { validate } from "../../http/validate.js";
import { clearSessionCookie, readCookie, setSessionCookie } from "../shared/cookies.js";
import { csrfTokenFor } from "../shared/csrf.js";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "../shared/passwords.js";
import { LAST_SEEN_RESOLUTION_MS, sessionAuth } from "../shared/session-middleware.js";
import { generateToken, hashToken, isWellFormedToken } from "../shared/tokens.js";
import {
  findOperatorByEmail,
  type OperatorIdentity,
  replaceSession,
  resolveOperatorSession,
  revokeSession,
  touchSession,
} from "./operator-store.js";

export const OPERATOR_COOKIE = "__Host-wq_operator";

export interface OperatorSessionLifetimes {
  idleTimeoutSeconds: number;
  absoluteLifetimeSeconds: number;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireOperator`. */
      operatorAuth?: { sessionId: string; operator: OperatorIdentity };
    }
  }
}

// Passwords are checked against a 256-character cap before any hashing work (spec section 5).
const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(256),
});

const USER_AGENT_MAX_LENGTH = 512;

export function requireOperator(
  db: Db,
  lifetimes: OperatorSessionLifetimes,
): express.RequestHandler {
  return sessionAuth<OperatorIdentity>({
    cookieName: OPERATOR_COOKIE,
    resolve: (tokenHash) => resolveOperatorSession(db, tokenHash, lifetimes.idleTimeoutSeconds),
    touch: (sessionId) => touchSession(db, sessionId, LAST_SEEN_RESOLUTION_MS / 1000),
    attach: (req, { sessionId, principal }) => {
      req.operatorAuth = { sessionId, operator: principal };
    },
  });
}

export function operatorAuthRouter(db: Db, lifetimes: OperatorSessionLifetimes): express.Router {
  const router = express.Router();
  const authenticate = requireOperator(db, lifetimes);

  // Responses carry tokens and identity, so no browser or proxy cache may keep them.
  router.use("/operator/auth", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.post("/operator/auth/login", async (req, res) => {
    const { email, password } = validate(loginBody, req.body);

    const operator = await findOperatorByEmail(db, email);
    // Unknown email: verify against a dummy hash so the response time matches a wrong password.
    const passwordOk = await verifyPassword(
      operator?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );
    if (!operator || !passwordOk || !operator.isActive) {
      const reason = !operator ? "unknown_email" : !passwordOk ? "wrong_password" : "inactive";
      req.log.warn({ reason, operatorId: operator?.id }, "operator login failed");
      throw new AppError("INVALID_CREDENTIALS");
    }

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
      ip: req.ip,
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
