import type { z } from 'zod';
import type { AuthConfigType } from '@/config/config.js';
import type { Db } from '@/db/pool.js';
import type { informationRequests, requestFiles, requestStageRuns, requestStates, requests } from '@/db/schema/index.js';
import type { AssigneeBuiltinType } from '@/modules/positions/index.js';
import type { AnswerSnapshotType } from '@/modules/services/shared/answers.js';
import type { FormFieldType } from '@/modules/services/shared/form.js';
import type { FileStoreType } from '@/storage/index.js';
import type { REQUEST_VIEWS } from './requests.constants.js';
import type { createRequestsController } from './requests.controller.js';
import type { createRequestsRepository } from './requests.repository.js';
import type { activeStageResponseSchema, catalogResponseSchema, requestFileResponseSchema, requestResponseSchema, requestSummaryResponseSchema, slaResponseSchema } from './requests.responses.js';
import type {
  acceptRequestSchema,
  answerInformationRequestSchema,
  askInformationRequestSchema,
  attachFilesRequestSchema,
  changeHandlerRequestSchema,
  changePriorityRequestSchema,
  completeStageRequestSchema,
  escalateStageRequestSchema,
  listRequestsQuerySchema,
  narrowStageRequestSchema,
  reasonRequestSchema,
  refreshStageRequestSchema,
  returnStageRequestSchema,
  submitRequestSchema,
} from './requests.schemas.js';
import type { createRequestsService } from './requests.service.js';

export type RequestStateType = (typeof requestStates.enumValues)[number];
export type RequestViewType = (typeof REQUEST_VIEWS)[number];

/** A request row as an action locks it, without the names of the people. */
export type RequestRowType = typeof requests.$inferSelect;

/** A request row for a list: the people's names, no answers. */
export type RequestSummaryRowType = Omit<RequestRowType, 'answers'> & {
  requesterName: string;
  handlerName: string | null;
};

/** The row a request page is built from. */
export type RequestDetailRowType = RequestSummaryRowType & { answers: AnswerSnapshotType[] };

/** What the SLA functions read: the acceptance, the priority's days, and the closure record once frozen. */
export type SlaSourceType = Pick<RequestRowType, 'state' | 'acceptedAt' | 'priorityDays' | 'slaDeadline' | 'elapsedDays' | 'breachDays' | 'awaitingInfoDays' | 'slaMet'>;

export type StageRunRowType = typeof requestStageRuns.$inferSelect;

export type StageRunViewRowType = StageRunRowType & {
  stageName: string;
  endedByName: string | null;
};

export interface StageAssigneeRowType {
  runId: string;
  userId: string;
  name: string;
}

/** One stage of a workflow version, as a run is started and acted on. */
export interface StageDefRowType {
  id: string;
  ordinal: number;
  name: string;
  targetPositionId: string | null;
  targetBuiltin: AssigneeBuiltinType | null;
  whenUnresolved: 'escalate' | 'skip' | 'hold';
  handlerMayNarrow: boolean;
  handlerMayEscalate: boolean;
  excludeParties: boolean;
}

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

/** A file attached to a request, with its link and the name of whoever attached it. */
export interface RequestFileRowType {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  fieldId: string | null;
  informationRequestId: string | null;
  attachedBy: string;
  attachedByName: string;
  attachedAt: Date;
}

export type NewRequestFileType = typeof requestFiles.$inferInsert;

export type InformationRequestRowType = typeof informationRequests.$inferSelect;
export type NewInformationRequestType = typeof informationRequests.$inferInsert;

/** An information request with the names of its asker and of whoever ended it. */
export type InformationRequestListRowType = InformationRequestRowType & {
  askedByName: string;
  endedByName: string | null;
};

export interface MemberUnitRowType {
  unitId: string | null;
}

export type SubmitRequestType = z.output<typeof submitRequestSchema>;
export type ChangePriorityRequestType = z.output<typeof changePriorityRequestSchema>;
export type AcceptRequestType = z.output<typeof acceptRequestSchema>;
export type ReasonRequestType = z.output<typeof reasonRequestSchema>;
export type CompleteStageRequestType = z.output<typeof completeStageRequestSchema>;
export type ReturnStageRequestType = z.output<typeof returnStageRequestSchema>;
export type EscalateStageRequestType = z.output<typeof escalateStageRequestSchema>;
export type RefreshStageRequestType = z.output<typeof refreshStageRequestSchema>;
export type ChangeHandlerRequestType = z.output<typeof changeHandlerRequestSchema>;
export type NarrowStageRequestType = z.output<typeof narrowStageRequestSchema>;
export type AskInformationRequestType = z.output<typeof askInformationRequestSchema>;
export type AnswerInformationRequestType = z.output<typeof answerInformationRequestSchema>;
export type AttachFilesRequestType = z.output<typeof attachFilesRequestSchema>;
export type ListRequestsQueryType = z.output<typeof listRequestsQuerySchema>;

export type SlaType = z.output<typeof slaResponseSchema>;
export type ActiveStageType = z.output<typeof activeStageResponseSchema>;
export type RequestSummaryType = z.output<typeof requestSummaryResponseSchema>;
export type RequestFileType = z.output<typeof requestFileResponseSchema>;
export type RequestType = z.output<typeof requestResponseSchema>;
export type RequestAnswerType = RequestType['answers'][number];
export type AnswerFileType = NonNullable<RequestAnswerType['files']>[number];
export type InformationRequestType = RequestType['informationRequests'][number];
export type StageRunType = RequestType['stages'][number];
export type EscalationFiringType = RequestType['escalations'][number];
export type CatalogType = z.output<typeof catalogResponseSchema>;

export interface RequestsRouterDepsType {
  db: Db;
  auth: AuthConfigType;
  store: FileStoreType;
}

export type RequestsRepositoryType = ReturnType<typeof createRequestsRepository>;
export type RequestsServiceType = ReturnType<typeof createRequestsService>;
export type RequestsControllerType = ReturnType<typeof createRequestsController>;

/** An open request with the escalation settings and firings the check needs to decide what is due. */
export interface EscalationCandidateRowType {
  tenantId: string;
  id: string;
  year: number;
  number: number;
  title: string;
  state: 'in_review' | 'in_progress';
  submittedAt: Date;
  acceptedAt: Date | null;
  priorityDays: number;
  r0: { enabled: boolean; days: number; fired: boolean };
  r1: { enabled: boolean; percent: number; fired: boolean };
  r2: { enabled: boolean; fired: boolean };
}

/** The request as a firing locks it. */
export interface LockedRequestRowType {
  id: string;
  tenantId: string;
  year: number;
  number: number;
  title: string;
  state: RequestStateType;
  requesterId: string;
  handlerId: string | null;
}
