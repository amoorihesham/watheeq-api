import type { Request, RequestHandler } from "express";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type {
  ListPositionsResponseType,
  PositionResponseType,
  PositionsServiceType,
} from "./positions.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const positionIdOf = (req: Request) => String(req.params.positionId);

export function createPositionsController({ service }: { service: PositionsServiceType }) {
  return {
    list: (async (req, res) => {
      const positions = await service.list(tenantOf(req), req.query);
      res.status(200).json(positions satisfies ListPositionsResponseType);
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const position = await service.get(tenantOf(req), positionIdOf(req));
      res.status(200).json({ position } satisfies PositionResponseType);
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const position = await service.create(tenantOf(req), req.body, auditContextOf(req));
      res.status(201).json({ position } satisfies PositionResponseType);
    }) satisfies RequestHandler,

    rename: (async (req, res) => {
      const position = await service.rename(
        tenantOf(req),
        positionIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ position } satisfies PositionResponseType);
    }) satisfies RequestHandler,

    setHolders: (async (req, res) => {
      const position = await service.setHolders(
        tenantOf(req),
        positionIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ position } satisfies PositionResponseType);
    }) satisfies RequestHandler,

    retire: (async (req, res) => {
      const position = await service.retire(tenantOf(req), positionIdOf(req), auditContextOf(req));
      res.status(200).json({ position } satisfies PositionResponseType);
    }) satisfies RequestHandler,

    restore: (async (req, res) => {
      const position = await service.restore(tenantOf(req), positionIdOf(req), auditContextOf(req));
      res.status(200).json({ position } satisfies PositionResponseType);
    }) satisfies RequestHandler,
  };
}
