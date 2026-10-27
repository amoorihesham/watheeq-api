export const MAX_WORKFLOW_NAME_LENGTH = 100;
export const MAX_STAGE_NAME_LENGTH = 100;
export const MAX_STAGES = 20;

/** What a stage does when it resolves to nobody (Phase 5 spec, R5.7). */
export const STAGE_FALLBACKS = ["escalate", "skip", "hold"] as const;

/** Stages naming these have nobody to narrow to and no parties to exclude (R5.10). */
export const PARTY_BUILTINS = ["handler", "requester"] as const;
