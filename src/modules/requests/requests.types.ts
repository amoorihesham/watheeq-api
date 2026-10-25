import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { requestStates, requests } from "@/db/schema/index.js";
import type { AnswerSnapshotType } from "@/modules/services/shared/answers.js";
import type { FormFieldType } from "@/modules/services/shared/form.js";
import type { REQUEST_VIEWS } from "./requests.config.js";
import type { createRequestsController } from "./requests.controller.js";
import type { createRequestsRepository } from "./requests.repository.js";
import type {
  acceptRequestSchema,
  changePriorityRequestSchema,
  listRequestsQuerySchema,
  reasonRequestSchema,
  submitRequestSchema,
} from "./requests.schemas.js";
import type { createRequestsService } from "./requests.service.js";

export type RequestStateType = (typeof requestStates.enumValues)[number];
export type RequestViewType = (typeof REQUEST_VIEWS)[number];

/** A request row as an action locks it, without the names of the people. */
export type RequestRowType = typeof requests.$inferSelect;

/** A request row for a list: the people's names, no answers. */
export type RequestSummaryRowType = Omit<RequestRowType, "answers"> & {
  requesterName: string;
  handlerName: string | null;
};

/** The row a request page is built from. */
export type RequestDetailRowType = RequestSummaryRowType & { answers: AnswerSnapshotType[] };

/** What the SLA functions read: the acceptance, the priority's days, and the closure record once frozen. */
export type SlaSourceType = Pick<
  RequestRowType,
  | "state"
  | "acceptedAt"
  | "priorityDays"
  | "slaDeadline"
  | "elapsedDays"
  | "breachDays"
  | "awaitingInfoDays"
  | "slaMet"
>;

export interface ServiceRowType {
  id: string;
  name: string;
  description: string | null;
  retiredAt: Date | null;
  form: FormFieldType[];
  formRevision: number;
}

export interface PriorityRowType {
  id: string;
  name: string;
  days: number;
  retiredAt: Date | null;
}

/** A workflow as acceptance reads it under a share lock. */
export interface WorkflowRowType {
  id: string;
  retiredAt: Date | null;
  currentVersionId: string;
}

export interface MemberUnitRowType {
  unitId: string | null;
}

export type SubmitRequestType = z.input<typeof submitRequestSchema>;
export type ChangePriorityRequestType = z.input<typeof changePriorityRequestSchema>;
export type AcceptRequestType = z.input<typeof acceptRequestSchema>;
export type ReasonRequestType = z.input<typeof reasonRequestSchema>;
export type ListRequestsQueryType = z.output<typeof listRequestsQuerySchema>;

/** The SLA as the API returns it: live while in progress, the frozen record once closed (R6.22, R6.23). */
export interface SlaType {
  deadline: Date;
  elapsedDays: number;
  met: boolean;
  breachDays: number;
  awaitingInfoDays: number;
}

export interface RequestSummaryType {
  id: string;
  number: string;
  title: string;
  state: RequestStateType;
  service: { id: string; name: string };
  priority: { name: string; days: number };
  requester: { id: string; name: string };
  handler: { id: string; name: string } | null;
  submittedAt: Date;
  acceptedAt: Date | null;
  closedAt: Date | null;
  deadline: Date | null;
  /** Step 6.2 fills it. */
  activeStage: null;
}

export interface RequestType extends RequestSummaryType {
  answers: AnswerSnapshotType[];
  /** Steps 6.4, 6.3, and 6.2 replace these three with their own lists. */
  files: unknown[];
  stages: unknown[];
  informationRequests: unknown[];
  sla: SlaType | null;
  allowedActions: string[];
}

export interface CatalogType {
  services: {
    id: string;
    name: string;
    description: string | null;
    form: { revision: number; fields: FormFieldType[] };
  }[];
  priorities: { id: string; name: string; days: number }[];
}

export interface RequestResponseType {
  request: RequestType;
}
export interface ListRequestsResponseType {
  requests: RequestSummaryType[];
  total: number;
}

export interface RequestsRouterDepsType {
  db: Db;
  config: Config;
}

export type RequestsRepositoryType = ReturnType<typeof createRequestsRepository>;
export type RequestsServiceType = ReturnType<typeof createRequestsService>;
export type RequestsControllerType = ReturnType<typeof createRequestsController>;
