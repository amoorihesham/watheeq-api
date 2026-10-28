import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// Both links prove the person controls the email, then let them set a password (Phase 2 spec, P2.6).
export const passwordTokenPurposes = pgEnum('password_token_purposes', ['invitation', 'reset']);

export const passwordTokens = pgTable(
  'password_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    purpose: passwordTokenPurposes().notNull(),
    // SHA-256 of the token; the raw token exists only in the emailed link.
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Set when the link is used, or when a newer link or a deactivation retires it.
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('password_tokens_token_hash_unique').on(t.tokenHash), index('password_tokens_user_idx').on(t.userId)],
);
