import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { fileTypeFromBuffer } from "file-type";
import { AppError } from "@/http/errors.js";
import { DETECTION_PREFIX_BYTES } from "../files.config.js";
import type { FileKindType, UploadInspectorType } from "../files.types.js";

const lengthMismatch = () =>
  new AppError("VALIDATION_FAILED", [{ path: "body", code: "length_mismatch" }]);
const notAllowed = () => new AppError("FILE_TYPE_NOT_ALLOWED");

/**
 * Checks an upload while it streams to the store (Phase 5.5 spec, 4.3 "Uploading"): the bytes received must equal
 * the declared size, the SHA-256 is computed, and the type detected from the start of the content must be the kind
 * the file name claims. Plain text has no signature: it must be valid UTF-8 without a NUL byte, throughout.
 * Refusing while streaming stops the transfer before the rest of the file reaches the store.
 */
export function createUploadInspector(
  kind: FileKindType,
  declaredSize: number,
): UploadInspectorType {
  const hash = createHash("sha256");
  const decoder = kind === "txt" ? new TextDecoder("utf-8", { fatal: true }) : undefined;
  let received = 0;
  let prefix: Buffer[] = [];
  let prefixBytes = 0;
  let decided = false;
  let failure: Error | undefined;

  const fail = (error: Error): Error => {
    failure ??= error;
    return failure;
  };

  async function decide(): Promise<void> {
    decided = true;
    // A malformed file that makes the detector throw is a file of no allowed type.
    const detected = await fileTypeFromBuffer(Buffer.concat(prefix)).catch(() => undefined);
    prefix = [];
    if (kind === "txt") {
      if (detected) {
        throw fail(notAllowed());
      }
      return;
    }
    if (detected?.ext === kind) {
      return;
    }
    throw fail(notAllowed());
  }

  function checkText(chunk: Buffer): void {
    if (!decoder) {
      return;
    }
    try {
      if (chunk.includes(0)) {
        throw new Error("NUL byte");
      }
      decoder.decode(chunk, { stream: true });
    } catch {
      throw fail(notAllowed());
    }
  }

  async function* measure(body: Readable): AsyncGenerator<Buffer> {
    try {
      // `destroyOnReturn: false` keeps the request open, so a refusal can still be answered on its connection.
      for await (const chunk of body.iterator({ destroyOnReturn: false })) {
        const buffer = chunk as Buffer;
        received += buffer.length;
        if (received > declaredSize) {
          throw fail(lengthMismatch());
        }
        hash.update(buffer);
        checkText(buffer);
        if (!decided) {
          prefix.push(buffer);
          prefixBytes += buffer.length;
          if (prefixBytes >= DETECTION_PREFIX_BYTES) {
            await decide();
          }
        }
        yield buffer;
      }
    } catch (err) {
      // A body that errors mid-way is a client that went away before sending what it declared.
      throw failure ?? fail(err instanceof AppError ? err : lengthMismatch());
    }
    if (received !== declaredSize) {
      throw fail(lengthMismatch());
    }
    try {
      decoder?.decode();
    } catch {
      throw fail(notAllowed());
    }
    if (!decided) {
      await decide();
    }
  }

  return {
    measure,
    failure: () => failure,
    sha256: () => hash.digest("hex"),
  };
}
