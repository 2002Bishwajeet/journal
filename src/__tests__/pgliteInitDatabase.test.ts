/**
 * Ordering and lifecycle contract of initDatabase's legacy-migration path
 * (pglite.ts).
 *
 * The dangerous failures are stamping the PGlite version or deleting the legacy
 * database when the data did not actually land in the new data dir, and leaving
 * workers running behind a failed boot. These tests drive initDatabase (via
 * getDatabase) against a fake worker DB and a mocked pglite-migrate, recording
 * the order of the steps that matter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Dump = { sql: string; fromTemplate1: boolean } | null;

const mocks = {
  events: [] as string[],
  workerOptions: [] as Array<Record<string, unknown>>,
  storedVersion: '0.4' as string | null,
  dump: { sql: 'DUMP SQL', fromTemplate1: false } as Dump,
  dumpError: null as Error | null,
  restoreError: null as Error | null,
  schemaError: null as Error | null,
  markerPresent: false,
  skipped: false,
  preserveOk: true,
  skipOk: true,
};

/** Fake PGliteWorker instance: records the steps the migration depends on. */
function fakeDb() {
  const tx = {
    query: async (sql: string) => {
      if (sql.includes('to_regclass')) return { rows: [{ present: mocks.markerPresent }] };
      return { rows: [] };
    },
    exec: async (sql: string) => {
      if (sql === mocks.dump?.sql) {
        mocks.events.push('restore');
        if (mocks.restoreError) throw mocks.restoreError;
      } else if (sql.includes('pglite_legacy_migrated')) {
        mocks.events.push('marker');
      }
      return [];
    },
  };
  return {
    transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback(tx),
    exec: async (sql: string) => {
      if (sql.includes('RESET search_path')) mocks.events.push('reset');
      // initializeSchema's first statement — the seam for a post-worker failure.
      if (sql.includes('schema_meta') && mocks.schemaError) throw mocks.schemaError;
      return [];
    },
    query: async () => ({ rows: [] }),
    close: async () => void mocks.events.push('close'),
  };
}

async function loadDatabaseModule() {
  vi.resetModules();
  vi.doMock('../lib/db/pglite-migrate', () => ({
    dumpLegacyDatabase: async () => {
      mocks.events.push('dump');
      if (mocks.dumpError) throw mocks.dumpError;
      return mocks.dump;
    },
    retireLegacyDatabase: async (_stored: string | null, fromTemplate1 = false) =>
      void mocks.events.push(`retire:${fromTemplate1}`),
    cleanUpLegacyDatabase: async () => void mocks.events.push('cleanup'),
    preserveLegacyDatabase: () => {
      mocks.events.push('preserve');
      return mocks.preserveOk;
    },
    skipLegacyMigration: () => {
      mocks.events.push('skip');
      return mocks.skipOk;
    },
    legacyMigrationSkipped: () => mocks.skipped,
    getStoredPGliteVersion: () => mocks.storedVersion,
    setStoredPGliteVersion: (version: string) => {
      // Mirrors the real helper: the next read sees the new stamp.
      mocks.storedVersion = version;
      mocks.events.push(`stamp:${version}`);
      return true;
    },
  }));
  vi.doMock('@electric-sql/pglite/worker', () => ({
    PGliteWorker: {
      create: async (_worker: unknown, options: Record<string, unknown>) => {
        mocks.workerOptions.push(options);
        return fakeDb();
      },
    },
  }));
  vi.doMock('@electric-sql/pglite/live', () => ({ live: {} }));
  vi.doMock('../lib/bootProgress', () => ({
    reportBootPhase: () => {},
    reportBootError: () => void mocks.events.push('boot-error'),
    clearBootError: () => {},
  }));
  vi.doMock('../lib/homebase', () => ({ MAIN_FOLDER_ID: '06cf9262-4eae-4276-b0d1-8ca3cf5be6f4' }));
  return import('../lib/db/pglite');
}

const stamped = () => mocks.events.some((event) => event.startsWith('stamp'));
const retired = () => mocks.events.some((event) => event.startsWith('retire'));

beforeEach(() => {
  mocks.events = [];
  mocks.workerOptions = [];
  mocks.storedVersion = '0.4';
  mocks.dump = { sql: 'DUMP SQL', fromTemplate1: false };
  mocks.dumpError = null;
  mocks.restoreError = null;
  mocks.schemaError = null;
  mocks.markerPresent = false;
  mocks.skipped = false;
  mocks.preserveOk = true;
  mocks.skipOk = true;
  // pglite.ts constructs a Worker before PGliteWorker.create sees it.
  vi.stubGlobal('Worker', class FakeWorker {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initDatabase legacy migration', () => {
  it('stamps the version and retires the legacy DB only after the restore commits', async () => {
    const { getDatabase } = await loadDatabaseModule();

    await getDatabase();

    expect(mocks.events).toContain('restore');
    expect(mocks.events.indexOf('restore')).toBeLessThan(mocks.events.indexOf('stamp:0.5'));
    expect(mocks.events.indexOf('stamp:0.5')).toBeLessThan(mocks.events.indexOf('retire:false'));
    // The marker is written inside the same transaction as the restore.
    expect(mocks.events.indexOf('marker')).toBeLessThan(mocks.events.indexOf('stamp:0.5'));
    expect(mocks.events).toContain('reset');
  });

  it('tells the retirement when the dump already carried template1', async () => {
    mocks.dump = { sql: 'DUMP SQL', fromTemplate1: true };
    const { getDatabase } = await loadDatabaseModule();

    await getDatabase();

    // Without this the legacy DB would be kept forever for data just migrated.
    expect(mocks.events).toContain('retire:true');
  });

  it('rejects instead of booting an empty database when the dump fails', async () => {
    mocks.dumpError = new Error('simulated dump failure');
    const { getDatabase } = await loadDatabaseModule();

    await expect(getDatabase()).rejects.toThrow('simulated dump failure');

    expect(mocks.events).toContain('dump');
    expect(stamped()).toBe(false);
    expect(retired()).toBe(false);
    // The failure is published for the boot error screen.
    expect(mocks.events).toContain('boot-error');
  });

  it('rejects instead of booting an empty database when the restore fails', async () => {
    mocks.restoreError = new Error('simulated restore failure');
    const { getDatabase } = await loadDatabaseModule();

    await expect(getDatabase()).rejects.toThrow('simulated restore failure');

    expect(mocks.events).toContain('restore');
    expect(stamped()).toBe(false);
    expect(retired()).toBe(false);
    expect(mocks.events).toContain('boot-error');
  });

  it('boots normally when there is no legacy database to migrate', async () => {
    mocks.dump = null;
    const { getDatabase } = await loadDatabaseModule();

    await expect(getDatabase()).resolves.toBeDefined();

    expect(mocks.events).toContain('stamp:0.5');
    expect(mocks.events).not.toContain('boot-error');
  });

  it('skips a second restore when the marker table is already present', async () => {
    mocks.markerPresent = true;
    const { getDatabase } = await loadDatabaseModule();

    await getDatabase();

    // The dump is never replayed over data this dir already has...
    expect(mocks.events).not.toContain('restore');
    // ...but the stamp and the legacy cleanup still get finished.
    expect(mocks.events).toContain('stamp:0.5');
    expect(retired()).toBe(true);
  });

  it('opens the restoring launch durably, and normal launches relaxed', async () => {
    const { getDatabase } = await loadDatabaseModule();
    await getDatabase();
    // The launch that restores must not lose the data to an unflushed COMMIT.
    expect(mocks.workerOptions.at(-1)?.relaxedDurability).toBe(false);

    mocks.storedVersion = '0.5';
    const { getDatabase: getAgain } = await loadDatabaseModule();
    await getAgain();
    expect(mocks.workerOptions.at(-1)?.relaxedDurability).toBe(true);
  });

  it('retries the legacy delete on an already-migrated launch', async () => {
    mocks.storedVersion = '0.5';
    const { getDatabase } = await loadDatabaseModule();

    await getDatabase();

    expect(mocks.events).toContain('cleanup');
    expect(mocks.events).not.toContain('dump');
  });
});

describe('failed boots', () => {
  it('caches a failed boot instead of re-running the migration for every caller', async () => {
    mocks.dumpError = new Error('simulated dump failure');
    const { getDatabase, retryDatabase } = await loadDatabaseModule();

    await expect(getDatabase()).rejects.toThrow('simulated dump failure');
    await expect(getDatabase()).rejects.toThrow('simulated dump failure');
    await expect(getDatabase()).rejects.toThrow('simulated dump failure');

    // Query hooks, live subscriptions and tab hooks all call getDatabase(); only
    // the first attempt may load the ~10 MB legacy engine.
    expect(mocks.events.filter((e) => e === 'dump')).toHaveLength(1);

    // Retry is the one caller that starts a new attempt.
    await expect(retryDatabase()).rejects.toThrow('simulated dump failure');
    expect(mocks.events.filter((e) => e === 'dump')).toHaveLength(2);
  });

  it('closes the worker when schema setup fails, instead of leaking it', async () => {
    mocks.dump = null;
    mocks.schemaError = new Error('simulated schema failure');
    const { getDatabase } = await loadDatabaseModule();

    await expect(getDatabase()).rejects.toThrow('simulated schema failure');

    // A live worker would keep the leader lock and fight the next attempt.
    expect(mocks.events).toContain('close');
  });

  it('closes the previous database before a retry opens another worker', async () => {
    mocks.storedVersion = '0.5';
    mocks.dump = null;
    const { getDatabase, retryDatabase } = await loadDatabaseModule();
    await getDatabase();
    expect(mocks.events).not.toContain('close');

    await retryDatabase();

    expect(mocks.events).toContain('close');
  });

  it('shares one attempt between concurrent retries', async () => {
    mocks.dumpError = new Error('simulated dump failure');
    const { getDatabase, retryDatabase } = await loadDatabaseModule();
    await expect(getDatabase()).rejects.toThrow('simulated dump failure');

    const results = await Promise.allSettled([retryDatabase(), retryDatabase()]);

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    // One initial attempt plus one shared retry, not one per caller.
    expect(mocks.events.filter((e) => e === 'dump')).toHaveLength(2);
  });
});

describe('opting out of the legacy data', () => {
  it('records the choice and boots empty without stamping the version', async () => {
    mocks.dumpError = new Error('corrupt legacy database');
    const { getDatabase, bootWithoutLegacyData } = await loadDatabaseModule();
    await expect(getDatabase()).rejects.toThrow('corrupt legacy database');
    mocks.skipped = true; // the skip flag the real helper would have written

    await expect(bootWithoutLegacyData()).resolves.toBeDefined();

    expect(mocks.events).toContain('preserve');
    expect(mocks.events).toContain('skip');
    // Stamping would make this look like a finished migration and let the
    // cleanup delete the data we just promised to keep.
    expect(stamped()).toBe(false);
    expect(retired()).toBe(false);
  });

  it('changes nothing when the choice cannot be persisted', async () => {
    mocks.dumpError = new Error('corrupt legacy database');
    mocks.preserveOk = false;
    const { getDatabase, bootWithoutLegacyData } = await loadDatabaseModule();
    await expect(getDatabase()).rejects.toThrow('corrupt legacy database');

    await expect(bootWithoutLegacyData()).rejects.toThrow(/storage settings/);

    // Acting on a choice we can't remember would strand the data next launch.
    expect(mocks.events).not.toContain('skip');
    expect(stamped()).toBe(false);
  });

  it('boots straight past the migration once the skip is recorded', async () => {
    mocks.skipped = true;
    const { getDatabase } = await loadDatabaseModule();

    await expect(getDatabase()).resolves.toBeDefined();

    // No engine work, and the stamp stays at '0.4' so the legacy data is still
    // recognisably unmigrated.
    expect(mocks.events).not.toContain('dump');
    expect(stamped()).toBe(false);
  });
});
