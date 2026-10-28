import { z } from 'zod';
import { requestStates } from '@/db/schema/index.js';
import { idFilter, optionalText, pageQuery, valueFilter } from '@/http/filters.js';
import { idSchema } from '@/http/validate.js';
import { MAX_ANSWER_LENGTH, MAX_QUESTION_LENGTH, MAX_REASON_LENGTH, MAX_TITLE_LENGTH, REQUEST_VIEWS } from './requests.constants.js';

const reason = z.string().trim().min(1).max(MAX_REASON_LENGTH);

export const submitRequestSchema = z
  .strictObject({
    serviceId: idSchema,
    priorityId: idSchema,
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    answers: z.record(z.string(), z.unknown()),
    fileIds: z.array(z.string()).optional(),
  })
  .meta({ id: 'SubmitRequest' });

export const attachFilesRequestSchema = z.strictObject({ fileIds: z.array(z.string()).min(1) }).meta({ id: 'AttachFilesRequest' });

export const askInformationRequestSchema = z.strictObject({ question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH) }).meta({ id: 'AskInformationRequest' });
export const answerInformationRequestSchema = z
  .strictObject({
    answer: z.string().trim().min(1).max(MAX_ANSWER_LENGTH),
    fileIds: z.array(z.string()).optional(),
  })
  .meta({ id: 'AnswerInformationRequest' });

export const changePriorityRequestSchema = z.strictObject({ priorityId: idSchema, reason }).meta({ id: 'ChangePriorityRequest' });
export const acceptRequestSchema = z.strictObject({ handlerId: idSchema, workflowId: idSchema }).meta({ id: 'AcceptRequest' });
/** The body of every action that only needs a reason: reject, withdraw, remove a file, close as no response. */
export const reasonRequestSchema = z.strictObject({ reason }).meta({ id: 'ReasonRequest' });
export const completeStageRequestSchema = z.strictObject({ comment: optionalText(MAX_REASON_LENGTH).optional() }).meta({ id: 'CompleteStageRequest' });
export const returnStageRequestSchema = z.strictObject({ reason }).meta({ id: 'ReturnStageRequest' });
export const escalateStageRequestSchema = z.strictObject({ reason }).meta({ id: 'EscalateStageRequest' });
export const refreshStageRequestSchema = z.strictObject({ reason: optionalText(MAX_REASON_LENGTH).optional() }).meta({ id: 'RefreshStageRequest' });
export const changeHandlerRequestSchema = z.strictObject({ handlerId: idSchema, reason }).meta({ id: 'ChangeHandlerRequest' });
export const narrowStageRequestSchema = z
  .strictObject({
    userIds: z
      .array(idSchema)
      .min(1)
      .superRefine((ids, ctx) => {
        const seen = new Set<string>();
        ids.forEach((id, index) => {
          if (seen.has(id)) {
            ctx.addIssue({ code: 'custom', path: [index], params: { code: 'duplicate_user' } });
          }
          seen.add(id);
        });
      }),
    reason,
  })
  .meta({ id: 'NarrowStageRequest' });

// Query strings stay lenient: links and proxies add parameters the API does not control.
export const listRequestsQuerySchema = z.object({
  view: z.enum(REQUEST_VIEWS).optional(),
  state: valueFilter(requestStates.enumValues, 'all'),
  serviceId: idFilter({ none: false }),
  ...pageQuery,
});
