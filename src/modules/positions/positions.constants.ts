export const MAX_POSITION_NAME_LENGTH = 100;
export const MAX_POSITION_HOLDERS = 200;

/** The positions resolved from the request: the handler, the requester, and the managers of their unit or department. */
export const ASSIGNEE_BUILTINS = [
  "handler",
  "requester",
  "handler_unit_managers",
  "handler_department_managers",
  "requester_unit_managers",
  "requester_department_managers",
] as const;
