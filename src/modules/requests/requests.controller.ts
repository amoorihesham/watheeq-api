import type { Request, RequestHandler } from "express";
import { auditContextOf, principalOf } from "@/modules/auth/index.js";
import { sendDownload } from "@/modules/files/index.js";
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
const fileIdOf = (req: Request) => String(req.params.fileId);
const informationIdOf = (req: Request) => String(req.params.infoId);

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

    stageAction: (
      action: "completeStage" | "returnStage" | "narrowStage" | "escalateStage" | "refreshStage",
    ) =>
      (async (req, res) => {
        const request = await service[action](
          tenantOf(req),
          callerOf(req),
          requestIdOf(req),
          String(req.params.runId),
          req.body,
          auditContextOf(req),
        );
        res.status(200).json({ request } satisfies RequestResponseType);
      }) satisfies RequestHandler,

    changeHandler: (async (req, res) => {
      const request = await service.changeHandler(
        tenantOf(req),
        callerOf(req),
        requestIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ request } satisfies RequestResponseType);
    }) satisfies RequestHandler,

    attachFiles: (async (req, res) => {
      const request = await service.attachFiles(
        tenantOf(req),
        callerOf(req),
        requestIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ request } satisfies RequestResponseType);
    }) satisfies RequestHandler,

    removeFile: (async (req, res) => {
      const request = await service.removeFile(
        tenantOf(req),
        callerOf(req),
        requestIdOf(req),
        fileIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ request } satisfies RequestResponseType);
    }) satisfies RequestHandler,

    fileContent: (async (req, res) => {
      const { file, body } = await service.openFile(
        tenantOf(req),
        callerOf(req),
        requestIdOf(req),
        fileIdOf(req),
      );
      await sendDownload(res, file, body);
    }) satisfies RequestHandler,

    askInformation: (async (req, res) => {
      const request = await service.askInformation(
        tenantOf(req),
        callerOf(req),
        requestIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(201).json({ request } satisfies RequestResponseType);
    }) satisfies RequestHandler,

    answerInformation: (async (req, res) => {
      const request = await service.answerInformation(
        tenantOf(req),
        callerOf(req),
        requestIdOf(req),
        informationIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ request } satisfies RequestResponseType);
    }) satisfies RequestHandler,

    cancelInformation: (async (req, res) => {
      const request = await service.cancelInformation(
        tenantOf(req),
        callerOf(req),
        requestIdOf(req),
        informationIdOf(req),
        auditContextOf(req),
      );
      res.status(200).json({ request } satisfies RequestResponseType);
    }) satisfies RequestHandler,

    closeNoResponse: (async (req, res) => {
      const request = await service.closeNoResponse(
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
