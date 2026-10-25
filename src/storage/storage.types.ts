import type { Readable } from "node:stream";

/** Where the bytes of uploaded files live. Modules depend on this; the S3 implementation and test doubles satisfy it. */
export interface FileStoreType {
  /** Stores the stream under the key; rejects (and leaves no object) when the stream or the store fails. */
  put(key: string, body: Readable): Promise<void>;
  /** The object's bytes. Rejects when the key does not exist. */
  get(key: string): Promise<Readable>;
  /** Deletes the objects in one request. A key that is already gone counts as deleted. */
  delete(keys: string[]): Promise<void>;
}

export interface StorageSettingsType {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}
