import { foreignKeyViolationConstraint, uniqueViolationConstraint } from "../db/errors.js";

/** Error codes and their HTTP statuses (Phase 0 spec, 4.2). Later phases add codes here. */
const STATUS_BY_CODE = {
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
  EMAIL_TAKEN: 409,
  PLAN_NAME_TAKEN: 409,
  SLUG_TAKEN: 409,
  ALREADY_VERIFIED: 409,
  USER_LIMIT_REACHED: 409,
  UNIT_NAME_TAKEN: 409,
  UNIT_NOT_EMPTY: 409,
  OWNER_PROTECTED: 409,
  USER_INACTIVE: 409,
  ROLE_NAME_TAKEN: 409,
  ROLE_IN_USE: 409,
  ROLE_PROTECTED: 409,
  CALENDAR_DATE_LOCKED: 409,
  CALENDAR_PERIOD_ENDED: 409,
  POSITION_NAME_TAKEN: 409,
  POSITION_IN_USE: 409,
  POSITION_UNIT_GONE: 409,
  RESOURCE_RETIRED: 409,
  WORKFLOW_NAME_TAKEN: 409,
  WORKFLOW_VERSION_CHANGED: 409,
  WORKFLOW_POSITION_RETIRED: 409,
  WORKFLOW_IN_USE: 409,
  SERVICE_NAME_TAKEN: 409,
  SERVICE_WORKFLOW_RETIRED: 409,
  SERVICE_FORM_CHANGED: 409,
  PRIORITY_NAME_TAKEN: 409,
  UPLOAD_QUOTA_REACHED: 409,
  STORAGE_LIMIT_REACHED: 409,
  LENGTH_REQUIRED: 411,
  PAYLOAD_TOO_LARGE: 413,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  FILE_TYPE_NOT_ALLOWED: 415,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof STATUS_BY_CODE;

export interface ErrorDetail {
  path: string;
  code: string;
  /** The scope a permission is needed at; only on PERMISSION_NOT_HELD details. */
  scope?: string;
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
 * Unique constraints whose violation is a client error. Later phases add theirs here.
 * Repositories never catch database errors; this map is the one place they become error codes.
 */
const CODE_BY_UNIQUE_CONSTRAINT: Record<string, ErrorCode> = {
  users_email_unique: "EMAIL_TAKEN",
  plans_name_lower_unique: "PLAN_NAME_TAKEN",
  tenants_slug_unique: "SLUG_TAKEN",
  org_units_department_name_unique: "UNIT_NAME_TAKEN",
  org_units_section_name_unique: "UNIT_NAME_TAKEN",
  roles_name_unique: "ROLE_NAME_TAKEN",
  positions_name_unique: "POSITION_NAME_TAKEN",
  workflows_name_unique: "WORKFLOW_NAME_TAKEN",
  services_name_unique: "SERVICE_NAME_TAKEN",
  priorities_name_unique: "PRIORITY_NAME_TAKEN",
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
  const code = unique === undefined ? undefined : CODE_BY_UNIQUE_CONSTRAINT[unique];
  if (code) {
    return new AppError(code);
  }
  const foreignKey = foreignKeyViolationConstraint(err);
  const detail = foreignKey === undefined ? undefined : DETAIL_BY_FOREIGN_KEY[foreignKey];
  return detail ? new AppError("VALIDATION_FAILED", [detail]) : undefined;
}
