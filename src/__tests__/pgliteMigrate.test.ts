/**
 * Tests for the lazy PGlite v0.3 → v0.4 migration path (plan 007).
 *
 * The v3 engine (~13 MB WASM) must be imported ONLY when a leftover v0.3
 * database actually exists, and a dump failure on a present DB must surface a
 * tagged error (not a silent null) so the caller skips version-stamping and
 * retries next launch.
 *
 * The test environment (happy-dom / node) ships no IndexedDB, so we inject a
 * controlled fake `globalThis.indexedDB` per case — this exercises both the
 * `indexedDB.databases()` fast path and the older-Safari open()/onupgradeneeded
 * fallback directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { migrateFromV3, V3MigrationError } from '../lib/db/pglite-migrate';

// Spy that fires whenever the mocked `pglite-v3` module is imported (its factory
// runs lazily, only on the first `await import('pglite-v3')`).
const { pgliteV3ImportSpy } = vi.hoisted(() => ({ pgliteV3ImportSpy: vi.fn() }));

vi.mock('pglite-v3', () => {
  pgliteV3ImportSpy();
  // Models a v3 engine whose dump fails: instantiates, reports 3 tables, then
  // throws on dumpDataDir — exercising migrateFromV3's catch → V3MigrationError.
  class FailingPGlite {
    waitReady = Promise.resolve();
    async query() {
      return { rows: [{ cnt: 3 }] };
    }
    async dumpDataDir(): Promise<Blob> {
      throw new Error('simulated dump failure');
    }
    async close() {}
  }
  return { PGlite: FailingPGlite };
});

/** A fake IDBFactory exposing `databases()` (the modern fast path). */
function idbWithDatabases(names: string[]): IDBFactory {
  return {
    databases: async () => names.map((name) => ({ name })),
  } as unknown as IDBFactory;
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
  pgliteV3ImportSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('migrateFromV3', () => {
  it('resolves null and never imports the v3 engine when no v0.3 DB exists', async () => {
    vi.stubGlobal('indexedDB', idbWithDatabases([]));

    const result = await migrateFromV3();

    expect(result).toBeNull();
    expect(pgliteV3ImportSpy).not.toHaveBeenCalled();
  });

  it('does not leave an empty shell behind when the fallback probes a missing DB', async () => {
    const { idb, deleted } = idbFallback([]); // no v0.3 DB present
    vi.stubGlobal('indexedDB', idb);

    const result = await migrateFromV3();

    expect(result).toBeNull();
    // Both candidate names were probed (creating empty shells) and then deleted.
    expect(deleted).toContain('/pglite/journal-db');
    expect(deleted).toContain('journal-db');
    // Detection alone must not load the v3 engine.
    expect(pgliteV3ImportSpy).not.toHaveBeenCalled();
  });

  it('throws a tagged V3MigrationError when a present v0.3 DB fails to dump', async () => {
    vi.stubGlobal('indexedDB', idbWithDatabases(['journal-db']));

    await expect(migrateFromV3()).rejects.toBeInstanceOf(V3MigrationError);
    // The engine was in fact loaded (DB present), i.e. this is not the null path.
    expect(pgliteV3ImportSpy).toHaveBeenCalledTimes(1);
  });
});
