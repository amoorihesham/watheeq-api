import type { Request } from "express";
import { AppError } from "@/http/errors.js";
import { MAX_FILE_BYTES, UPLOAD_CONTENT_TYPE } from "../files.constants.js";

/**
 * The size an upload declares, checked before any byte is read: the media type must be raw bytes, the length must
 * be present (without it the storage limit cannot be checked before the bytes arrive) and within the file limit.
 */
export function declaredSizeOf(req: Request): number {
  const mediaType = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== UPLOAD_CONTENT_TYPE) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE");
  }
  const header = req.headers["content-length"];
  if (header === undefined || !/^\d+$/.test(header)) {
    throw new AppError("LENGTH_REQUIRED");
  }
  const size = Number(header);
  if (size > MAX_FILE_BYTES) {
    throw new AppError("FILE_TOO_LARGE");
  }
  if (size === 0) {
    throw new AppError("VALIDATION_FAILED", [{ path: "body", code: "empty_file" }]);
  }
  return size;
}
