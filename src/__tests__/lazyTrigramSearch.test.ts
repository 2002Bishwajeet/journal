/**
 * Unit tests for ensureTrigramSearch — the lazy pg_trgm initializer that defers
 * the ~1-2s extension load out of app boot to first search. We verify the
 * run-once caching and retry-after-failure contract with a mock db (the SQL
 * itself is covered by the search integration tests).
 *
 * ensureTrigramSearch caches its promise at module scope, so each test imports a
 * fresh module instance via vi.resetModules().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('ensureTrigramSearch', () => {
  it('runs the extension + index setup exactly once across repeated calls', async () => {
    const { ensureTrigramSearch } = await import('@/lib/db/pglite');
    const exec = vi.fn().mockResolvedValue(undefined);
    const db = { exec } as unknown as import('@electric-sql/pglite').PGliteInterface;

    await ensureTrigramSearch(db);
    await ensureTrigramSearch(db);
    await ensureTrigramSearch(db);

    // Extension + both indexes batched into a single exec, run once total.
    expect(exec).toHaveBeenCalledTimes(1);
    const sql = exec.mock.calls[0][0] as string;
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    expect(sql).toContain('idx_search_title_trgm');
    expect(sql).toContain('idx_search_content_trgm');
  });

  it('returns the same in-flight promise to concurrent callers', async () => {
    const { ensureTrigramSearch } = await import('@/lib/db/pglite');
    const exec = vi.fn().mockResolvedValue(undefined);
    const db = { exec } as unknown as import('@electric-sql/pglite').PGliteInterface;

    await Promise.all([ensureTrigramSearch(db), ensureTrigramSearch(db)]);

    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('clears the cache on failure so the next call retries', async () => {
    const { ensureTrigramSearch } = await import('@/lib/db/pglite');
    const exec = vi
      .fn()
      .mockRejectedValueOnce(new Error('extension unavailable')) // first attempt fails
      .mockResolvedValue(undefined); // retry succeeds
    const db = { exec } as unknown as import('@electric-sql/pglite').PGliteInterface;

    await expect(ensureTrigramSearch(db)).rejects.toThrow('extension unavailable');
    await ensureTrigramSearch(db); // should retry rather than stay wedged

    // 1 failed exec + 1 on the successful retry.
    expect(exec).toHaveBeenCalledTimes(2);
  });
});

describe('advancedSearch before the trigram indexes exist (#1225)', () => {
  it('returns full-text results from the first query without awaiting ensureTrigramSearch', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { initializeSchema } = await import('@/lib/db/schema');
    const db = new PGlite();
    await initializeSchema(db);
    // The index build never finishes: a query that awaited it would hang.
    const ensureTrigramSearch = vi.fn(() => new Promise<void>(() => {}));
    vi.doMock('@/lib/db/pglite', () => ({ getDatabase: async () => db, ensureTrigramSearch }));
    try {
      const { upsertSearchIndex, advancedSearch } = await import('@/lib/db/queries');
      const now = new Date().toISOString();
      for (let i = 0; i < 10; i++) {
        await upsertSearchIndex({
          docId: `50000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
          title: `Kiwi ${i}`,
          plainTextContent: 'kiwi',
          metadata: { title: `Kiwi ${i}`, folderId: 'main', timestamps: { created: now, modified: now }, excludeFromAI: false },
        });
      }

      expect(await advancedSearch('kiwi')).toHaveLength(10);
      expect(ensureTrigramSearch).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('@/lib/db/pglite');
      await db.close();
    }
  });

  it('returns the full-text results when the trigram stages fail', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { initializeSchema } = await import('@/lib/db/schema');
    const db = new PGlite();
    await initializeSchema(db);
    const ensureTrigramSearch = vi.fn().mockRejectedValue(new Error('pg_trgm unavailable'));
    vi.doMock('@/lib/db/pglite', () => ({ getDatabase: async () => db, ensureTrigramSearch }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { upsertSearchIndex, advancedSearch } = await import('@/lib/db/queries');
      const now = new Date().toISOString();
      await upsertSearchIndex({
        docId: '50000000-0000-0000-0000-000000000100',
        title: 'Fruit',
        plainTextContent: 'kiwi',
        metadata: { title: 'Fruit', folderId: 'main', timestamps: { created: now, modified: now }, excludeFromAI: false },
      });

      const results = await advancedSearch('kiwi');

      expect(ensureTrigramSearch).toHaveBeenCalled();
      expect(results.map((r) => r.docId)).toEqual(['50000000-0000-0000-0000-000000000100']);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      vi.doUnmock('@/lib/db/pglite');
      await db.close();
    }
  });
});
