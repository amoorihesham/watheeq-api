import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/** `discarded` waits for the cleanup sweep to delete the bytes and then the row (Phase 5.5 spec, P5.5.4, P5.5.8). */
export const fileStates = pgEnum("file_states", ["uploading", "pending", "attached", "discarded"]);

/** One row per stored object, written before its bytes, so the database is the list of what the store holds. */
export const files = pgTable(
  "files",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    state: fileStates().notNull(),
    name: text().notNull(),
    // Detected from the content; null while uploading.
    contentType: text("content_type"),
    // The size declared by Content-Length, reserved before the bytes arrive and checked against the bytes received.
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    attachedAt: timestamp("attached_at", { withTimezone: true }),
  },
  (t) => [
    // The target of Phase 6's composite foreign keys (T21).
    unique("files_tenant_id_unique").on(t.tenantId, t.id),
    check("files_attached_at", sql`(${t.state} = 'attached') = (${t.attachedAt} is not null)`),
    check(
      "files_detected",
      sql`${t.state} = 'uploading' or (${t.contentType} is not null and ${t.sha256} is not null)`,
    ),
    check("files_size", sql`${t.sizeBytes} between 1 and 26214400`),
    check("files_name_length", sql`char_length(${t.name}) between 1 and 255`),
    // The cleanup sweep, the pending-upload quota, and the storage usage sum.
    index("files_cleanup_idx").on(t.state, t.createdAt).where(sql`${t.state} <> 'attached'`),
    index("files_uploader_idx").on(t.uploadedBy).where(sql`${t.state} <> 'attached'`),
    index("files_tenant_idx").on(t.tenantId),
  ],
);
