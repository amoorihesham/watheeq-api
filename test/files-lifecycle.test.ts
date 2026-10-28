import { Readable } from 'node:stream';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/pool.js';
import { withTx } from '../src/db/tx.js';
import { AppError } from '../src/http/errors.js';
import type { Logger } from '../src/logging/logger.js';
import { attachFiles, countOverdueFiles, createFileSweepJob, discardFiles, storageKeyOf, sweepFiles } from '../src/modules/files/index.js';
import { startScheduler } from '../src/scheduler/index.js';
import type { FileStoreType } from '../src/storage/index.js';
import { testConfig } from './helpers/config.js';
import { createIsolatedDb, type IsolatedDbType, type SeededTenant, seedSubscribedTenant, waitUntilBlockedOn } from './helpers/db.js';
import { eventually, failingStore, filesOf, seedFiles } from './helpers/files.js';
import { captureLogs } from './helpers/log-capture.js';
import { connectToTestStore, objectExists } from './helpers/storage.js';

// Phase 5.5 spec, R5.5.12 and 4.3: attaching, discarding, and the cleanup sweep.

// The sweep deletes every tenant's due rows, so this file runs in a database of its own and never touches the rows
// other test files are using.
const store = connectToTestStore();
const sweepOptions = testConfig().jobs.fileSweep;
let isolated: IsolatedDbType;
let pool: pg.Pool;
let db: Db;

let alNoor: SeededTenant;
let alRashid: SeededTenant;
let khalid = '';
let faisal = '';
let nasser = '';

beforeAll(async () => {
  isolated = await createIsolatedDb();
  pool = isolated.pool;
  db = createDb(pool);
  alNoor = await seedSubscribedTenant(pool, 'files-life-al-noor', [{ email: 'sara@files-life-alnoor.test' }, { email: 'khalid@files-life-alnoor.test' }, { email: 'faisal@files-life-alnoor.test' }]);
  alRashid = await seedSubscribedTenant(pool, 'files-life-al-rashid', [{ email: 'nasser@files-life-alrashid.test' }]);
  khalid = alNoor.userIds[1] ?? '';
  faisal = alNoor.userIds[2] ?? '';
  nasser = alRashid.userIds[0] ?? '';
});

afterAll(async () => {
  await isolated.drop();
});

const putBytes = (tenantId: string, fileId: string) => store.put(storageKeyOf(tenantId, fileId), Readable.from([Buffer.from('%PDF-1.4 test')]));

/** Rows with bytes in the store, like finished uploads. */
async function seedWithBytes(
  tenant: SeededTenant,
  userId: string,
  options: {
    count: number;
    state?: 'uploading' | 'pending' | 'attached' | 'discarded';
    ageHours?: number;
  },
): Promise<string[]> {
  const ids = await seedFiles(pool, { tenantId: tenant.id, userId, ...options });
  await Promise.all(ids.map((id) => putBytes(tenant.id, id)));
  return ids;
}

const stateOf = async (tenantId: string, id: string) => (await filesOf(pool, tenantId)).find((f) => f.id === id)?.state;

/** The details of the AppError a promise rejects with. */
async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) {
      return { code: err.code, details: err.details };
    }
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('attachFiles (R5.5.12)', () => {
  it("attaches Khalid's pending files and returns them in the order named", async () => {
    const [first, second] = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 2,
    });
    const attached = await withTx(db, (tx) => attachFiles(tx, alNoor.id, khalid, [second ?? '', first ?? '']));
    expect(attached.map((f) => f.id)).toEqual([second, first]);
    expect(attached[0]).toEqual({
      id: second,
      name: expect.stringContaining('seed-'),
      contentType: 'application/pdf',
      sizeBytes: 1000,
      sha256: 'seed',
    });
    const rows = await filesOf(pool, alNoor.id);
    for (const id of [first, second]) {
      const row = rows.find((f) => f.id === id);
      expect(row?.state).toBe('attached');
      expect(row?.attached_at).toBeInstanceOf(Date);
    }
  });

  it('names the index and reason of each refusal, and attaches nothing when any file is refused', async () => {
    const [good] = await seedFiles(pool, { tenantId: alNoor.id, userId: khalid, count: 1 });
    const [expired] = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 1,
      ageHours: 25,
    });
    const [attached] = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 1,
      state: 'attached',
    });
    const [discarded] = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 1,
      state: 'discarded',
    });
    const [uploading] = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 1,
      state: 'uploading',
    });
    const [nora] = await seedFiles(pool, { tenantId: alNoor.id, userId: faisal, count: 1 });
    const [foreign] = await seedFiles(pool, { tenantId: alRashid.id, userId: nasser, count: 1 });
    const absent = crypto.randomUUID();

    const result = await refusal(withTx(db, (tx) => attachFiles(tx, alNoor.id, khalid, [good ?? '', absent, nora ?? '', foreign ?? '', expired ?? '', attached ?? '', discarded ?? '', uploading ?? '', 'not-a-uuid', good ?? ''])));
    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.details).toEqual([
      { path: 'fileIds.1', code: 'unknown_file' },
      // Another person's, another tenant's, and an absent file look the same, so nothing is revealed.
      { path: 'fileIds.2', code: 'unknown_file' },
      { path: 'fileIds.3', code: 'unknown_file' },
      { path: 'fileIds.4', code: 'file_expired' },
      { path: 'fileIds.5', code: 'file_attached' },
      { path: 'fileIds.6', code: 'unknown_file' },
      { path: 'fileIds.7', code: 'unknown_file' },
      { path: 'fileIds.8', code: 'unknown_file' },
      { path: 'fileIds.9', code: 'file_attached' },
    ]);
    expect(await stateOf(alNoor.id, good ?? '')).toBe('pending');
    expect(await stateOf(alNoor.id, nora ?? '')).toBe('pending');
  });

  it('refuses a file older than 24 hours even though the sweep has not deleted it yet, and accepts one just under', async () => {
    const [almost] = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 1,
      ageHours: 23.9,
    });
    const [late] = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 1,
      ageHours: 24.1,
    });
    const refused = await refusal(withTx(db, (tx) => attachFiles(tx, alNoor.id, khalid, [late ?? ''])));
    expect(refused.details).toEqual([{ path: 'fileIds.0', code: 'file_expired' }]);
    expect(await stateOf(alNoor.id, late ?? '')).toBe('pending');
    await withTx(db, (tx) => attachFiles(tx, alNoor.id, khalid, [almost ?? '']));
    expect(await stateOf(alNoor.id, almost ?? '')).toBe('attached');
  });

  it("refuses another person's pending file as unknown, even inside one tenant", async () => {
    const [mine] = await seedFiles(pool, { tenantId: alNoor.id, userId: khalid, count: 1 });
    const refused = await refusal(withTx(db, (tx) => attachFiles(tx, alNoor.id, faisal, [mine ?? ''])));
    expect(refused.details).toEqual([{ path: 'fileIds.0', code: 'unknown_file' }]);
  });

  it('returns nothing for an empty list', async () => {
    expect(await withTx(db, (tx) => attachFiles(tx, alNoor.id, khalid, []))).toEqual([]);
  });

  it('locks its rows, so of two simultaneous attaches of one file exactly one succeeds', async () => {
    const [id] = await seedFiles(pool, { tenantId: alNoor.id, userId: khalid, count: 1 });
    const results = await Promise.allSettled([withTx(db, (tx) => attachFiles(tx, alNoor.id, khalid, [id ?? ''])), withTx(db, (tx) => attachFiles(tx, alNoor.id, khalid, [id ?? '']))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((failed.reason as AppError).details).toEqual([{ path: 'fileIds.0', code: 'file_attached' }]);
    expect(await stateOf(alNoor.id, id ?? '')).toBe('attached');
  });
});

describe('discardFiles', () => {
  it("marks pending and attached files discarded, and ignores other tenants' files and bad ids", async () => {
    const [pending] = await seedFiles(pool, { tenantId: alNoor.id, userId: khalid, count: 1 });
    const [attached] = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 1,
      state: 'attached',
    });
    const [foreign] = await seedFiles(pool, { tenantId: alRashid.id, userId: nasser, count: 1 });
    await withTx(db, (tx) => discardFiles(tx, alNoor.id, [pending ?? '', attached ?? '', foreign ?? '', 'nope']));
    expect(await stateOf(alNoor.id, pending ?? '')).toBe('discarded');
    const row = (await filesOf(pool, alNoor.id)).find((f) => f.id === attached);
    expect(row).toMatchObject({ state: 'discarded', attached_at: null });
    expect(await stateOf(alRashid.id, foreign ?? '')).toBe('pending');
  });

  it('is deleted by the next sweep, bytes first', async () => {
    const [attached] = await seedWithBytes(alNoor, khalid, { count: 1, state: 'attached' });
    await withTx(db, (tx) => discardFiles(tx, alNoor.id, [attached ?? '']));
    await sweepFiles(db, store, sweepOptions);
    expect(await stateOf(alNoor.id, attached ?? '')).toBeUndefined();
    expect(await objectExists(store, storageKeyOf(alNoor.id, attached ?? ''))).toBe(false);
  });
});

describe('sweepFiles (R5.5.12, 4.3 Cleanup)', () => {
  it('deletes discarded files, expired pending uploads, and abandoned uploads with their bytes, and counts them by kind', async () => {
    const discarded = await seedWithBytes(alNoor, khalid, { count: 2, state: 'discarded' });
    const expired = await seedWithBytes(alNoor, khalid, {
      count: 3,
      state: 'pending',
      ageHours: 25,
    });
    const abandoned = await seedWithBytes(alRashid, nasser, {
      count: 1,
      state: 'uploading',
      ageHours: 2,
    });
    const result = await sweepFiles(db, store, sweepOptions);
    expect(result.discarded).toBeGreaterThanOrEqual(2);
    expect(result.expired).toBeGreaterThanOrEqual(3);
    expect(result.abandoned).toBeGreaterThanOrEqual(1);
    for (const [tenant, ids] of [
      [alNoor, [...discarded, ...expired]],
      [alRashid, abandoned],
    ] as const) {
      for (const id of ids) {
        expect(await stateOf(tenant.id, id)).toBeUndefined();
        expect(await objectExists(store, storageKeyOf(tenant.id, id))).toBe(false);
      }
    }
  });

  it('keeps everything that is not due: fresh pending, attached, and recent uploads', async () => {
    const keep = [
      ...(await seedWithBytes(alNoor, khalid, { count: 1, state: 'pending', ageHours: 23 })),
      ...(await seedWithBytes(alNoor, khalid, { count: 1, state: 'pending', ageHours: 0 })),
      ...(await seedWithBytes(alNoor, khalid, { count: 1, state: 'attached', ageHours: 500 })),
      ...(await seedWithBytes(alNoor, khalid, { count: 1, state: 'uploading', ageHours: 0.5 })),
    ];
    await sweepFiles(db, store, sweepOptions);
    for (const id of keep) {
      expect(await stateOf(alNoor.id, id)).toBeDefined();
      expect(await objectExists(store, storageKeyOf(alNoor.id, id))).toBe(true);
    }
  });

  it('deletes a row whose bytes are already gone, so a retry after a half-finished batch is harmless', async () => {
    const [id] = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 1,
      state: 'discarded',
    });
    await sweepFiles(db, store, sweepOptions);
    expect(await stateOf(alNoor.id, id ?? '')).toBeUndefined();
  });

  it('works in batches of 100 with one store request per batch', async () => {
    const ids = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 250,
      state: 'discarded',
    });
    const calls: number[] = [];
    const counting: FileStoreType = {
      ...store,
      delete: (keys) => {
        calls.push(keys.length);
        return store.delete(keys);
      },
    };
    const result = await sweepFiles(db, counting, sweepOptions);
    expect(result.discarded).toBeGreaterThanOrEqual(250);
    // Other tests' due rows may add to the last batch, never split a batch.
    expect(calls.slice(0, 2)).toEqual([100, 100]);
    expect(calls.every((n) => n <= 100)).toBe(true);
    expect((await filesOf(pool, alNoor.id)).filter((f) => ids.includes(f.id))).toEqual([]);
  });

  it('stops at the time budget and leaves the rest for the next run', async () => {
    const ids = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 30,
      state: 'discarded',
    });
    const slow: FileStoreType = {
      ...store,
      delete: async (keys) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        await store.delete(keys);
      },
    };
    const partial = await sweepFiles(db, slow, { batchSize: 10, budgetMs: 200 });
    const left = (await filesOf(pool, alNoor.id)).filter((f) => ids.includes(f.id));
    expect(partial.discarded).toBeGreaterThan(0);
    expect(left.length).toBeGreaterThan(0);
    expect(left.length).toBeLessThan(30);
    await sweepFiles(db, store, sweepOptions);
    expect((await filesOf(pool, alNoor.id)).filter((f) => ids.includes(f.id))).toEqual([]);
  });

  it('stops between batches when told to', async () => {
    const ids = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 5,
      state: 'discarded',
    });
    const controller = new AbortController();
    controller.abort();
    const result = await sweepFiles(db, store, { ...sweepOptions, signal: controller.signal });
    expect(result).toEqual({ discarded: 0, expired: 0, abandoned: 0 });
    expect((await filesOf(pool, alNoor.id)).filter((f) => ids.includes(f.id))).toHaveLength(5);
    await sweepFiles(db, store, sweepOptions);
  });

  it('keeps every row and its bytes when the store fails, and deletes them on the next run', async () => {
    const ids = await seedWithBytes(alNoor, khalid, { count: 3, state: 'discarded' });
    await expect(sweepFiles(db, failingStore(store, { delete: true }), sweepOptions)).rejects.toThrow('object store unavailable');
    for (const id of ids) {
      expect(await stateOf(alNoor.id, id)).toBe('discarded');
      expect(await objectExists(store, storageKeyOf(alNoor.id, id))).toBe(true);
    }
    await sweepFiles(db, store, sweepOptions);
    for (const id of ids) {
      expect(await stateOf(alNoor.id, id)).toBeUndefined();
      expect(await objectExists(store, storageKeyOf(alNoor.id, id))).toBe(false);
    }
  });

  it('skips rows another transaction holds instead of waiting, and takes them on a later run', async () => {
    const [held, free] = await seedWithBytes(alNoor, khalid, { count: 2, state: 'discarded' });
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select id from files where id = $1 for update', [held]);
      await sweepFiles(db, store, sweepOptions);
      expect(await stateOf(alNoor.id, free ?? '')).toBeUndefined();
      expect(await stateOf(alNoor.id, held ?? '')).toBe('discarded');
      expect(await objectExists(store, storageKeyOf(alNoor.id, held ?? ''))).toBe(true);
    } finally {
      await holder.query('rollback');
      holder.release();
    }
    await sweepFiles(db, store, sweepOptions);
    expect(await stateOf(alNoor.id, held ?? '')).toBeUndefined();
  });

  it('lets two sweeps run at once without deleting a file twice or failing', async () => {
    const ids = await seedWithBytes(alNoor, khalid, { count: 40, state: 'discarded' });
    const results = await Promise.all([sweepFiles(db, store, { ...sweepOptions, batchSize: 7 }), sweepFiles(db, store, { ...sweepOptions, batchSize: 7 })]);
    expect(results.reduce((sum, r) => sum + r.discarded, 0)).toBeGreaterThanOrEqual(40);
    expect((await filesOf(pool, alNoor.id)).filter((f) => ids.includes(f.id))).toEqual([]);
  });

  it('makes an attach that waits on a row the sweep is deleting find no row (sweep first)', async () => {
    const [id] = await seedWithBytes(alNoor, khalid, { count: 1, state: 'pending', ageHours: 25 });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached: () => void = () => {};
    const atStore = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const pausing: FileStoreType = {
      ...store,
      delete: async (keys) => {
        reached();
        await gate;
        await store.delete(keys);
      },
    };
    const sweep = sweepFiles(db, pausing, sweepOptions);
    await atStore;
    // The sweep holds the row lock while it deletes the bytes; the attach queues behind it.
    const attach = refusal(withTx(db, (tx) => attachFiles(tx, alNoor.id, khalid, [id ?? ''])));
    await waitUntilBlockedOn(pool, 'files');
    release();
    await sweep;
    expect((await attach).details).toEqual([{ path: 'fileIds.0', code: 'unknown_file' }]);
  });

  it('skips a row an attach holds (attach first), so a file attached at the last moment is kept', async () => {
    const [id] = await seedWithBytes(alNoor, khalid, {
      count: 1,
      state: 'pending',
      ageHours: 23.99,
    });
    await withTx(db, async (tx) => {
      await attachFiles(tx, alNoor.id, khalid, [id ?? '']);
      // The row is attached but uncommitted: the sweep must neither wait for it nor delete it.
      await sweepFiles(db, store, sweepOptions);
    });
    expect(await stateOf(alNoor.id, id ?? '')).toBe('attached');
    expect(await objectExists(store, storageKeyOf(alNoor.id, id ?? ''))).toBe(true);
  });

  it('does not delete an abandoned upload that finished late and became pending', async () => {
    const [id] = await seedWithBytes(alNoor, khalid, { count: 1, state: 'uploading', ageHours: 2 });
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query("update files set state = 'pending', content_type = 'application/pdf', sha256 = 'x' where id = $1", [id]);
      await sweepFiles(db, store, sweepOptions);
      await holder.query('commit');
    } finally {
      holder.release();
    }
    await sweepFiles(db, store, sweepOptions);
    expect(await stateOf(alNoor.id, id ?? '')).toBe('pending');
    expect(await objectExists(store, storageKeyOf(alNoor.id, id ?? ''))).toBe(true);
  });
});

describe('usage counts what the sweep has not deleted yet (R5.5.18)', () => {
  it('stops counting a pending upload once it has expired and been swept', async () => {
    const [id] = await seedWithBytes(alNoor, khalid, { count: 1, state: 'pending', ageHours: 25 });
    const sum = async () => Number((await pool.query('select coalesce(sum(size_bytes), 0)::float8 as n from files where id = $1', [id])).rows[0].n);
    expect(await sum()).toBe(1000);
    await sweepFiles(db, store, sweepOptions);
    expect(await sum()).toBe(0);
  });
});

describe('the sweep job on the scheduler (4.3 When it runs, Observability)', () => {
  function startSweeps(options: { store?: FileStoreType; logger: Logger; intervalMs: number }) {
    const job = createFileSweepJob({ store: options.store ?? store, settings: sweepOptions });
    return startScheduler({
      jobs: [{ ...job, intervalMs: options.intervalMs }],
      db,
      logger: options.logger,
    });
  }

  it('runs at once, then again after the interval, logs what it deleted, and stops on request', async () => {
    const capture = captureLogs();
    const [first] = await seedWithBytes(alNoor, khalid, { count: 1, state: 'discarded' });
    const schedule = startSweeps({ logger: capture.logger, intervalMs: 150 });
    try {
      await eventually(async () => (await stateOf(alNoor.id, first ?? '')) === undefined, 'the first run');
      const [second] = await seedWithBytes(alNoor, khalid, { count: 1, state: 'discarded' });
      await eventually(async () => (await stateOf(alNoor.id, second ?? '')) === undefined, 'the second run');
    } finally {
      await schedule.stop();
    }
    const logged = capture.lines().filter((line) => line.msg === 'job finished');
    expect(logged.length).toBeGreaterThanOrEqual(2);
    expect(logged[0]).toMatchObject({
      job: 'files.sweep',
      counts: {
        discarded: expect.any(Number),
        expired: expect.any(Number),
        abandoned: expect.any(Number),
      },
    });

    const [third] = await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 1,
      state: 'discarded',
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await stateOf(alNoor.id, third ?? '')).toBe('discarded');
    await sweepFiles(db, store, sweepOptions);
  });

  it('never starts a second run while one is still going', async () => {
    let running = 0;
    let overlapped = false;
    const slow: FileStoreType = {
      ...store,
      delete: async (keys) => {
        running += 1;
        overlapped ||= running > 1;
        await new Promise((resolve) => setTimeout(resolve, 300));
        await store.delete(keys);
        running -= 1;
      },
    };
    await seedFiles(pool, { tenantId: alNoor.id, userId: khalid, count: 1, state: 'discarded' });
    const schedule = startSweeps({ store: slow, logger: captureLogs().logger, intervalMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 700));
    await schedule.stop();
    expect(overlapped).toBe(false);
    await sweepFiles(db, store, sweepOptions);
  });

  it('logs a failed run as an error and keeps going', async () => {
    const capture = captureLogs();
    await seedFiles(pool, { tenantId: alNoor.id, userId: khalid, count: 1, state: 'discarded' });
    const schedule = startSweeps({
      store: failingStore(store, { delete: true }),
      logger: capture.logger,
      intervalMs: 50,
    });
    await eventually(async () => capture.lines().filter((line) => line.msg === 'job failed').length >= 2, 'two failed runs');
    await schedule.stop();
    expect(capture.lines().find((line) => line.msg === 'job failed')).toMatchObject({
      level: 50,
      job: 'files.sweep',
    });
    await sweepFiles(db, store, sweepOptions);
  });

  it('warns when a row is more than an hour past due, which means sweeps are failing', async () => {
    // Pending is due after 24 hours and uploading after 1: both are over an hour late here.
    await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 1,
      state: 'pending',
      ageHours: 26,
    });
    await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 1,
      state: 'uploading',
      ageHours: 3,
    });
    await seedFiles(pool, {
      tenantId: alNoor.id,
      userId: khalid,
      count: 1,
      state: 'pending',
      ageHours: 24.5,
    });
    expect(await countOverdueFiles(db)).toBeGreaterThanOrEqual(2);
    const capture = captureLogs();
    const schedule = startSweeps({ logger: capture.logger, intervalMs: 60_000 });
    await eventually(async () => capture.lines().some((line) => line.msg === 'job finished'), 'a run');
    await schedule.stop();
    const warning = capture.lines().find((line) => String(line.msg).includes('sweeps are failing'));
    expect(warning).toMatchObject({ level: 40, overdue: expect.any(Number) });
    expect(await countOverdueFiles(db)).toBe(0);
  });
});
