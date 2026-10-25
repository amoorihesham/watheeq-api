import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  type PgTableExtraConfigValue,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { files } from "./files.js";
import { informationRequests } from "./information-requests.js";
import { requests } from "./requests.js";
import { tenantMembers } from "./tenant-members.js";
import { tenants } from "./tenants.js";

/** Links an attached file to its request, and to the form field or information answer it came with (Phase 6 spec, 4.1). */
export const requestFiles = pgTable(
  "request_files",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    requestId: uuid("request_id").notNull(),
    fileId: uuid("file_id").primaryKey(),
    // Set for a file in a form answer: the key to the answer's field in the snapshot.
    fieldId: uuid("field_id"),
    // Set for a file sent with an information answer.
    informationRequestId: uuid("information_request_id"),
    attachedBy: uuid("attached_by").notNull(),
    attachedAt: timestamp("attached_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "request_files_request_fk",
      columns: [t.tenantId, t.requestId],
      foreignColumns: [requests.tenantId, requests.id],
    }),
    foreignKey({
      name: "request_files_file_fk",
      columns: [t.tenantId, t.fileId],
      foreignColumns: [files.tenantId, files.id],
    }),
    foreignKey({
      name: "request_files_attached_by_fk",
      columns: [t.tenantId, t.attachedBy],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.userId],
    }),
    // The answer's question must belong to the same request.
    foreignKey({
      name: "request_files_information_request_fk",
      columns: [t.tenantId, t.requestId, t.informationRequestId],
      foreignColumns: [
        informationRequests.tenantId,
        informationRequests.requestId,
        informationRequests.id,
      ],
    }),
    index("request_files_request_idx").on(t.requestId),
    check(
      "request_files_one_source",
      sql`${t.fieldId} is null or ${t.informationRequestId} is null`,
    ),
  ],
);
