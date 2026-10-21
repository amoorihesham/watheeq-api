import { uniqueViolationConstraint } from "../db/errors.js";

/** Error codes and their HTTP statuses (Phase 0 spec, 4.2). Later phases add codes here. */
const STATUS_BY_CODE = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
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
};

/** The AppError for a known database error, or undefined (which the error handler turns into INTERNAL). */
export function fromDatabaseError(err: unknown): AppError | undefined {
  const constraint = uniqueViolationConstraint(err);
  const code = constraint === undefined ? undefined : CODE_BY_UNIQUE_CONSTRAINT[constraint];
  return code ? new AppError(code) : undefined;
}
