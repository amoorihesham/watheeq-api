import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { Executor } from "@/db/pool.js";
import { files, tenantMembers, users } from "@/db/schema/index.js";
import {
  ABANDONED_AFTER_HOURS,
  OVERDUE_AFTER_HOURS,
  PENDING_LIFETIME_HOURS,
} from "./files.config.js";
import type { DueFileRowType, FileRowType, LockedFileRowType, NewFileType } from "./files.types.js";

const hours = (value: number) => sql`make_interval(hours => ${value})`;

const ofUploader = (tenantId: string, userId: string, fileId: string) =>
  and(eq(files.tenantId, tenantId), eq(files.uploadedBy, userId), eq(files.id, fileId));

/** Tenant code: every query is filtered by the caller's tenant (T2), except the sweep, which serves all tenants. */
export function createFilesRepository() {
  return {
    /**
     * Serializes the upload checks of one tenant until the transaction ends: the per-person quota and the storage
     * reservation (Phase 5.5 spec, 4.3). Keyed apart from the seat lock, which uses the bare tenant id.
     */
    lockUploads(db: Executor, tenantId: string) {
      return db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`uploads:${tenantId}`}, 0))`,
      );
    },

    findUploader(db: Executor, tenantId: string, userId: string): Promise<{ isActive: boolean }[]> {
      return db
        .select({ isActive: users.isActive })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)));
    },

    countOpenUploads(db: Executor, userId: string): Promise<{ open: number }[]> {
      return db
        .select({ open: count() })
        .from(files)
        .where(and(eq(files.uploadedBy, userId), inArray(files.state, ["uploading", "pending"])));
    },

    insert(db: Executor, values: NewFileType): Promise<FileRowType[]> {
      return db.insert(files).values(values).returning();
    },

    /** Only an `uploading` row moves on: a row the sweep already deleted stays gone. */
    markPending(
      db: Executor,
      fileId: string,
      detected: { contentType: string; sha256: string },
    ): Promise<FileRowType[]> {
      return db
        .update(files)
        .set({ state: "pending", ...detected })
        .where(and(eq(files.id, fileId), eq(files.state, "uploading")))
        .returning();
    },

    deleteById(db: Executor, fileId: string) {
      return db.delete(files).where(eq(files.id, fileId));
    },

    findPendingOf(
      db: Executor,
      tenantId: string,
      userId: string,
      fileId: string,
    ): Promise<FileRowType[]> {
      return db
        .select()
        .from(files)
        .where(and(ofUploader(tenantId, userId, fileId), eq(files.state, "pending")));
    },

    discardPendingOf(
      db: Executor,
      tenantId: string,
      userId: string,
      fileId: string,
    ): Promise<{ id: string }[]> {
      return db
        .update(files)
        .set({ state: "discarded" })
        .where(and(ofUploader(tenantId, userId, fileId), eq(files.state, "pending")))
        .returning({ id: files.id });
    },

    /** Locks the tenant's rows among `fileIds`, in id order so two attaches cannot deadlock. */
    lockForAttach(db: Executor, tenantId: string, fileIds: string[]): Promise<LockedFileRowType[]> {
      return db
        .select({
          id: files.id,
          uploadedBy: files.uploadedBy,
          state: files.state,
          expired: sql<boolean>`${files.createdAt} <= now() - ${hours(PENDING_LIFETIME_HOURS)}`,
        })
        .from(files)
        .where(and(eq(files.tenantId, tenantId), inArray(files.id, fileIds)))
        .orderBy(files.id)
        .for("update");
    },

    markAttached(db: Executor, fileIds: string[]): Promise<FileRowType[]> {
      return db
        .update(files)
        .set({ state: "attached", attachedAt: sql`now()` })
        .where(inArray(files.id, fileIds))
        .returning();
    },

    markDiscarded(db: Executor, tenantId: string, fileIds: string[]): Promise<{ id: string }[]> {
      return db
        .update(files)
        .set({ state: "discarded", attachedAt: null })
        .where(
          and(
            eq(files.tenantId, tenantId),
            inArray(files.id, fileIds),
            inArray(files.state, ["pending", "attached"]),
          ),
        )
        .returning({ id: files.id });
    },

    /**
     * Locks up to `limit` files nobody needs: discarded, pending past their life, or uploading past an hour. Rows
     * another transaction holds are skipped, and a row that stopped matching before the lock was taken is not
     * returned, so a file attached a moment ago is never deleted (Phase 5.5 spec, 4.3 "Races with requests").
     */
    lockDue(db: Executor, limit: number) {
      return db.execute<{ id: string; tenant_id: string; kind: DueFileRowType["kind"] }>(sql`
        select id, tenant_id,
          case state when 'discarded' then 'discarded' when 'pending' then 'expired' else 'abandoned' end as kind
        from files
        where state = 'discarded'
          or (state = 'pending' and created_at < now() - ${hours(PENDING_LIFETIME_HOURS)})
          or (state = 'uploading' and created_at < now() - ${hours(ABANDONED_AFTER_HOURS)})
        order by created_at
        limit ${limit}
        for update skip locked`);
    },

    deleteByIds(db: Executor, fileIds: string[]) {
      return db.delete(files).where(inArray(files.id, fileIds));
    },

    /** Files more than an hour past their due time, which only happens when sweeps keep failing. */
    countOverdue(db: Executor) {
      return db.execute<{ overdue: number }>(sql`
        select count(*)::int as overdue from files
        where (state = 'pending'
            and created_at < now() - ${hours(PENDING_LIFETIME_HOURS + OVERDUE_AFTER_HOURS)})
          or (state = 'uploading'
            and created_at < now() - ${hours(ABANDONED_AFTER_HOURS + OVERDUE_AFTER_HOURS)})`);
    },
  };
}
