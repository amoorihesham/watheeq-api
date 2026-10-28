import type { Readable } from 'node:stream';
import { DeleteObjectsCommand, GetObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { MAX_KEYS_PER_DELETE, UPLOAD_PART_SIZE_BYTES } from './storage.constants.js';
import type { FileStoreType, StorageSettingsType } from './storage.types.js';

export function s3ClientConfigOf(settings: StorageSettingsType): S3ClientConfig {
  return {
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKey, secretAccessKey: settings.secretKey },
    // The SDK's default adds CRC checksums to every upload, which several S3-compatible servers reject.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
}

export function createS3Store(settings: StorageSettingsType): FileStoreType {
  const client = new S3Client(s3ClientConfigOf(settings));
  const { bucket } = settings;
  return {
    async put(key, body) {
      const upload = new Upload({
        client,
        params: { Bucket: bucket, Key: key, Body: body },
        partSize: UPLOAD_PART_SIZE_BYTES,
        queueSize: settings.uploadQueueSize,
        leavePartsOnError: false,
      });
      await upload.done();
    },

    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) {
        throw new Error('object store returned no body');
      }
      return result.Body as Readable;
    },

    async delete(keys) {
      for (let start = 0; start < keys.length; start += MAX_KEYS_PER_DELETE) {
        const batch = keys.slice(start, start + MAX_KEYS_PER_DELETE);
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        // DeleteObjects answers 200 even when single keys fail.
        if (result.Errors && result.Errors.length > 0) {
          throw new Error(`object store failed to delete ${result.Errors.length} object(s)`);
        }
      }
    },
  };
}
