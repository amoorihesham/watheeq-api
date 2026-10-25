import type { Tx } from "@/db/pool.js";
import { AppError, type ErrorDetail } from "@/http/errors.js";
import { createFilesRepository } from "../files.repository.js";
import { fileIdSchema } from "../files.schemas.js";
import type { AttachedFileType, FileRowType } from "../files.types.js";

const repo = createFilesRepository();

const toAttached = (row: FileRowType): AttachedFileType => {
  if (row.contentType === null || row.sha256 === null) {
    throw new Error(`file ${row.id} is attached without a detected type`);
  }
  return {
    id: row.id,
    name: row.name,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
  };
};

/**
 * Makes pending uploads part of a record, for Phase 6 to call in its own transaction (Phase 5.5 spec, 4.3).
 * Locks the rows and requires each to be in the tenant, uploaded by `userId`, pending, and under 24 hours old, so a
 * file is never attached late just because the sweep has not run yet (R5.5.12).
 * A refusal is a 400 whose details name the index in `fileIds` as `fileIds.<index>`: `unknown_file` (absent, another
 * tenant's, another person's, or not pending, so nothing is revealed), `file_expired`, or `file_attached` (also for a
 * file named twice). Returns the files in the order named.
 */
export async function attachFiles(
  tx: Tx,
  tenantId: string,
  userId: string,
  fileIds: string[],
): Promise<AttachedFileType[]> {
  if (fileIds.length === 0) {
    return [];
  }
  const ids = fileIds.map((id) => {
    const parsed = fileIdSchema.safeParse(id);
    return parsed.success ? parsed.data : undefined;
  });
  const valid = ids.filter((id): id is string => id !== undefined);
  const locked = new Map(
    (valid.length > 0 ? await repo.lockForAttach(tx, tenantId, valid) : []).map((row) => [
      row.id,
      row,
    ]),
  );

  const details: ErrorDetail[] = [];
  const seen = new Set<string>();
  for (const [index, id] of ids.entries()) {
    const row = id === undefined ? undefined : locked.get(id);
    let code: string | undefined;
    if (!id || !row || row.uploadedBy !== userId) {
      code = "unknown_file";
    } else if (row.state === "attached" || seen.has(id)) {
      code = "file_attached";
    } else if (row.state !== "pending") {
      code = "unknown_file";
    } else if (row.expired) {
      code = "file_expired";
    }
    if (code) {
      details.push({ path: `fileIds.${index}`, code });
    } else if (id) {
      seen.add(id);
    }
  }
  if (details.length > 0) {
    throw new AppError("VALIDATION_FAILED", details);
  }

  const attached = new Map((await repo.markAttached(tx, [...seen])).map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = id === undefined ? undefined : attached.get(id);
    if (!row) {
      throw new Error("attach returned no row for a locked file");
    }
    return toAttached(row);
  });
}

/**
 * Marks files `discarded`, so the sweep deletes their bytes and rows. Phase 6 calls it in the transaction that
 * removes an attachment, and deletes its own link rows to the files there, since the file rows disappear later.
 * Ids that are not the tenant's pending or attached files are ignored.
 */
export async function discardFiles(tx: Tx, tenantId: string, fileIds: string[]): Promise<void> {
  const ids = fileIds.flatMap((id) => {
    const parsed = fileIdSchema.safeParse(id);
    return parsed.success ? [parsed.data] : [];
  });
  if (ids.length > 0) {
    await repo.markDiscarded(tx, tenantId, ids);
  }
}
