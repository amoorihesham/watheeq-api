import type { Request, RequestHandler } from "express";
import { auditContextOf, principalOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type {
  CatalogType,
  ListRequestsResponseType,
  RequestResponseType,
  RequestsServiceType,
} from "./requests.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const callerOf = (req: Request) => principalOf(req).id;
const requestIdOf = (req: Request) => String(req.params.requestId);

export function createRequestsController({ service }: { service: RequestsServiceType }) {
  return {
    catalog: (async (req, res) => {
      res.status(200).json((await service.catalog(tenantOf(req))) satisfies CatalogType);
    }) satisfies RequestHandler,

    submit: (async (req, res) => {
      const request = await service.submit(
        tenantOf(req),
        callerOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(201).json({ request } satisfies RequestResponseType);
    }) satisfies RequestHandler,

    list: (async (req, res) => {
      const page = await service.list(tenantOf(req), callerOf(req), req.query);
      res.status(200).json(page satisfies ListRequestsResponseType);
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const request = await service.get(tenantOf(req), callerOf(req), requestIdOf(req));
      res.status(200).json({ request } satisfies RequestResponseType);
    }) satisfies RequestHandler,

    changePriority: (async (req, res) => {
      const request = await service.changePriority(
        tenantOf(req),
        callerOf(req),
        requestIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ request } satisfies RequestResponseType);
    }) satisfies RequestHandler,

    accept: (async (req, res) => {
      const request = await service.accept(
        tenantOf(req),
        callerOf(req),
        requestIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ request } satisfies RequestResponseType);
    }) satisfies RequestHandler,

    reject: (async (req, res) => {
      const request = await service.reject(
        tenantOf(req),
        callerOf(req),
        requestIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ request } satisfies RequestResponseType);
    }) satisfies RequestHandler,

    withdraw: (async (req, res) => {
      const request = await service.withdraw(
        tenantOf(req),
        callerOf(req),
        requestIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ request } satisfies RequestResponseType);
    }) satisfies RequestHandler,
  };
}
