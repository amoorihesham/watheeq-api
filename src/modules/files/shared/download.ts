import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import type { FileDownloadType } from '../files.types.js';

/**
 * Serves a file only as a download, never inside the application's pages (R5.5.13): an attachment with the
 * detected type, no sniffing, and a sandbox policy, so uploaded content can never run in the API's origin.
 * Phase 6 serves attached files through this too. `res.attachment` writes `filename` and `filename*=UTF-8''...`,
 * which carries Arabic names.
 */
export async function sendDownload(res: Response, file: FileDownloadType, body: Readable): Promise<void> {
  res.attachment(file.name);
  res.set({
    'Content-Type': file.contentType.startsWith('text/') ? `${file.contentType}; charset=utf-8` : file.contentType,
    'Content-Length': String(file.sizeBytes),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  });
  try {
    await pipeline(body, res);
  } catch (err) {
    // A client that stops downloading is not a server error.
    if ((err as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      throw err;
    }
  }
}
