/**
 * Ordering contract of initDatabase's legacy-migration path (pglite.ts).
 *
 * The dangerous failure is stamping the PGlite version or deleting the legacy
 * database when the data did not actually land in the new data dir. These tests
 * drive initDatabase (via getDatabase) against a fake worker DB and a mocked
 * pglite-migrate, recording the order of the steps that matter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = {
  events: [] as string[],
  workerOptions: [] as Array<Record<string, unknown>>,
  storedVersion: '0.4' as string | null,
  dump: 'DUMP SQL' as string | null,
  dumpError: null as Error | null,
  restoreError: null as Error | null,
  markerPresent: false,
};

/** Fake PGliteWorker instance: records the steps the migration depends on. */
function fakeDb() {
  const tx = {
    query: async (sql: string) => {
      if (sql.includes('to_regclass')) return { rows: [{ present: mocks.markerPresent }] };
      return { rows: [] };
    },
    exec: async (sql: string) => {
      if (sql === mocks.dump) {
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
      return [];
    },
    query: async () => ({ rows: [] }),
    close: async () => {},
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
    retireLegacyDatabase: async () => void mocks.events.push('retire'),
    cleanUpLegacyDatabase: async () => void mocks.events.push('cleanup'),
    preserveLegacyDatabase: () => void mocks.events.push('preserve'),
    getStoredPGliteVersion: () => mocks.storedVersion,
    setStoredPGliteVersion: (version: string) => {
      // Mirrors the real helper: the next read sees the new stamp.
      mocks.storedVersion = version;
      mocks.events.push(`stamp:${version}`);
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

beforeEach(() => {
  mocks.events = [];
  mocks.workerOptions = [];
  mocks.storedVersion = '0.4';
  mocks.dump = 'DUMP SQL';
  mocks.dumpError = null;
  mocks.restoreError = null;
  mocks.markerPresent = false;
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
    expect(mocks.events.indexOf('stamp:0.5')).toBeLessThan(mocks.events.indexOf('retire'));
    // The marker is written inside the same transaction as the restore.
    expect(mocks.events.indexOf('marker')).toBeLessThan(mocks.events.indexOf('stamp:0.5'));
    expect(mocks.events).toContain('reset');
  });

  it('rejects instead of booting an empty database when the dump fails', async () => {
    mocks.dumpError = new Error('simulated dump failure');
    const { getDatabase } = await loadDatabaseModule();

    await expect(getDatabase()).rejects.toThrow('simulated dump failure');

    expect(mocks.events).toContain('dump');
    expect(mocks.events.some((e) => e.startsWith('stamp'))).toBe(false);
    expect(mocks.events).not.toContain('retire');
    // The failure is published for the boot error screen.
    expect(mocks.events).toContain('boot-error');
  });

  it('rejects instead of booting an empty database when the restore fails', async () => {
    mocks.restoreError = new Error('simulated restore failure');
    const { getDatabase } = await loadDatabaseModule();

    await expect(getDatabase()).rejects.toThrow('simulated restore failure');

    expect(mocks.events).toContain('restore');
    expect(mocks.events.some((e) => e.startsWith('stamp'))).toBe(false);
    expect(mocks.events).not.toContain('retire');
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
    expect(mocks.events).toContain('retire');
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

  it('opens the empty dir and keeps the legacy database when the user opts out', async () => {
    mocks.dumpError = new Error('corrupt legacy database');
    const { getDatabase, bootWithoutLegacyData } = await loadDatabaseModule();
    await expect(getDatabase()).rejects.toThrow('corrupt legacy database');

    await expect(bootWithoutLegacyData()).resolves.toBeDefined();

    // Kept, never deleted: the data has to stay recoverable.
    expect(mocks.events).toContain('preserve');
    expect(mocks.events).toContain('stamp:0.5');
    expect(mocks.events).not.toContain('retire');
  });

  it('retries the legacy delete on an already-migrated launch', async () => {
    mocks.storedVersion = '0.5';
    const { getDatabase } = await loadDatabaseModule();

    await getDatabase();

    expect(mocks.events).toContain('cleanup');
    expect(mocks.events).not.toContain('dump');
  });
});
