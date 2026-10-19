import type { Db } from "../../../db/pool.js";
import { withTenantTx } from "../../../db/tenant-tx.js";
import type { Logger } from "../../../logging/logger.js";
import { csrfTokenFor } from "../shared/csrf.js";
import type { LoginThrottleSettings } from "../shared/ip-throttle.js";
import { checkCredentials } from "../shared/login.js";
import type { LoginRequest } from "../shared/login-request.js";
import { LAST_SEEN_RESOLUTION_MS } from "../shared/session.js";
import { generateToken, hashToken } from "../shared/tokens.js";
import type { TenantRepository } from "./tenant.repository.js";

export type { UserIdentity } from "./tenant.repository.js";

export interface TenantSessionLifetimes {
  idleTimeoutSeconds: number;
  absoluteLifetimeSeconds: number;
}

export interface TenantAuthServiceDeps {
  db: Db;
  repo: TenantRepository;
  lifetimes: TenantSessionLifetimes;
  throttle: LoginThrottleSettings;
}

export function createTenantAuthService({ db, repo, lifetimes, throttle }: TenantAuthServiceDeps) {
  return {
    /** Checks the credentials and, on success, swaps the presented session for a new one. Throws `AppError` otherwise. */
    async login(input: LoginRequest, log: Logger) {
      const user = await checkCredentials(db, throttle, {
        realm: "tenant",
        ip: input.ip,
        password: input.password,
        find: () => repo.findUserForLogin(db, input.email),
        // One atomic UPDATE in the user's tenant.
        recordWrongPassword: (account) =>
          withTenantTx(db, account.tenantId, (tx) =>
            repo.recordWrongPassword(tx, account.id, throttle),
          ),
        log,
      });

      // A new token on every login: a token planted before login (fixation) never becomes a logged-in session.
      const sessionToken = generateToken();
      // One transaction in the user's tenant: resets the failure count, revokes the presented session (if any),
      // and inserts the new one.
      await withTenantTx(db, user.tenantId, async (tx) => {
        await repo.resetLoginFailures(tx, user.id);
        if (input.presentedTokenHash) {
          await repo.revokeSessionByTokenHash(tx, input.presentedTokenHash);
        }
        await repo.insertSession(tx, {
          tenantId: user.tenantId,
          userId: user.id,
          tokenHash: hashToken(sessionToken),
          absoluteLifetimeSeconds: lifetimes.absoluteLifetimeSeconds,
          userAgent: input.userAgent,
          ip: input.ip,
        });
      });

      return {
        user: { id: user.id, email: input.email, tenantId: user.tenantId },
        sessionToken,
        csrfToken: csrfTokenFor(sessionToken),
      };
    },

    logout(tenantId: string, sessionId: string): Promise<void> {
      return withTenantTx(db, tenantId, (tx) => repo.revokeSession(tx, sessionId));
    },

    /** Used by the session middleware: the session behind a token hash, only if it is valid now. */
    resolveSession(tokenHash: Buffer) {
      return repo.resolveSession(db, tokenHash, lifetimes.idleTimeoutSeconds);
    },

    touchSession(tenantId: string, sessionId: string): Promise<void> {
      return withTenantTx(db, tenantId, (tx) =>
        repo.touchSession(tx, sessionId, LAST_SEEN_RESOLUTION_MS / 1000),
      );
    },
  };
}

export type TenantAuthService = ReturnType<typeof createTenantAuthService>;
