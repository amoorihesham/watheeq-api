import { inject } from "vitest";
import { createS3Store, type FileStoreType } from "../../src/storage/index.js";

/** The real S3-compatible server started by the global setup. */
export function connectToTestStore(): FileStoreType {
  return createS3Store(inject("storage"));
}

/** Whether the store holds an object under the key. */
export async function objectExists(store: FileStoreType, key: string): Promise<boolean> {
  try {
    const body = await store.get(key);
    body.destroy();
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") {
      return false;
    }
    throw err;
  }
}
