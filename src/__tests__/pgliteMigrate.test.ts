/**
 * Tests for the lazy legacy PGlite → v0.5 migration path (plan 007, PG18 bump).
 *
 * The legacy engines (~10 MB WASM each) and pg_dump must be imported ONLY when a
 * leftover legacy database actually exists, the right engine and database must
 * be picked, and a dump failure on a present DB must surface a tagged error (not
 * a silent null) so the caller skips version-stamping and retries next launch.
 *
 * The fakes below answer the three probes the migration makes — table count,
 * relation existence, row count — because "does this database hold anything"
 * has to be decided by ROWS: every '0.4' user has the app's empty schema in
 * `postgres`, whether or not their data was left behind in template1.
 *
 * The test environment (node) ships no IndexedDB or localStorage, so each case
 * injects controlled fakes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import spies fire whenever a mocked module is imported, plus knobs per case.
const mocks = {
  v4Import: vi.fn(),
  pgDumpImport: vi.fn(),
  v4Create: vi.fn(),
  currentImport: vi.fn(),
  currentCreate: vi.fn(),
  pgDump: vi.fn(),
  v4CreateError: null as Error | null,
  // Per database: public tables, rows in the app's data tables, and whether
  // those data tables exist at all (a v0.3-era schema may not have them).
  tableCounts: { postgres: 3, template1: 0 } as Record<string, number>,
  rowCounts: { postgres: 5, template1: 0 } as Record<string, number>,
  relationsPresent: { postgres: true, template1: true } as Record<string, boolean>,
};

/** Answers the migration's probes for a given database. */
function fakeQuery(database: string, sql: string) {
  if (sql.includes('information_schema.tables')) {
    return { rows: [{ cnt: mocks.tableCounts[database] ?? 0 }] };
  }
  if (sql.includes('to_regclass')) {
    return { rows: [{ present: mocks.relationsPresent[database] ?? false }] };
  }
  if (sql.includes('count(*)')) {
    return { rows: [{ rows: mocks.rowCounts[database] ?? 0 }] };
  }
  return { rows: [] };
}

/**
 * Fresh module graph per test: vi.resetModules + vi.doMock re-register the mock
 * factories, so each factory (and its import spy) runs on the test's first
 * `await import(...)` of that module — and never if the engine isn't imported.
 */
async function loadMigrate() {
  vi.resetModules();
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
      async query(sql: string) {
        return fakeQuery(this.database, sql);
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
      async query(sql: string) {
        return fakeQuery(this.database, sql);
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

/** localStorage stand-in: the node test env has none, and the flags use it. */
function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

/** localStorage that refuses every write (private mode, quota exhausted). */
function stubUnwritableLocalStorage() {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  });
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
  mocks.v4Import.mockClear();
  mocks.pgDumpImport.mockClear();
  mocks.v4Create.mockClear();
  mocks.currentImport.mockClear();
  mocks.currentCreate.mockClear();
  mocks.pgDump.mockReset();
  mocks.pgDump.mockResolvedValue(new Blob(['-- dump sql']));
  mocks.v4CreateError = null;
  // Default: an ordinary 0.4 user with notes in `postgres`.
  mocks.tableCounts = { postgres: 3, template1: 0 };
  mocks.rowCounts = { postgres: 5, template1: 0 };
  mocks.relationsPresent = { postgres: true, template1: true };
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function expectNoEngineImported() {
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

  it('dumps postgres for an ordinary 0.4 user, never touching template1', async () => {
    const { dumpLegacyDatabase, PG_DUMP_ARGS } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases(['/pglite/journal-db']).idb);

    const result = await dumpLegacyDatabase('0.4');

    expect(result).toEqual({ sql: '-- dump sql', fromTemplate1: false });
    expect(mocks.v4Create).toHaveBeenCalledWith('idb://journal-db', {
      extensions: { pg_trgm: { name: 'pg_trgm-v4' } },
    });
    // postgres has the data, so the template1 detour never happens.
    expect(mocks.v4Create).not.toHaveBeenCalledWith(
      'idb://journal-db',
      expect.objectContaining({ database: 'template1' }),
    );
    expect(mocks.pgDump).toHaveBeenCalledWith(expect.objectContaining({ args: PG_DUMP_ARGS }));
  });

  it('dumps template1 for a 0.4 user whose schema is in postgres but data is not', async () => {
    const { dumpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    // The field state this migration exists for: the shipped 0.4 build ran
    // initializeSchema against postgres (4 empty tables) while the v0.3 data
    // stayed in template1. A table-count check would call postgres "populated"
    // and hand back an empty dump.
    mocks.tableCounts = { postgres: 4, template1: 3 };
    mocks.rowCounts = { postgres: 0, template1: 7 };

    const result = await dumpLegacyDatabase('0.4');

    expect(result).toEqual({ sql: '-- dump sql', fromTemplate1: true });
    expect(mocks.v4Create).toHaveBeenCalledWith(
      'idb://journal-db',
      expect.objectContaining({ database: 'template1' }),
    );
    // Their only copy must survive until the restore has committed.
    expect(deleted).toEqual([]);
  });

  it('keeps postgres when neither database holds notes but postgres has content', async () => {
    const { dumpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    // Folders or app_state only: no notes anywhere, but postgres isn't empty.
    mocks.tableCounts = { postgres: 4, template1: 0 };
    mocks.rowCounts = { postgres: 0, template1: 0 };

    const result = await dumpLegacyDatabase('0.4');

    expect(result).toEqual({ sql: '-- dump sql', fromTemplate1: false });
    expect(deleted).toEqual([]);
  });

  it('dumps a v0.3 data dir with the v0.4 engine opened on template1', async () => {
    const { dumpLegacyDatabase } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases(['/pglite/journal-db']).idb);
    // A v0.3 schema predates the app's current data tables.
    mocks.tableCounts = { postgres: 0, template1: 3 };
    mocks.relationsPresent = { postgres: false, template1: false };

    const result = await dumpLegacyDatabase(null);

    expect(result).toEqual({ sql: '-- dump sql', fromTemplate1: true });
    // Both are Postgres 17, so the dir is opened in place — no v0.3 engine and
    // no datadir tarball round trip. v0.3 stored user tables in template1,
    // where the v0.4 default is `postgres`.
    expect(mocks.v4Create).toHaveBeenCalledWith(
      'idb://journal-db',
      expect.objectContaining({ database: 'template1' }),
    );
  });

  it('deletes an empty legacy database instead of leaving it behind', async () => {
    const { dumpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    mocks.tableCounts = { postgres: 0, template1: 0 };
    mocks.rowCounts = { postgres: 0, template1: 0 };

    expect(await dumpLegacyDatabase('0.4')).toBeNull();
    expect(mocks.pgDump).not.toHaveBeenCalled();
    expect(deleted).toContain('/pglite/journal-db');
  });

  it('throws a tagged LegacyMigrationError when a present v0.3 DB fails to dump', async () => {
    const { dumpLegacyDatabase, LegacyMigrationError } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases(['journal-db']).idb);
    mocks.tableCounts = { postgres: 0, template1: 3 };
    mocks.relationsPresent = { postgres: false, template1: false };
    mocks.pgDump.mockRejectedValue(new Error('simulated dump failure'));

    await expect(dumpLegacyDatabase(null)).rejects.toBeInstanceOf(LegacyMigrationError);
    // The engine was in fact loaded (DB present), i.e. this is not the null path.
    expect(mocks.v4Import).toHaveBeenCalledTimes(1);
  });

  it('throws a tagged LegacyMigrationError when pg_dump fails on a present 0.4 DB', async () => {
    const { dumpLegacyDatabase, LegacyMigrationError } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases(['/pglite/journal-db']).idb);
    mocks.pgDump.mockRejectedValue(new Error('simulated pg_dump failure'));

    await expect(dumpLegacyDatabase('0.4')).rejects.toBeInstanceOf(LegacyMigrationError);
  });

  it('falls back to the current engine when the v0.4 engine refuses a Postgres 18 dir', async () => {
    const { dumpLegacyDatabase } = await loadMigrate();
    vi.stubGlobal('indexedDB', idbWithDatabases(['/pglite/journal-db']).idb);
    mocks.v4CreateError = new Error('PGlite failed to initialize properly');

    const result = await dumpLegacyDatabase('0.4');

    expect(result).toEqual({ sql: '-- dump sql', fromTemplate1: false });
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
});

describe('retireLegacyDatabase', () => {
  it('is not authorised by an earlier template1 dump it was not told about', async () => {
    const { dumpLegacyDatabase, retireLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    mocks.tableCounts = { postgres: 4, template1: 3 };
    mocks.rowCounts = { postgres: 0, template1: 7 };

    const dump = await dumpLegacyDatabase('0.4');
    expect(dump?.fromTemplate1).toBe(true);

    // The fact travels with the dump rather than in module state, so a caller
    // that doesn't pass it still gets the template1 check — and keeps the data.
    await retireLegacyDatabase('0.4');

    expect(deleted).toEqual([]);
  });

  it('deletes when told the dump already carried template1', async () => {
    const { retireLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    mocks.tableCounts = { postgres: 4, template1: 3 };

    // That data has just been migrated, so template1 is no longer worth keeping.
    await retireLegacyDatabase('0.4', true);

    expect(deleted).toContain('/pglite/journal-db');
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

  it('keeps the database when the template1 check itself fails', async () => {
    const { retireLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    mocks.v4CreateError = new Error('simulated storage failure');

    await retireLegacyDatabase('0.4');

    expect(deleted).toEqual([]);
  });
});

describe('cleanUpLegacyDatabase', () => {
  it('checks template1 before deleting, even with no keep flag recorded', async () => {
    const { cleanUpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    const store = stubLocalStorage(); // nothing recorded
    mocks.tableCounts = { postgres: 3, template1: 2 };

    await cleanUpLegacyDatabase();

    // An absent flag is not permission to delete — the data decides.
    expect(deleted).toEqual([]);
    expect(store.get('journal-pglite-legacy-kept')).toBe('kept');
  });

  it('deletes a leftover database once template1 is confirmed empty', async () => {
    const { cleanUpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);

    await cleanUpLegacyDatabase();

    expect(deleted).toContain('/pglite/journal-db');
  });

  it('leaves a deliberately kept legacy database alone, loading no engine', async () => {
    const { cleanUpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    stubLocalStorage({ 'journal-pglite-legacy-kept': 'kept' });

    await cleanUpLegacyDatabase();

    expect(deleted).toEqual([]);
    expectNoEngineImported();
  });

  it('still refuses to delete on the next launch when the keep could not be written', async () => {
    const { retireLegacyDatabase, cleanUpLegacyDatabase } = await loadMigrate();
    const { idb, deleted } = idbWithDatabases(['/pglite/journal-db']);
    vi.stubGlobal('indexedDB', idb);
    stubUnwritableLocalStorage();
    mocks.tableCounts = { postgres: 3, template1: 2 };

    // The keep is decided but cannot be persisted...
    await expect(retireLegacyDatabase('0.4')).resolves.toBeUndefined();
    expect(deleted).toEqual([]);

    // ...so the next launch sees no flag at all. It must still not delete.
    await cleanUpLegacyDatabase();
    expect(deleted).toEqual([]);
  });
});

describe('storage flags', () => {
  it('reports a failed keep or skip instead of pretending it stuck', async () => {
    const { preserveLegacyDatabase, skipLegacyMigration } = await loadMigrate();
    stubUnwritableLocalStorage();

    expect(preserveLegacyDatabase()).toBe(false);
    expect(skipLegacyMigration()).toBe(false);
  });

  it('survives a localStorage that throws on every access', async () => {
    const { getStoredPGliteVersion, setStoredPGliteVersion, legacyMigrationSkipped } = await loadMigrate();
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {},
    });

    // Safari private mode would otherwise fail the boot on every launch.
    expect(getStoredPGliteVersion()).toBeNull();
    expect(setStoredPGliteVersion('0.5')).toBe(false);
    expect(legacyMigrationSkipped()).toBe(false);
  });

  it('round-trips the skip flag', async () => {
    const { skipLegacyMigration, legacyMigrationSkipped } = await loadMigrate();
    stubLocalStorage();

    expect(legacyMigrationSkipped()).toBe(false);
    expect(skipLegacyMigration()).toBe(true);
    expect(legacyMigrationSkipped()).toBe(true);
  });
});
