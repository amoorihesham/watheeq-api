import { z } from "zod";
import {
  escalationRules,
  informationAskedIn,
  informationRequestStates,
  requestStates,
  stageRunStates,
} from "@/db/schema/index.js";
import { formFieldResponseSchema } from "@/modules/services/services.responses.js";

const person = z.strictObject({ id: z.string(), name: z.string() });

/** The SLA: live while in progress, the frozen record once closed (R6.22, R6.23). */
export const slaResponseSchema = z.strictObject({
  deadline: z.date(),
  elapsedDays: z.number(),
  met: z.boolean(),
  breachDays: z.number(),
  awaitingInfoDays: z.number(),
});

/** The stage a request in progress is at, and who it waits on; nobody while held. */
export const activeStageResponseSchema = z.strictObject({
  name: z.string(),
  waitingOn: z.array(person),
});

export const requestSummaryResponseSchema = z.strictObject({
  id: z.string(),
  number: z.string(),
  title: z.string(),
  state: z.enum(requestStates.enumValues),
  service: z.strictObject({ id: z.string(), name: z.string() }),
  priority: z.strictObject({ name: z.string(), days: z.number() }),
  requester: person,
  handler: person.nullable(),
  submittedAt: z.date(),
  acceptedAt: z.date().nullable(),
  closedAt: z.date().nullable(),
  deadline: z.date().nullable(),
  activeStage: activeStageResponseSchema.nullable(),
});

export const requestFileResponseSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  sha256: z.string(),
  fieldId: z.string().nullable(),
  informationRequestId: z.string().nullable(),
  attachedBy: person,
  attachedAt: z.date(),
});

/** A file named in a form answer; once removed only its ID is known, and the rest is `null` (R6.25). */
const answerFileResponseSchema = z.strictObject({
  id: z.string(),
  removed: z.boolean(),
  name: z.string().nullable(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
});

/**
 * An answered field as stored with the request. `chosen` is set for choice fields and `files` for file fields;
 * the other fields have `null` there.
 */
const answerResponseSchema = z.strictObject({
  field: formFieldResponseSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  chosen: z.array(z.strictObject({ id: z.string(), label: z.string() })).nullable(),
  files: z.array(answerFileResponseSchema).nullable(),
});

/** A question to the requester, with its answer and the files sent with it (R6.20). */
const informationRequestResponseSchema = z.strictObject({
  id: z.string(),
  askedBy: person,
  askedIn: z.enum(informationAskedIn.enumValues),
  question: z.string(),
  askedAt: z.date(),
  state: z.enum(informationRequestStates.enumValues),
  answer: z.string().nullable(),
  endedAt: z.date().nullable(),
  endedBy: person.nullable(),
  files: z.array(requestFileResponseSchema),
});

/** One run of one workflow stage, in the order the runs started. */
const stageRunResponseSchema = z.strictObject({
  id: z.string(),
  stage: z.strictObject({ id: z.string(), name: z.string(), ordinal: z.number() }),
  state: z.enum(stageRunStates.enumValues),
  narrowed: z.boolean(),
  escalated: z.boolean(),
  startedAt: z.date(),
  endedAt: z.date().nullable(),
  endedBy: person.nullable(),
  comment: z.string().nullable(),
  assignees: z.array(person),
});

/** A rule that fired on the request (D9), and the moment it was due. */
const escalationFiringResponseSchema = z.strictObject({
  rule: z.enum(escalationRules.enumValues),
  dueAt: z.date(),
  firedAt: z.date(),
});

export const requestResponseSchema = requestSummaryResponseSchema.extend({
  answers: z.array(answerResponseSchema),
  files: z.array(requestFileResponseSchema),
  informationRequests: z.array(informationRequestResponseSchema),
  stages: z.array(stageRunResponseSchema),
  sla: slaResponseSchema.nullable(),
  escalations: z.array(escalationFiringResponseSchema),
  allowedActions: z.array(z.string()),
});

/** What the submit screen needs: the services with their forms, and the priorities to choose from. */
export const catalogResponseSchema = z.strictObject({
  services: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      form: z.strictObject({ revision: z.number(), fields: z.array(formFieldResponseSchema) }),
    }),
  ),
  priorities: z.array(z.strictObject({ id: z.string(), name: z.string(), days: z.number() })),
});
