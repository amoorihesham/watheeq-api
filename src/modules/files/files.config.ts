/** 25 MB (Phase 5.5 spec, R5.5.10); also the upper bound of the `files.size_bytes` check. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PENDING_UPLOADS = 20;
export const MAX_FILE_NAME_LENGTH = 255;
export const PENDING_LIFETIME_HOURS = 24;
/** An `uploading` row older than this belongs to an upload that died midway. */
export const ABANDONED_AFTER_HOURS = 1;
/** A matching row this far past its due time means sweeps are failing. */
export const OVERDUE_AFTER_HOURS = 1;
export const UPLOAD_CONTENT_TYPE = "application/octet-stream";

/**
 * How much of the start of an upload is read to detect its type, so detection never buffers the file. It equals the
 * largest ZIP entry `file-type` reads for detection. A Word, Excel, or PowerPoint file is identified within it by
 * `[Content_Types].xml` when that comes first, and otherwise by the `word/`, `xl/`, or `ppt/` entry names, which
 * every producer tested writes near the start (`test/file-types.test.ts`).
 */
export const DETECTION_PREFIX_BYTES = 1024 * 1024;

/** The kinds of file that may be uploaded (Q5). A kind is the extension `file-type` reports; `txt` is plain text. */
export const FILE_KINDS = ["pdf", "docx", "xlsx", "pptx", "png", "jpg", "txt"] as const;

export const KIND_BY_EXTENSION = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  txt: "txt",
} as const;

export const CONTENT_TYPE_BY_KIND = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  txt: "text/plain",
} as const;

export const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
export const SWEEP_BATCH_SIZE = 100;
export const SWEEP_BUDGET_MS = 2 * 60 * 1000;
