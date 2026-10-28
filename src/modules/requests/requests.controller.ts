import type { Request } from 'express';
import type { HandlerOf } from '@/http/endpoint.js';
import { auditContextOf, principalOf } from '@/modules/auth/index.js';
import { subscriptionOf } from '@/modules/subscriptions/index.js';
import type { requestsApi } from './requests.endpoints.js';
import type { RequestsServiceType } from './requests.types.js';

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const callerOf = (req: Request) => principalOf(req).id;

type EndpointsType = typeof requestsApi.endpoints;

export function createRequestsController({ service }: { service: RequestsServiceType }) {
  return {
    catalog: (async (_input, req) => service.catalog(tenantOf(req))) satisfies HandlerOf<EndpointsType['catalog']>,

    submit: (async ({ body }, req) => service.submit(tenantOf(req), callerOf(req), body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['submit']>,

    list: (async ({ query }, req) => service.list(tenantOf(req), callerOf(req), query)) satisfies HandlerOf<EndpointsType['list']>,

    get: (async ({ params }, req) => service.get(tenantOf(req), callerOf(req), params.requestId)) satisfies HandlerOf<EndpointsType['get']>,

    changePriority: (async ({ params, body }, req) => service.changePriority(tenantOf(req), callerOf(req), params.requestId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['changePriority']>,

    accept: (async ({ params, body }, req) => service.accept(tenantOf(req), callerOf(req), params.requestId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['accept']>,

    reject: (async ({ params, body }, req) => service.reject(tenantOf(req), callerOf(req), params.requestId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['reject']>,

    withdraw: (async ({ params, body }, req) => service.withdraw(tenantOf(req), callerOf(req), params.requestId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['withdraw']>,

    changeHandler: (async ({ params, body }, req) => service.changeHandler(tenantOf(req), callerOf(req), params.requestId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['changeHandler']>,

    completeStage: (async ({ params, body }, req) => service.completeStage(tenantOf(req), callerOf(req), params.requestId, params.runId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['completeStage']>,

    returnStage: (async ({ params, body }, req) => service.returnStage(tenantOf(req), callerOf(req), params.requestId, params.runId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['returnStage']>,

    narrowStage: (async ({ params, body }, req) => service.narrowStage(tenantOf(req), callerOf(req), params.requestId, params.runId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['narrowStage']>,

    escalateStage: (async ({ params, body }, req) => service.escalateStage(tenantOf(req), callerOf(req), params.requestId, params.runId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['escalateStage']>,

    refreshStage: (async ({ params, body }, req) => service.refreshStage(tenantOf(req), callerOf(req), params.requestId, params.runId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['refreshStage']>,

    askInformation: (async ({ params, body }, req) => service.askInformation(tenantOf(req), callerOf(req), params.requestId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['askInformation']>,

    answerInformation: (async ({ params, body }, req) => service.answerInformation(tenantOf(req), callerOf(req), params.requestId, params.infoId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['answerInformation']>,

    cancelInformation: (async ({ params }, req) => service.cancelInformation(tenantOf(req), callerOf(req), params.requestId, params.infoId, auditContextOf(req))) satisfies HandlerOf<EndpointsType['cancelInformation']>,

    closeNoResponse: (async ({ params, body }, req) => service.closeNoResponse(tenantOf(req), callerOf(req), params.requestId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['closeNoResponse']>,

    attachFiles: (async ({ params, body }, req) => service.attachFiles(tenantOf(req), callerOf(req), params.requestId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['attachFiles']>,

    removeFile: (async ({ params, body }, req) => service.removeFile(tenantOf(req), callerOf(req), params.requestId, params.fileId, body, auditContextOf(req))) satisfies HandlerOf<EndpointsType['removeFile']>,

    fileContent: (async ({ params }, req) => service.openFile(tenantOf(req), callerOf(req), params.requestId, params.fileId)) satisfies HandlerOf<EndpointsType['fileContent']>,
  };
}
