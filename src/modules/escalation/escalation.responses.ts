import { z } from "zod";
import { assigneeTargetResponseSchema } from "@/modules/positions/index.js";

const recipients = z.array(assigneeTargetResponseSchema);

export const escalationSettingsResponseSchema = z
  .strictObject({
    r0: z.strictObject({ enabled: z.boolean(), days: z.number(), recipients }),
    r1: z.strictObject({ enabled: z.boolean(), percent: z.number(), recipients }),
    r2: z.strictObject({ enabled: z.boolean(), recipients }),
  })
  .meta({ id: "EscalationSettings" });

/** `settings` is `null` until the tenant has saved them (Q17). */
export const escalationResponseSchema = z
  .strictObject({
    configured: z.boolean(),
    settings: escalationSettingsResponseSchema.nullable(),
  })
  .meta({ id: "Escalation" });
