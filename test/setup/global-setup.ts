import {
  CreateBucketCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../../src/db/migrate.js";
import { type StorageSettingsType, s3ClientConfigOf } from "../../src/storage/index.js";

const S3_PORT = 8333;
const BUCKET = "watheeq-test";
// Keep in step with docker-compose.yml, which runs the same image for local development.
const S3_IMAGE = "chrislusf/seaweedfs:4.50";

let postgres: StartedPostgreSqlContainer | undefined;
let objectStore: StartedTestContainer | undefined;

/** SeaweedFS answers the S3 port before its filer can create buckets, so the bucket is created with retries. */
async function createBucket(settings: StorageSettingsType): Promise<void> {
  const client = new S3Client(s3ClientConfigOf(settings));
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: settings.bucket }));
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
}

async function startObjectStore(): Promise<StorageSettingsType> {
  const accessKey = "test-access-key";
  const secretKey = "test-secret-key";
  objectStore = await new GenericContainer(S3_IMAGE)
    .withCommand(["server", "-filer", "-s3", "-dir=/data"])
    .withEnvironment({ AWS_ACCESS_KEY_ID: accessKey, AWS_SECRET_ACCESS_KEY: secretKey })
    .withExposedPorts(S3_PORT)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const settings: StorageSettingsType = {
    endpoint: `http://${objectStore.getHost()}:${objectStore.getMappedPort(S3_PORT)}`,
    region: "us-east-1",
    bucket: BUCKET,
    accessKey,
    secretKey,
    forcePathStyle: true,
    uploadQueueSize: 2,
  };
  await createBucket(settings);
  await warmUp(settings);
  return settings;
}

/**
 * The first write to a fresh SeaweedFS allocates its volumes, which takes about 15 seconds and stalls every write
 * until done; doing it here keeps that wait out of the first file test, whose timeout is 15 seconds.
 */
async function warmUp(settings: StorageSettingsType): Promise<void> {
  const client = new S3Client(s3ClientConfigOf(settings));
  const key = "warm-up";
  await client.send(new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: "x" }));
  await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [started, storage] = await Promise.all([
    new PostgreSqlContainer("postgres:18").start(),
    startObjectStore(),
  ]);
  postgres = started;
  const databaseUrl = started.getConnectionUri();
  await runMigrations(databaseUrl);

  project.provide("databaseUrl", databaseUrl);
  project.provide("storage", storage);
  return async () => {
    await Promise.all([postgres?.stop(), objectStore?.stop()]);
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    /** The one database role the app, migrations, and the CLI use (T2). */
    databaseUrl: string;
    /** A real S3-compatible server and its bucket, for the file tests (Phase 5.5 spec, section 8). */
    storage: StorageSettingsType;
  }
}
