import express from "express";
import { noStore } from "../../../middleware/no-store.js";
import type { OperatorAuthController } from "./operator-auth.controller.js";

export function operatorAuthRouter(
  controller: OperatorAuthController,
  authenticate: express.RequestHandler,
): express.Router {
  const router = express.Router();

  router.use("/operator/auth", noStore);
  router.post("/operator/auth/login", controller.login);
  router.post("/operator/auth/logout", authenticate, controller.logout);
  router.get("/operator/auth/session", authenticate, controller.session);

  return router;
}
