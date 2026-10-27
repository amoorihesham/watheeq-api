export const MIN_R0_DAYS = 1;
export const MAX_R0_DAYS = 30;
export const MIN_R1_PERCENT = 1;
export const MAX_R1_PERCENT = 99;
export const MAX_RECIPIENTS_PER_RULE = 20;

/** R0 fires before acceptance, when no handler exists, so these cannot receive it (R5.13). */
export const HANDLER_SIDE_BUILTINS = [
  "handler",
  "handler_unit_managers",
  "handler_department_managers",
] as const;
