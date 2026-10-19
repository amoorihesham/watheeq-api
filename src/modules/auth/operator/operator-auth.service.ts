import { z } from "zod";
import type { Db } from "../../../db/pool.js";
import type { Logger } from "../../../logging/logger.js";
import { csrfTokenFor } from "../shared/csrf.js";
import type { LoginThrottleSettings } from "../shared/ip-throttle.js";
import { checkCredentials } from "../shared/login.js";
import type { LoginRequest } from "../shared/login-request.js";
import { hashPassword } from "../shared/passwords.js";
import { LAST_SEEN_RESOLUTION_MS } from "../shared/session.js";
import { generateToken, hashToken } from "../shared/tokens.js";
import { createOperatorRepository, type OperatorRepository } from "./operator.repository.js";

export type { OperatorIdentity } from "./operator.repository.js";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

export interface OperatorSessionLifetimes {
  idleTimeoutSeconds: number;
  absoluteLifetimeSeconds: number;
}

export interface OperatorAuthServiceDeps {
  db: Db;
  repo: OperatorRepository;
  lifetimes: OperatorSessionLifetimes;
  throttle: LoginThrottleSettings;
}

export function createOperatorAuthService({
  db,
  repo,
  lifetimes,
  throttle,
}: OperatorAuthServiceDeps) {
  return {
    /** Checks the credentials and, on success, swaps the presented session for a new one. Throws `AppError` otherwise. */
    async login(input: LoginRequest, log: Logger) {
      const operator = await checkCredentials(db, throttle, {
        realm: "operator",
        ip: input.ip,
        password: input.password,
        find: () => repo.findByEmail(db, input.email),
        recordWrongPassword: (account) => repo.recordWrongPassword(db, account.id, throttle),
        log,
      });

      // A new token on every login: a token planted before login (fixation) never becomes a logged-in session.
      const sessionToken = generateToken();
      // One transaction: resets the failure count, revokes the presented session (if any), inserts the new one.
      await db.transaction(async (tx) => {
        await repo.resetLoginFailures(tx, operator.id);
        if (input.presentedTokenHash) {
          await repo.revokeSessionByTokenHash(tx, input.presentedTokenHash);
        }
        await repo.insertSession(tx, {
          operatorId: operator.id,
          tokenHash: hashToken(sessionToken),
          absoluteLifetimeSeconds: lifetimes.absoluteLifetimeSeconds,
          userAgent: input.userAgent,
          ip: input.ip,
        });
      });

      return {
        operator: { id: operator.id, email: operator.email },
        sessionToken,
        csrfToken: csrfTokenFor(sessionToken),
      };
    },

    logout(sessionId: string): Promise<void> {
      return repo.revokeSession(db, sessionId);
    },

    /** Used by the session middleware: the session behind a token hash, only if it is valid now. */
    resolveSession(tokenHash: Buffer) {
      return repo.resolveSession(db, tokenHash, lifetimes.idleTimeoutSeconds);
    },

    touchSession(sessionId: string): Promise<void> {
      return repo.touchSession(db, sessionId, LAST_SEEN_RESOLUTION_MS / 1000);
    },
  };
}

export type OperatorAuthService = ReturnType<typeof createOperatorAuthService>;

const createOperatorInput = z.object({
  // The database check requires lower(btrim(email)); normalizing here keeps the CLI friendly about case.
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

export class CreateOperatorError extends Error {}

/**
 * Inserts an operator. `ownerDb` must connect as the owner role: watheeq_app has no INSERT on operators,
 * so a compromised application cannot create operators. That is why this is not part of the service the running app builds.
 */
export async function createOperator(
  ownerDb: Db,
  rawEmail: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const parsed = createOperatorInput.safeParse({ email: rawEmail, password });
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new CreateOperatorError(
      `Invalid ${fields.join(" and ")}. The password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`,
    );
  }
  const passwordHash = await hashPassword(parsed.data.password);

  const operator = await createOperatorRepository().insert(ownerDb, {
    email: parsed.data.email,
    passwordHash,
  });
  if (!operator) {
    throw new CreateOperatorError(`An operator with email ${parsed.data.email} already exists.`);
  }
  return operator;
}
