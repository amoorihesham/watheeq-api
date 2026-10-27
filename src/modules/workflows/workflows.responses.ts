import { z } from "zod";
import { assigneeTargetResponseSchema } from "@/modules/positions/index.js";
import { STAGE_FALLBACKS } from "./workflows.constants.js";

const stage = z.strictObject({
  id: z.string(),
  name: z.string(),
  assignee: assigneeTargetResponseSchema,
  whenUnresolved: z.enum(STAGE_FALLBACKS),
  handlerMayNarrow: z.boolean(),
  handlerMayEscalate: z.boolean(),
  excludeParties: z.boolean(),
});

const versionHeader = {
  number: z.number(),
  createdAt: z.date(),
  createdBy: z.string(),
};

export const versionResponseSchema = z.strictObject({
  ...versionHeader,
  stages: z.array(stage),
});

/** An item of `GET /workflows`: the current version's header, without stages. */
export const workflowSummaryResponseSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  retired: z.boolean(),
  version: z.strictObject(versionHeader),
  versionCount: z.number(),
});

export const workflowResponseSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  retired: z.boolean(),
  version: versionResponseSchema,
  versionCount: z.number(),
});
