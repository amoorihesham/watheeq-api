import { z } from "zod";
import { idSchema } from "@/http/validate.js";
import { assigneeTargetSchema } from "@/modules/positions/index.js";
import {
  MAX_STAGE_NAME_LENGTH,
  MAX_STAGES,
  MAX_WORKFLOW_NAME_LENGTH,
  PARTY_BUILTINS,
  STAGE_FALLBACKS,
} from "./workflows.config.js";

const workflowName = z.string().trim().min(1).max(MAX_WORKFLOW_NAME_LENGTH);

export const workflowIdSchema = idSchema;

// Every field is required: the builder decides each stage's behavior, with no default (Phase 5 spec, Q10).
const stageSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_STAGE_NAME_LENGTH),
  assignee: assigneeTargetSchema,
  whenUnresolved: z.enum(STAGE_FALLBACKS),
  handlerMayNarrow: z.boolean(),
  handlerMayEscalate: z.boolean(),
  excludeParties: z.boolean(),
});

const stagesSchema = z
  .array(stageSchema)
  .min(1)
  .superRefine((stages, ctx) => {
    if (stages.length > MAX_STAGES) {
      ctx.addIssue({ code: "custom", params: { code: "too_many_stages" } });
    }
    const seen = new Set<string>();
    stages.forEach((stage, index) => {
      const key = stage.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "name"],
          params: { code: "duplicate_name" },
        });
      }
      seen.add(key);
      if (
        "builtin" in stage.assignee &&
        (PARTY_BUILTINS as readonly string[]).includes(stage.assignee.builtin)
      ) {
        for (const field of ["handlerMayNarrow", "excludeParties"] as const) {
          if (stage[field]) {
            ctx.addIssue({
              code: "custom",
              path: [index, field],
              params: { code: "not_allowed" },
            });
          }
        }
      }
    });
  });

export const createWorkflowRequestSchema = z.strictObject({
  name: workflowName,
  stages: stagesSchema,
});

export const updateWorkflowRequestSchema = z.strictObject({
  name: workflowName,
  baseVersion: z.int().min(1),
  stages: stagesSchema,
});

// Query strings stay lenient: links and proxies add parameters the API does not control.
export const listWorkflowsQuerySchema = z.object({
  includeRetired: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

/** A version number in a path; anything else is answered like an unknown version. */
export const versionNumberSchema = z.string().regex(/^[1-9]\d{0,8}$/);
