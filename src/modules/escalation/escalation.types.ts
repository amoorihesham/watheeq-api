import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { AssigneeBuiltinType } from "@/modules/positions/index.js";
import type { createEscalationController } from "./escalation.controller.js";
import type { createEscalationRepository } from "./escalation.repository.js";
import type { putEscalationRequestSchema } from "./escalation.schemas.js";
import type { escalationResponseSchema } from "./escalation.responses.js";
import type { createEscalationService } from "./escalation.service.js";

export type PutEscalationRequestType = z.input<typeof putEscalationRequestSchema>;
export type EscalationInputType = z.output<typeof putEscalationRequestSchema>;

export type EscalationRuleType = "r0" | "r1" | "r2";

/** A recipient as the settings are read inside the API; `toResponse` gives it its response shape. */
export type RecipientType =
  | { position: string; name: string | null }
  | { builtin: AssigneeBuiltinType };

export interface EscalationType {
  r0: { enabled: boolean; days: number; recipients: RecipientType[] };
  r1: { enabled: boolean; percent: number; recipients: RecipientType[] };
  r2: { enabled: boolean; recipients: RecipientType[] };
}

export interface SettingsRowType {
  r0Enabled: boolean;
  r0Days: number;
  r1Enabled: boolean;
  r1Percent: number;
  r2Enabled: boolean;
}

export interface RecipientRowType {
  rule: EscalationRuleType;
  targetPositionId: string | null;
  targetBuiltin: AssigneeBuiltinType | null;
  /** The target position's name, when the target is one. */
  positionName: string | null;
}

/** A tenant position as a save reads it under a share lock. */
export interface PositionStateRowType {
  id: string;
  retiredAt: Date | null;
}

export type EscalationResponseType = z.output<typeof escalationResponseSchema>;

export interface EscalationRouterDepsType {
  db: Db;
  config: Config;
}

export type EscalationRepositoryType = ReturnType<typeof createEscalationRepository>;
export type EscalationServiceType = ReturnType<typeof createEscalationService>;
export type EscalationControllerType = ReturnType<typeof createEscalationController>;
