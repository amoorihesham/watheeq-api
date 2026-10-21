import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { createAuthController } from "./auth.controller.js";
import { createAuthRepository } from "./auth.repository.js";
import { createAuthService } from "./auth.service.js";
import type { AuthRouterDepsType, AuthSettingsType } from "./auth.types.js";
import { authenticate } from "./shared/middlewares.js";

/** The auth module's composition root: builds repository, service, and controller, and returns the `/auth` router. */
export function createAuthRouter({ db, config }: AuthRouterDepsType): Router {
  const settings: AuthSettingsType = {
    jwtSecret: config.JWT_SECRET,
    accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
  };
  const service = createAuthService({ db, repo: createAuthRepository(), settings });
  const controller = createAuthController({ service, settings });

  const router = Router();
  router.use(noStore);
  router.post("/login", controller.login);
  router.post("/refresh", controller.refresh);
  router.post("/logout", controller.logout);
  router.get("/me", authenticate(settings.jwtSecret), controller.me);
  return router;
}
