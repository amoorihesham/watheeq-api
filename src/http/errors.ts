import { foreignKeyViolationConstraint, uniqueViolationConstraint } from "../db/errors.js";

/** Error codes and their HTTP statuses (Phase 0 spec, 4.2). Later phases add codes here. */
const STATUS_BY_CODE = {
  VALIDATION_FAILED: 400,
  VERIFICATION_INVALID: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  SELF_CHANGE_FORBIDDEN: 403,
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
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof STATUS_BY_CODE;

export interface ErrorDetail {
  path: string;
  code: string;
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
};

/**
 * Foreign keys whose violation means a request named a unit that a concurrent request just deleted.
 * Only the referencing side is mapped: a unit delete locks the unit before checking it is empty, so the delete
 * itself never violates these keys (Phase 2 spec, 4.3).
 */
const DETAIL_BY_FOREIGN_KEY: Record<string, ErrorDetail> = {
  org_units_parent_fk: { path: "parentId", code: "unknown_unit" },
  tenant_members_unit_fk: { path: "unitId", code: "unknown_unit" },
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
