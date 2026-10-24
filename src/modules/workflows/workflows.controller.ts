import type { Request, RequestHandler } from "express";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type {
  ListWorkflowsResponseType,
  VersionResponseType,
  WorkflowResponseType,
  WorkflowsServiceType,
} from "./workflows.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const workflowIdOf = (req: Request) => String(req.params.workflowId);

export function createWorkflowsController({ service }: { service: WorkflowsServiceType }) {
  return {
    list: (async (req, res) => {
      const workflows = await service.list(tenantOf(req), req.query);
      res.status(200).json(workflows satisfies ListWorkflowsResponseType);
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const workflow = await service.get(tenantOf(req), workflowIdOf(req));
      res.status(200).json({ workflow } satisfies WorkflowResponseType);
    }) satisfies RequestHandler,

    getVersion: (async (req, res) => {
      const version = await service.getVersion(
        tenantOf(req),
        workflowIdOf(req),
        String(req.params.number),
      );
      res.status(200).json({ version } satisfies VersionResponseType);
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const workflow = await service.create(tenantOf(req), req.body, auditContextOf(req));
      res.status(201).json({ workflow } satisfies WorkflowResponseType);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const workflow = await service.update(
        tenantOf(req),
        workflowIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ workflow } satisfies WorkflowResponseType);
    }) satisfies RequestHandler,

    retire: (async (req, res) => {
      const workflow = await service.retire(tenantOf(req), workflowIdOf(req), auditContextOf(req));
      res.status(200).json({ workflow } satisfies WorkflowResponseType);
    }) satisfies RequestHandler,

    restore: (async (req, res) => {
      const workflow = await service.restore(tenantOf(req), workflowIdOf(req), auditContextOf(req));
      res.status(200).json({ workflow } satisfies WorkflowResponseType);
    }) satisfies RequestHandler,
  };
}
