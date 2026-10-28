import { pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const tenantNoticeKinds = pgEnum('tenant_notice_kinds', ['subscription_ending_soon', 'subscription_grace_started', 'subscription_read_only_started', 'storage_nearly_full']);

/**
 * Which warnings a tenant was already sent (Phase 7 spec, 4.1). The key is the subscription's end date, so an
 * extension re-arms the three subscription warnings; storage uses the empty key and its row is deleted to re-arm.
 */
export const tenantNotices = pgTable(
  'tenant_notices',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: tenantNoticeKinds().notNull(),
    key: text().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'tenant_notices_pk', columns: [t.tenantId, t.kind, t.key] })],
);
