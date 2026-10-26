import { foreignKeyViolationConstraint, uniqueViolationConstraint } from "../db/errors.js";

/** Error codes and their HTTP statuses (Phase 0 spec, 4.2). Later phases add codes here. */
export const STATUS_BY_CODE = {
  VALIDATION_FAILED: 400,
  VERIFICATION_INVALID: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  SELF_CHANGE_FORBIDDEN: 403,
  PERMISSION_NOT_HELD: 403,
  SUBSCRIPTION_READ_ONLY: 403,
  SUBSCRIPTION_NOT_ACTIVE: 403,
  NOT_FOUND: 404,
  TAKEN: 409,
  VERSION_CHANGED: 409,
  ALREADY_VERIFIED: 409,
  USER_LIMIT_REACHED: 409,
  UNIT_NOT_EMPTY: 409,
  OWNER_PROTECTED: 409,
  USER_INACTIVE: 409,
  ROLE_IN_USE: 409,
  ROLE_PROTECTED: 409,
  CALENDAR_DATE_LOCKED: 409,
  CALENDAR_PERIOD_ENDED: 409,
  POSITION_IN_USE: 409,
  POSITION_UNIT_GONE: 409,
  RESOURCE_RETIRED: 409,
  WORKFLOW_POSITION_RETIRED: 409,
  WORKFLOW_IN_USE: 409,
  SERVICE_WORKFLOW_RETIRED: 409,
  ESCALATION_NOT_CONFIGURED: 409,
  INVALID_REQUEST_STATE: 409,
  STAGE_NOT_ACTIVE: 409,
  NO_EARLIER_STAGE: 409,
  NO_HIGHER_LEVEL: 409,
  INFORMATION_REQUEST_OPEN: 409,
  NO_OPEN_INFORMATION_REQUEST: 409,
  TOO_MANY_FILES: 409,
  UPLOAD_QUOTA_REACHED: 409,
  STORAGE_LIMIT_REACHED: 409,
  LENGTH_REQUIRED: 411,
  PAYLOAD_TOO_LARGE: 413,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  FILE_TYPE_NOT_ALLOWED: 415,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof STATUS_BY_CODE;

/**
 * Every detail code the server can emit (Phase 8 spec 4.2.5): zod's own codes, the codes the framework adds, and
 * the custom codes the modules name. A literal outside this list fails to compile; a refine's `params.code` is
 * checked by `validate()` outside production.
 */
export const DETAIL_CODES = [
  "invalid_type",
  "too_small",
  "too_big",
  "invalid_format",
  "invalid_value",
  "not_multiple_of",
  "invalid_union",
  "invalid_key",
  "invalid_element",
  "unknown_field",
  "no_fields",
  "invalid_json",
  "invalid_cursor",
  "taken",
  "permission_not_held",
  "above_maximum",
  "below_minimum",
  "department_has_no_parent",
  "duplicate_field_id",
  "duplicate_label",
  "duplicate_name",
  "duplicate_option",
  "duplicate_permission",
  "duplicate_recipient",
  "duplicate_user",
  "duplicate_workflow",
  "empty_file",
  "end_before_start",
  "file_attached",
  "file_expired",
  "handler_is_requester",
  "handler_not_eligible",
  "holds_other_position",
  "in_future",
  "invalid_date",
  "invalid_day",
  "invalid_name",
  "length_mismatch",
  "manager_needs_unit",
  "many_defaults",
  "min_above_max",
  "no_default",
  "no_occurrence",
  "no_recipients",
  "no_working_day",
  "not_allowed",
  "not_assignee",
  "not_for_rule",
  "not_integer",
  "not_recurring",
  "not_unit_member",
  "order_mismatch",
  "parent_not_department",
  "period_too_long",
  "position_retired",
  "priority_retired",
  "range_too_long",
  "rank_taken",
  "required",
  "same_handler",
  "scope_not_allowed",
  "service_retired",
  "too_far_ahead",
  "too_long",
  "too_many_decimals",
  "too_many_files",
  "too_many_stages",
  "type_changed",
  "unknown_field_id",
  "unknown_file",
  "unknown_notification",
  "unknown_option",
  "unknown_option_id",
  "unknown_permission",
  "unknown_plan",
  "unknown_position",
  "unknown_priority",
  "unknown_role",
  "unknown_service",
  "unknown_unit",
  "unknown_workflow",
  "user_inactive",
  "version_changed",
  "workflow_not_allowed",
  "workflow_retired",
  "wrong_type",
] as const;

export type DetailCode = (typeof DETAIL_CODES)[number];

export interface ErrorDetail {
  path: string;
  code: DetailCode;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(code: ErrorCode, details?: ErrorDetail[]) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

/**
 * Unique constraints whose violation is a client error, each with the code and the body field it names (Phase 8
 * spec 4.2.5). Later phases add theirs here.
 * Repositories never catch database errors; this map is the one place they become error codes.
 */
interface MappedError {
  code: ErrorCode;
  details?: ErrorDetail[];
}
const takenAt = (path: string): MappedError => ({
  code: "TAKEN",
  details: [{ path, code: "taken" }],
});
const ERROR_BY_UNIQUE_CONSTRAINT: Record<string, MappedError> = {
  users_email_unique: takenAt("email"),
  plans_name_lower_unique: takenAt("name"),
  tenants_slug_unique: takenAt("slug"),
  org_units_department_name_unique: takenAt("name"),
  org_units_section_name_unique: takenAt("name"),
  roles_name_unique: takenAt("name"),
  positions_name_unique: takenAt("name"),
  workflows_name_unique: takenAt("name"),
  services_name_unique: takenAt("name"),
  priorities_name_unique: takenAt("name"),
  information_requests_one_open: { code: "INFORMATION_REQUEST_OPEN" },
};

/**
 * Foreign keys whose violation means a request named a unit or role that a concurrent request just deleted.
 * Only the referencing side is mapped: a unit or role delete locks the row before checking it is unused, so the
 * delete itself never violates these keys (Phase 2 spec 4.3, Phase 3 spec 4.3).
 */
const DETAIL_BY_FOREIGN_KEY: Record<string, ErrorDetail> = {
  org_units_parent_fk: { path: "parentId", code: "unknown_unit" },
  tenant_members_unit_fk: { path: "unitId", code: "unknown_unit" },
  tenant_members_role_fk: { path: "roleId", code: "unknown_role" },
  positions_unit_fk: { path: "unitId", code: "unknown_unit" },
  tenant_members_position_fk: { path: "userIds", code: "not_unit_member" },
};

/** The AppError for a known database error, or undefined (which the error handler turns into INTERNAL). */
export function fromDatabaseError(err: unknown): AppError | undefined {
  const unique = uniqueViolationConstraint(err);
  const mapped = unique === undefined ? undefined : ERROR_BY_UNIQUE_CONSTRAINT[unique];
  if (mapped) {
    return new AppError(mapped.code, mapped.details);
  }
  const foreignKey = foreignKeyViolationConstraint(err);
  const detail = foreignKey === undefined ? undefined : DETAIL_BY_FOREIGN_KEY[foreignKey];
  return detail ? new AppError("VALIDATION_FAILED", [detail]) : undefined;
}
