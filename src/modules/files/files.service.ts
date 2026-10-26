import { Readable } from "node:stream";
import type { Db, Tx } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import { AppError } from "@/http/errors.js";
import type { Logger } from "@/logging/logger.js";
import { notify } from "@/modules/notifications/index.js";
import {
  BYTES_PER_GB,
  clearNotice,
  createSubscriptionsRepository,
  recordNotice,
} from "@/modules/subscriptions/index.js";
import { holdersOf } from "@/modules/tenant-access/index.js";
import type { FileStoreType } from "@/storage/index.js";
import {
  CONTENT_TYPE_BY_KIND,
  MAX_PENDING_UPLOADS,
  PENDING_LIFETIME_HOURS,
  STORAGE_REARM_PERCENT,
  STORAGE_WARNING_PERCENT,
} from "./files.config.js";
import { fileIdSchema } from "./files.schemas.js";
import type {
  FileDownloadType,
  FileRowType,
  FilesRepositoryType,
  FileType,
  UploadInputType,
} from "./files.types.js";
import { createUploadInspector } from "./shared/inspector.js";
import { storageKeyOf } from "./shared/keys.js";
import { cleanFileName } from "./shared/names.js";

const subscriptionsRepo = createSubscriptionsRepository();

/** A non-UUID id is answered like an unknown one, never as a database cast error. */
function existingFileId(fileId: string): string {
  const parsed = fileIdSchema.safeParse(fileId);
  if (!parsed.success) {
    throw new AppError("NOT_FOUND");
  }
  return parsed.data;
}

/**
 * The storage warning (Phase 7 spec, 4.3), inside the reservation's transaction, which holds the tenant's upload
 * lock and has just summed the stored bytes: usage seen below 80% before the upload re-arms it, and usage at 90% or
 * more after it sends it once. The re-arm comes first, so one upload that jumps across both sends a new warning.
 */
async function warnWhenNearlyFull(
  tx: Tx,
  tenantId: string,
  usage: { before: number; after: number; limitBytes: number },
): Promise<void> {
  const { before, after, limitBytes } = usage;
  if (before * 100 < limitBytes * STORAGE_REARM_PERCENT) {
    await clearNotice(tx, tenantId, "storage_nearly_full", "");
  }
  if (after * 100 >= limitBytes * STORAGE_WARNING_PERCENT) {
    if (await recordNotice(tx, tenantId, "storage_nearly_full", "")) {
      await notify(tx, {
        tenantId,
        recipients: await holdersOf(tx, tenantId, "subscription.view"),
        kind: "storage.nearly_full",
        data: { usedBytes: after, limitBytes },
      });
    }
  }
}

const toFile = (row: FileRowType): FileType => {
  if (row.contentType === null || row.sha256 === null) {
    throw new Error(`file ${row.id} has no detected type`);
  }
  return {
    id: row.id,
    name: row.name,
    contentType: row.contentType,
    size: row.sizeBytes,
    sha256: row.sha256,
    expiresAt: new Date(row.createdAt.getTime() + PENDING_LIFETIME_HOURS * 3_600_000),
  };
};

export function createFilesService({
  db,
  repo,
  store,
}: {
  db: Db;
  repo: FilesRepositoryType;
  store: FileStoreType;
}) {
  /**
   * The short transaction under the tenant's upload lock: the uploader's quota, the storage reservation, and the
   * `uploading` row that makes the reservation count for the next caller (Phase 5.5 spec, 4.3 "Uploading").
   */
  function reserve(input: UploadInputType, name: string): Promise<FileRowType> {
    return withTx(db, async (tx) => {
      const [uploader] = await repo.findUploader(tx, input.tenantId, input.userId);
      if (!uploader?.isActive) {
        throw new AppError("FORBIDDEN");
      }
      await repo.lockUploads(tx, input.tenantId);
      const [open] = await repo.countOpenUploads(tx, input.userId);
      if ((open?.open ?? 0) >= MAX_PENDING_UPLOADS) {
        throw new AppError("UPLOAD_QUOTA_REACHED");
      }
      const [limit] = await subscriptionsRepo.findStorageLimit(tx, input.tenantId);
      if (!limit) {
        throw new Error(`tenant ${input.tenantId} has no subscription`);
      }
      const [stored] = await subscriptionsRepo.sumStoredBytes(tx, input.tenantId);
      const usage = {
        before: stored?.storedBytes ?? 0,
        after: (stored?.storedBytes ?? 0) + input.declaredSize,
        limitBytes: limit.storageLimitGb * BYTES_PER_GB,
      };
      if (usage.after > usage.limitBytes) {
        throw new AppError("STORAGE_LIMIT_REACHED");
      }
      await warnWhenNearlyFull(tx, input.tenantId, usage);
      const [row] = await repo.insert(tx, {
        tenantId: input.tenantId,
        uploadedBy: input.userId,
        state: "uploading",
        name,
        sizeBytes: input.declaredSize,
      });
      if (!row) {
        throw new Error("insert returned no row");
      }
      return row;
    });
  }

  /** Best effort: the bytes first, then the row, so a failure leaves a row for the sweep and never bytes without one. */
  async function abandon(fileId: string, key: string, log: Logger): Promise<void> {
    try {
      await store.delete([key]);
      await repo.deleteById(db, fileId);
    } catch (err) {
      log.error({ err, fileId }, "could not remove a failed upload; the sweep will");
    }
  }

  return {
    /**
     * Stores one file as a pending upload (R5.5.9-R5.5.12, R5.5.18, R5.5.19). Any failure after the reservation
     * deletes the bytes and the row, and answers the error.
     */
    async upload(input: UploadInputType, log: Logger): Promise<FileType> {
      const { name, kind } = cleanFileName(input.name);
      const reserved = await reserve(input, name);
      const key = storageKeyOf(input.tenantId, reserved.id);
      const inspector = createUploadInspector(kind, input.declaredSize);
      try {
        try {
          await store.put(key, Readable.from(inspector.measure(input.body), { objectMode: false }));
        } catch (err) {
          throw inspector.failure() ?? err;
        }
        const [pending] = await repo.markPending(db, reserved.id, {
          contentType: CONTENT_TYPE_BY_KIND[kind],
          sha256: inspector.sha256(),
        });
        if (!pending) {
          throw new Error("the upload row was removed while its bytes were arriving");
        }
        return toFile(pending);
      } catch (err) {
        if (!(err instanceof AppError)) {
          log.error({ err, fileId: reserved.id }, "upload failed");
        }
        await abandon(reserved.id, key, log);
        throw err;
      }
    },

    /** The caller's own pending upload; anyone else's, or a file in another state, is 404 (R5.5.9, R5.5.16). */
    async get(tenantId: string, userId: string, fileId: string): Promise<FileType> {
      const [row] = await repo.findPendingOf(db, tenantId, userId, existingFileId(fileId));
      if (!row) {
        throw new AppError("NOT_FOUND");
      }
      return toFile(row);
    },

    async open(
      tenantId: string,
      userId: string,
      fileId: string,
    ): Promise<{ file: FileDownloadType; body: Readable }> {
      const [row] = await repo.findPendingOf(db, tenantId, userId, existingFileId(fileId));
      if (!row) {
        throw new AppError("NOT_FOUND");
      }
      const file = toFile(row);
      return {
        file: { name: file.name, contentType: file.contentType, sizeBytes: file.size },
        body: await store.get(storageKeyOf(tenantId, row.id)),
      };
    },

    /** Marks the caller's pending upload `discarded`: it disappears at once and the sweep deletes bytes and row. */
    async discard(tenantId: string, userId: string, fileId: string): Promise<void> {
      const rows = await repo.discardPendingOf(db, tenantId, userId, existingFileId(fileId));
      if (rows.length === 0) {
        throw new AppError("NOT_FOUND");
      }
    },
  };
}
