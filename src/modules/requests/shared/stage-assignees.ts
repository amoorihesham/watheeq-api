import type { Executor } from '@/db/pool.js';
import { createRequestsRepository } from '../requests.repository.js';
import type { RequestRowType } from '../requests.types.js';
import { qualifiesFor } from './stages.js';

const repo = createRequestsRepository();

/** Whether the user is a recorded assignee of the request's active stage run who still qualifies (R6.14). */
export async function isLiveStageAssignee(executor: Executor, request: RequestRowType, userId: string): Promise<boolean> {
  if (request.state !== 'in_progress') {
    return false;
  }
  const [run] = await repo.liveRun(executor, request.tenantId, request.id);
  if (run?.state !== 'active') {
    return false;
  }
  const stage = (await repo.stageDefs(executor, request.tenantId, run.workflowVersionId)).find((candidate) => candidate.id === run.workflowStageId);
  return stage ? qualifiesFor(executor, request, run, stage, userId) : false;
}
