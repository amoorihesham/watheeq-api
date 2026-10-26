import type { Response } from "express";
import type { z } from "zod";
import { contractChecksEnabled } from "./checks.js";

export interface PageType<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

/**
 * Outside production the value must match its response schema, or the error handler answers 500 and logs the
 * issues with their paths; in production it is sent as it is, so a mismatch never breaks a working call (R8.16).
 */
function check<T>(schema: z.ZodType<T>, value: unknown): void {
  if (!contractChecksEnabled()) {
    return;
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`response does not match its schema: ${issues.join("; ")}`);
  }
}

/** The only way to answer with one item or a composite view: `{data}` (Phase 8 spec 4.2.1). */
export function sendData<T>(
  res: Response,
  status: 200 | 201,
  schema: z.ZodType<T>,
  value: T,
): void {
  check(schema, value);
  res.status(status).json({ data: value });
}

/** The only way to answer with a list: `{data, page: {nextCursor, total}}`. */
export function sendPage<T>(res: Response, itemSchema: z.ZodType<T>, page: PageType<T>): void {
  for (const item of page.items) {
    check(itemSchema, item);
  }
  res
    .status(200)
    .json({ data: page.items, page: { nextCursor: page.nextCursor, total: page.total } });
}

/** The only way to answer when there is nothing left to show. */
export function sendNoContent(res: Response): void {
  res.status(204).end();
}
