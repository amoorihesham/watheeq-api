import type { Request, RequestHandler } from "express";
import { sendData, sendPage } from "@/http/respond.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import { positionResponseSchema } from "./positions.responses.js";
import type { PositionsServiceType } from "./positions.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const positionIdOf = (req: Request) => String(req.params.positionId);

export function createPositionsController({ service }: { service: PositionsServiceType }) {
  return {
    list: (async (req, res) => {
      sendPage(res, positionResponseSchema, await service.list(tenantOf(req), req.query));
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const position = await service.get(tenantOf(req), positionIdOf(req));
      sendData(res, 200, positionResponseSchema, position);
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const position = await service.create(tenantOf(req), req.body, auditContextOf(req));
      sendData(res, 201, positionResponseSchema, position);
    }) satisfies RequestHandler,

    rename: (async (req, res) => {
      const position = await service.rename(
        tenantOf(req),
        positionIdOf(req),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, positionResponseSchema, position);
    }) satisfies RequestHandler,

    setHolders: (async (req, res) => {
      const position = await service.setHolders(
        tenantOf(req),
        positionIdOf(req),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, positionResponseSchema, position);
    }) satisfies RequestHandler,

    retire: (async (req, res) => {
      const position = await service.retire(tenantOf(req), positionIdOf(req), auditContextOf(req));
      sendData(res, 200, positionResponseSchema, position);
    }) satisfies RequestHandler,

    restore: (async (req, res) => {
      const position = await service.restore(tenantOf(req), positionIdOf(req), auditContextOf(req));
      sendData(res, 200, positionResponseSchema, position);
    }) satisfies RequestHandler,
  };
}
