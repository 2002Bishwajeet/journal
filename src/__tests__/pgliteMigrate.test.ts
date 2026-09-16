/**
 * Tests for the lazy legacy PGlite → v0.5 migration path (plan 007, PG18 bump).
 *
 * The legacy engines (~10 MB WASM each) and pg_dump must be imported ONLY when a
 * leftover legacy database actually exists, the right engine must be picked for
 * the stored version, and a dump failure on a present DB must surface a tagged
 * error (not a silent null) so the caller skips version-stamping and retries
 * next launch.
 *
 * The test environment (happy-dom / node) ships no IndexedDB, so we inject a
 * controlled fake `globalThis.indexedDB` per case — this exercises both the
 * `indexedDB.databases()` fast path and the older-Safari open()/onupgradeneeded
 * fallback directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import spies fire whenever a mocked module is imported, plus knobs per case.
const mocks = {
  v3Import: vi.fn(),
  v4Import: vi.fn(),
  pgDumpImport: vi.fn(),
  v4Create: vi.fn(),
  currentImport: vi.fn(),
  currentCreate: vi.fn(),
  pgDump: vi.fn(),
  v3DumpFails: false,
  v4CreateError: null as Error | null,
  // Public table counts per database: the migration dumps `postgres`, while
  // `template1` is where v0.3 kept its tables.
  tableCounts: { postgres: 3, template1: 0 } as Record<string, number>,
};

/**
 * Fresh module graph per test: vi.resetModules + vi.doMock re-register the mock
 * factories, so each factory (and its import spy) runs on the test's first
 * `await import(...)` of that module — and never if the engine isn't imported.
 */
async function loadMigrate() {
  vi.resetModules();
  vi.doMock('pglite-v3', () => {
    mocks.v3Import();
    class FakePGliteV3 {
      waitReady = Promise.resolve();
      async dumpDataDir(): Promise<Blob> {
        if (mocks.v3DumpFails) throw new Error('simulated dump failure');
        return new Blob(['v3-datadir']);
      }
      async close() {}
    }
    return { PGlite: FakePGliteV3 };
  });
  vi.doMock('pglite-v4', () => {
    mocks.v4Import();
    class FakePGliteV4 {
      database: string;
      constructor(database = 'postgres') {
        this.database = database;
      }
      static async create(...args: unknown[]) {
        mocks.v4Create(...args);
        if (mocks.v4CreateError) throw mocks.v4CreateError;
        const options = (typeof args[0] === 'string' ? args[1] : args[0]) as { database?: string } | undefined;
        return new FakePGliteV4(options?.database);
      }
      async query() {
        return { rows: [{ cnt: mocks.tableCounts[this.database] ?? 0 }] };
      }
      async close() {}
    }
    return { PGlite: FakePGliteV4 };
  });
  vi.doMock('pglite-v4/contrib/pg_trgm', () => ({ pg_trgm: { name: 'pg_trgm-v4' } }));
  vi.doMock('@electric-sql/pglite', () => {
    mocks.currentImport();
    class FakePGlite {
      database: string;
      constructor(database = 'postgres') {
        this.database = database;
      }
      static async create(...args: unknown[]) {
        mocks.currentCreate(...args);
        const options = (typeof args[0] === 'string' ? args[1] : args[0]) as { database?: string } | undefined;
        return new FakePGlite(options?.database);
      }
      async query() {
        return { rows: [{ cnt: mocks.tableCounts[this.database] ?? 0 }] };
      }
      async close() {}
    }
    return { PGlite: FakePGlite };
  });
  vi.doMock('@electric-sql/pglite/contrib/pg_trgm', () => ({ pg_trgm: { name: 'pg_trgm-current' } }));
  vi.doMock('@electric-sql/pglite-tools/pg_dump', () => {
    mocks.pgDumpImport();
    return { pgDump: mocks.pgDump };
  });
  return import('../lib/db/pglite-migrate');
}

/** A fake IDBFactory exposing `databases()` (the modern fast path). */
function idbWithDatabases(names: string[]) {
  const deleted: string[] = [];
  const idb = {
    databases: async () => names.map((name) => ({ name })),
    deleteDatabase(name: string) {
      deleted.push(name);
      const req: { onsuccess: (() => void) | null; onerror: (() => void) | null } = {
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
  return { idb: idb as unknown as IDBFactory, deleted };
}

/** localStorage stand-in: the node test env has none, and retirement uses it. */
function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

/**
 * A fake IDBFactory WITHOUT `databases()` (older Safari), forcing the
 * open()/onupgradeneeded probe. `existing` lists DB names that already exist;
 * any other name triggers onupgradeneeded (a freshly created empty shell) and
 * should be deleted by the probe. Records every deleteDatabase() call.
 */
function idbFallback(existing: string[] = []) {
  const deleted: string[] = [];
  const present = new Set(existing);
  const idb = {
    open(name: string) {
      const req: {
        result: { close: () => void };
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
      } = { result: { close: () => {} }, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (!present.has(name)) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    deleteDatabase(name: string) {
      deleted.push(name);
      present.delete(name);
      const req: { onsuccess: (() => void) | null; onerror: (() => void) | null } = {
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
  return { idb: idb as unknown as IDBFactory, deleted };
}

beforeEach(() => {
  mocks.v3Import.mockClear();
  mocks.v4Import.mockClear();
  mocks.pgDumpImport.mockClear();
  mocks.v4Create.mockClear();
  mocks.currentImport.mockClear();
  mocks.currentCreate.mockClear();
  mocks.pgDump.mockReset();
  mocks.pgDump.mockResolvedValue(new Blob(['-- dump sql']));
  mocks.v3DumpFails = false;
  mocks.v4CreateError = null;
  mocks.tableCounts = { postgres: 3, template1: 0 };
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function expectNoEngineImported() {
  expect(mocks.v3Import).not.toHaveBeenCalled();
  expect(mocks.v4Import).not.toHaveBeenCalled();
  expect(mocks.pgDumpImport).not.toHaveBeenCalled();
  expect(mocks.currentImport).not.toHaveBeenCalled();
}

describe('dumpLegacyDatabase', () => {
  it('resolves null and never imports an engine when no legacy DB exists', async () => {
    const { dumpLegacyDatabase } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases([]).idb);

    expect(await dumpLegacyDatabase(null)).toBeNull();
    expectNoEngineImported();
  });

  it('does not leave an empty shell behind when the fallback probes a missing DB', async () => {
    const { dumpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbFallback([]); // no legacy DB present
    vi.stubGlobal('indexedDB', idb);

    const result = await dumpLegacyDatabase(null);

    expect(result).toBeNull();
    // Both candidate names were probed (creating empty shells) and then deleted.
    expect(deleted).toContain('/pglite/journal-db');
    expect(deleted).toContain('journal-db');
    // Detection alone must not load any engine.
    expectNoEngineImported();
  });

  it('resolves null without importing an engine for a stored 0.4 version with no DB', async () => {
    const { dumpLegacyDatabase } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases([]).idb);

    expect(await dumpLegacyDatabase('0.4')).toBeNull();
    expectNoEngineImported();
  });

  it('dumps a 0.4 database with the v0.4 engine (not v0.3) and returns the SQL', async () => {
    const { dumpLegacyDatabase, PG_DUMP_ARGS } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases(['/pglite/journal-db']).idb);

    const result = await dumpLegacyDatabase('0.4');

    expect(result).toBe('-- dump sql');
    expect(mocks.v3Import).not.toHaveBeenCalled();
    expect(mocks.v4Create).toHaveBeenCalledWith('idb://journal-db', {
      extensions: { pg_trgm: { name: 'pg_trgm-v4' } },
    });
    expect(mocks.pgDump).toHaveBeenCalledWith(expect.objectContaining({ args: PG_DUMP_ARGS }));
  });

  it('dumps a v0.3 database through an in-memory v0.4 engine opened on template1', async () => {
    const { dumpLegacyDatabase } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases(['/pglite/journal-db']).idb);
    mocks.tableCounts = { postgres: 0, template1: 3 };

    const result = await dumpLegacyDatabase(null);

    expect(result).toBe('-- dump sql');
    expect(mocks.v3Import).toHaveBeenCalledTimes(1);
    // v0.3 stored user tables in template1; the v0.4 default is `postgres`.
    expect(mocks.v4Create).toHaveBeenCalledWith(
      expect.objectContaining({ loadDataDir: expect.any(Blob), database: 'template1' }),
    );
  });

  it('deletes an empty legacy database instead of leaving it behind', async () => {
    const { dumpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    mocks.tableCounts = { postgres: 0, template1: 0 };

    expect(await dumpLegacyDatabase('0.4')).toBeNull();
    expect(mocks.pgDump).not.toHaveBeenCalled();
    expect(deleted).toContain('/pglite/journal-db');
  });

  it('throws a tagged LegacyMigrationError when a present v0.3 DB fails to dump', async () => {
    const { dumpLegacyDatabase, LegacyMigrationError } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases(['journal-db']).idb);
    mocks.v3DumpFails = true;

    await expect(dumpLegacyDatabase(null)).rejects.toBeInstanceOf(LegacyMigrationError);
    // The engine was in fact loaded (DB present), i.e. this is not the null path.
    expect(mocks.v3Import).toHaveBeenCalledTimes(1);
  });

  it('falls back to the current engine when the v0.4 engine refuses a Postgres 18 dir', async () => {
    const { dumpLegacyDatabase } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases(['/pglite/journal-db']).idb);
    mocks.v4CreateError = new Error('PGlite failed to initialize properly');

    const result = await dumpLegacyDatabase('0.4');

    expect(result).toBe('-- dump sql');
    expect(mocks.currentCreate).toHaveBeenCalledWith('idb://journal-db', {
      extensions: { pg_trgm: { name: 'pg_trgm-current' } },
    });
  });

  it('does not fall back to the current engine on other v0.4 open errors', async () => {
    const { dumpLegacyDatabase, LegacyMigrationError } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases(['/pglite/journal-db']).idb);
    mocks.v4CreateError = new Error('simulated storage failure');

    await expect(dumpLegacyDatabase('0.4')).rejects.toBeInstanceOf(LegacyMigrationError);
    expect(mocks.currentImport).not.toHaveBeenCalled();
  });

  it('dumps template1 when postgres is empty but v0.3-era tables are stranded there', async () => {
    const { dumpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    // The shipped 0.3→0.4 migration left this user's tables in template1.
    mocks.tableCounts = { postgres: 0, template1: 2 };

    const result = await dumpLegacyDatabase('0.4');

    expect(result).toBe('-- dump sql');
    expect(mocks.v4Create).toHaveBeenCalledWith('idb://journal-db', expect.objectContaining({ database: 'template1' }));
    // Their only copy must survive until the restore has committed.
    expect(deleted).toEqual([]);
  });

  it('deletes the legacy database after recovering its template1 data', async () => {
    const { dumpLegacyDatabase, retireLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    mocks.tableCounts = { postgres: 0, template1: 2 };

    expect(await dumpLegacyDatabase('0.4')).toBe('-- dump sql');
    // Stands in for the restore committing in pglite.ts.
    await retireLegacyDatabase('0.4');

    // template1 is no longer an orphan — that data has just been migrated — so
    // keeping the database would pin it (and the cleanup) forever.
    expect(deleted).toContain('/pglite/journal-db');
  });

  it('records a recheck instead of pinning the database when the template1 check fails', async () => {
    const { retireLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    const store = stubLocalStorage();
    mocks.v4CreateError = new Error('simulated storage failure');

    await retireLegacyDatabase('0.4');

    expect(deleted).toEqual([]);
    // 'recheck', not 'kept': one transient failure must not pin it forever.
    expect(store.get('journal-pglite-legacy-kept')).toBe('recheck');
  });

  it('rechecks template1 on a later launch and deletes once it is empty', async () => {
    const { cleanUpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    stubLocalStorage({ 'journal-pglite-legacy-kept': 'recheck' });

    await cleanUpLegacyDatabase();

    expect(deleted).toContain('/pglite/journal-db');
  });

  it('promotes a recheck to a permanent keep when template1 does hold tables', async () => {
    const { cleanUpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    const store = stubLocalStorage({ 'journal-pglite-legacy-kept': 'recheck' });
    mocks.tableCounts = { postgres: 3, template1: 2 };

    await cleanUpLegacyDatabase();

    expect(deleted).toEqual([]);
    expect(store.get('journal-pglite-legacy-kept')).toBe('kept');
  });

  it('survives a localStorage that refuses writes', async () => {
    const { retireLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    });
    mocks.tableCounts = { postgres: 3, template1: 2 };

    // Must not throw: this runs before the version stamp, so an error here
    // would fail the boot on every launch.
    await expect(retireLegacyDatabase('0.4')).resolves.toBeUndefined();
    expect(deleted).toEqual([]);
  });

  it('keeps the legacy database when template1 still holds v0.3-era tables', async () => {
    const { retireLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    const store = stubLocalStorage();
    mocks.tableCounts = { postgres: 3, template1: 2 };

    await retireLegacyDatabase('0.4');

    expect(deleted).toEqual([]);
    expect(store.get('journal-pglite-legacy-kept')).toBe('kept');
  });

  it('deletes the legacy database once template1 is empty', async () => {
    const { retireLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);

    await retireLegacyDatabase('0.4');

    expect(deleted).toContain('/pglite/journal-db');
  });

  it('cleans up a legacy database left behind by an earlier migration', async () => {
    const { cleanUpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);

    await cleanUpLegacyDatabase();

    expect(deleted).toContain('/pglite/journal-db');
    // Deleting by name needs no engine.
    expectNoEngineImported();
  });

  it('leaves a deliberately kept legacy database alone during cleanup', async () => {
    const { cleanUpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    stubLocalStorage({ 'journal-pglite-legacy-kept': 'kept' });

    await cleanUpLegacyDatabase();

    expect(deleted).toEqual([]);
  });

  it('throws a tagged LegacyMigrationError when pg_dump fails on a present 0.4 DB', async () => {
    const { dumpLegacyDatabase, LegacyMigrationError } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases(['/pglite/journal-db']).idb);
    mocks.pgDump.mockRejectedValue(new Error('simulated pg_dump failure'));

    await expect(dumpLegacyDatabase('0.4')).rejects.toBeInstanceOf(LegacyMigrationError);
  });
});
