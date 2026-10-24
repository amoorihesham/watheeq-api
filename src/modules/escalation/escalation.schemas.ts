import { z } from "zod";
import { assigneeTargetSchema } from "@/modules/positions/index.js";
import {
  HANDLER_SIDE_BUILTINS,
  MAX_R0_DAYS,
  MAX_R1_PERCENT,
  MAX_RECIPIENTS_PER_RULE,
  MIN_R0_DAYS,
  MIN_R1_PERCENT,
} from "./escalation.config.js";

type TargetInputType = z.output<typeof assigneeTargetSchema>;

export const targetKey = (target: TargetInputType) =>
  "position" in target ? `position:${target.position.toLowerCase()}` : `builtin:${target.builtin}`;

const recipientsSchema = z.array(assigneeTargetSchema).max(MAX_RECIPIENTS_PER_RULE);

/** A rule's shared checks: a target at most once, `not_for_rule` where the rule has no handler, and a recipient when on. */
function checkRecipients(refusedBuiltins: readonly string[] = []) {
  return (
    rule: { enabled: boolean; recipients: TargetInputType[] },
    ctx: z.RefinementCtx,
  ): void => {
    const seen = new Set<string>();
    rule.recipients.forEach((target, index) => {
      const path = ["recipients", index];
      if ("builtin" in target && refusedBuiltins.includes(target.builtin)) {
        ctx.addIssue({ code: "custom", path, params: { code: "not_for_rule" } });
      }
      const key = targetKey(target);
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path, params: { code: "duplicate_recipient" } });
      }
      seen.add(key);
    });
    if (rule.enabled && rule.recipients.length === 0) {
      ctx.addIssue({ code: "custom", path: ["recipients"], params: { code: "no_recipients" } });
    }
  };
}

// Thresholds are required even for a rule that is off, so turning it on never needs a value it lost (4.1).
export const putEscalationRequestSchema = z.strictObject({
  r0: z
    .strictObject({
      enabled: z.boolean(),
      days: z.int().min(MIN_R0_DAYS).max(MAX_R0_DAYS),
      recipients: recipientsSchema,
    })
    .superRefine(checkRecipients(HANDLER_SIDE_BUILTINS)),
  r1: z
    .strictObject({
      enabled: z.boolean(),
      percent: z.int().min(MIN_R1_PERCENT).max(MAX_R1_PERCENT),
      recipients: recipientsSchema,
    })
    .superRefine(checkRecipients()),
  r2: z
    .strictObject({ enabled: z.boolean(), recipients: recipientsSchema })
    .superRefine(checkRecipients()),
});
