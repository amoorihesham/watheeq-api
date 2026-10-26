import type { Readable } from "node:stream";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { files } from "@/db/schema/index.js";
import type { FileStoreType } from "@/storage/index.js";
import type { FILE_KINDS } from "./files.config.js";
import type { createFilesController } from "./files.controller.js";
import type { createFilesRepository } from "./files.repository.js";
import type { createFilesService } from "./files.service.js";

export type FileKindType = (typeof FILE_KINDS)[number];

export type FileRowType = typeof files.$inferSelect;
export type NewFileType = typeof files.$inferInsert;
export type FileStateType = FileRowType["state"];

/** A file as the API returns it. */
export interface FileType {
  id: string;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
  expiresAt: Date;
}

export interface FileResponseType {
  file: FileType;
}

/** A pending file as an attach reads it; `expired` is decided by the database clock. */
export interface LockedFileRowType {
  id: string;
  uploadedBy: string;
  state: FileStateType;
  expired: boolean;
}

/** A file after `attachFiles`, in the order the caller named it. */
export interface AttachedFileType {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

export type SweepKindType = "discarded" | "expired" | "abandoned";

export interface DueFileRowType {
  id: string;
  tenantId: string;
  kind: SweepKindType;
}

export type SweepResultType = Record<SweepKindType, number>;

export interface SweepOptionsType {
  batchSize?: number;
  budgetMs?: number;
  /** Stops the run between batches (shutdown). */
  signal?: AbortSignal;
}

export interface UploadInputType {
  tenantId: string;
  userId: string;
  /** The raw `name` query parameter. */
  name: unknown;
  /** The validated `Content-Length`. */
  declaredSize: number;
  body: Readable;
}

export interface FileDownloadType {
  name: string;
  contentType: string;
  sizeBytes: number;
}

export interface FilesRouterDepsType {
  db: Db;
  config: Config;
  store: FileStoreType;
}

export interface UploadInspectorType {
  /** Passes the body through while counting, hashing, and checking it; throws an `AppError` to refuse it. */
  measure(body: Readable): AsyncGenerator<Buffer>;
  /** The first refusal thrown inside `measure`, which the object store may wrap in its own error. */
  failure(): Error | undefined;
  sha256(): string;
}

export type FilesRepositoryType = ReturnType<typeof createFilesRepository>;
export type FilesServiceType = ReturnType<typeof createFilesService>;
export type FilesControllerType = ReturnType<typeof createFilesController>;
