import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { connectToTestStore, objectExists } from "./helpers/storage.js";

// The S3 implementation of FileStoreType against the real S3-compatible server of the test run.

const store = connectToTestStore();
const keyOf = () => `s3-store-test/${randomUUID()}`;

async function read(key: string): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of await store.get(key)) {
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts);
}

describe("S3 file store", () => {
  it("stores and returns a small object", async () => {
    const key = keyOf();
    await store.put(key, Readable.from([Buffer.from("hello"), Buffer.from(" world")]));
    expect((await read(key)).toString()).toBe("hello world");
  });

  it("stores an object larger than one part by multipart upload", async () => {
    const key = keyOf();
    const bytes = Buffer.alloc(12 * 1024 * 1024, "z");
    await store.put(key, Readable.from([bytes], { objectMode: false }));
    expect((await read(key)).equals(bytes)).toBe(true);
  });

  it("leaves no object when the stream fails midway", async () => {
    const key = keyOf();
    async function* broken() {
      yield Buffer.alloc(6 * 1024 * 1024);
      throw new Error("boom");
    }
    await expect(store.put(key, Readable.from(broken()))).rejects.toThrow("boom");
    expect(await objectExists(store, key)).toBe(false);
  });

  it("rejects a read of a missing key", async () => {
    await expect(store.get(keyOf())).rejects.toMatchObject({ name: "NoSuchKey" });
  });

  it("deletes several objects in one request, and a key that is already gone counts as deleted", async () => {
    const [a, b, gone] = [keyOf(), keyOf(), keyOf()];
    await store.put(a, Readable.from([Buffer.from("a")]));
    await store.put(b, Readable.from([Buffer.from("b")]));
    await store.delete([a, b, gone]);
    expect(await objectExists(store, a)).toBe(false);
    expect(await objectExists(store, b)).toBe(false);
    await store.delete([a]);
    await store.delete([]);
  });
});
