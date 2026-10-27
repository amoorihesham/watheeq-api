/** S3 allows 1,000 keys in one DeleteObjects request. */
export const MAX_KEYS_PER_DELETE = 1000;
/** S3 multipart parts are at least 5 MiB; an upload is at most 25 MB, so it needs five parts at most. */
export const UPLOAD_PART_SIZE_BYTES = 5 * 1024 * 1024;
