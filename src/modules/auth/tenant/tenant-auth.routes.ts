import express from "express";
import { noStore } from "../../../middleware/no-store.js";
import type { TenantAuthController } from "./tenant-auth.controller.js";

export function tenantAuthRouter(
  controller: TenantAuthController,
  authenticate: express.RequestHandler,
): express.Router {
  const router = express.Router();

  router.use("/auth", noStore);
  router.post("/auth/login", controller.login);
  router.post("/auth/logout", authenticate, controller.logout);
  router.get("/auth/session", authenticate, controller.session);

  return router;
}
