import type { Request } from 'express';
import type { AuditContextType } from '@/audit/index.js';
import { principalOf } from './middlewares.js';

/** The audit actor and request ID of an authenticated request. */
export function auditContextOf(req: Request): AuditContextType {
  const user = principalOf(req);
  return { actor: { type: user.role, id: user.id }, requestId: String(req.id) };
}
