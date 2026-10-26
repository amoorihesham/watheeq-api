import type { Request, RequestHandler } from "express";
import { sendData, sendPage } from "@/http/respond.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import {
  versionResponseSchema,
  workflowResponseSchema,
  workflowSummaryResponseSchema,
} from "./workflows.responses.js";
import type { WorkflowsServiceType } from "./workflows.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const workflowIdOf = (req: Request) => String(req.params.workflowId);

export function createWorkflowsController({ service }: { service: WorkflowsServiceType }) {
  return {
    list: (async (req, res) => {
      sendPage(res, workflowSummaryResponseSchema, await service.list(tenantOf(req), req.query));
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const workflow = await service.get(tenantOf(req), workflowIdOf(req));
      sendData(res, 200, workflowResponseSchema, workflow);
    }) satisfies RequestHandler,

    getVersion: (async (req, res) => {
      const version = await service.getVersion(
        tenantOf(req),
        workflowIdOf(req),
        String(req.params.number),
      );
      sendData(res, 200, versionResponseSchema, version);
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const workflow = await service.create(tenantOf(req), req.body, auditContextOf(req));
      sendData(res, 201, workflowResponseSchema, workflow);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const workflow = await service.update(
        tenantOf(req),
        workflowIdOf(req),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, workflowResponseSchema, workflow);
    }) satisfies RequestHandler,

    retire: (async (req, res) => {
      const workflow = await service.retire(tenantOf(req), workflowIdOf(req), auditContextOf(req));
      sendData(res, 200, workflowResponseSchema, workflow);
    }) satisfies RequestHandler,

    restore: (async (req, res) => {
      const workflow = await service.restore(tenantOf(req), workflowIdOf(req), auditContextOf(req));
      sendData(res, 200, workflowResponseSchema, workflow);
    }) satisfies RequestHandler,
  };
}
