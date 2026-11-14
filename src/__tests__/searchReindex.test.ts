/**
 * #1229: the background rebuild of search vectors written before journal_search_vector,
 * on the real schema. It works in batches, can stop at any point and continue, and
 * touches nothing but the vector.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
const live = vi.hoisted(() => ({ resume: vi.fn(), suspend: vi.fn() }));
vi.mock('@/hooks/useLiveQuery', () => ({ suspendLiveQueries: live.suspend }));
import { setTestDb } from './pgliteMock';
import { REINDEX_BATCH_SIZE, reindexSearchBatch, runSearchReindex } from '@/lib/db/searchReindex';
import { advancedSearch } from '@/lib/db/queries';

const NOTES = 2000;

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => {
    await resetTestDatabase();
    live.suspend.mockReset().mockReturnValue(live.resume);
    live.resume.mockReset();
});

/** NOTES synced notes as the app wrote them before #1229: english config, body at B, version 1. */
async function seedVersion1Notes() {
    await db.exec(`
        INSERT INTO search_index (doc_id, title, plain_text_content, metadata, search_vector, vector_version, updated_at)
        SELECT doc_id, 'Note ' || i, 'Breakfast at a café ' || i,
               jsonb_build_object('title', 'Note ' || i, 'tags', '["kohlrabi"]'::jsonb,
                                  'timestamps', jsonb_build_object('modified', '2026-01-01T00:00:00.000Z')),
               setweight(to_tsvector('english', 'Note ' || i), 'A') ||
               setweight(to_tsvector('english', 'Breakfast at a café ' || i), 'B'),
               1, '2026-01-01T00:00:00Z'
        FROM (SELECT gen_random_uuid() AS doc_id, i FROM generate_series(1, ${NOTES}) AS i) n;
        INSERT INTO sync_records (local_id, entity_type, sync_status)
        SELECT doc_id, 'note', 'synced' FROM search_index;
    `);
}

const snapshot = async () =>
    (await db.query<{ doc_id: string; metadata: unknown; updated_at: Date; sync_status: string; dirty_generation: number }>(
        `SELECT s.doc_id, s.metadata, s.updated_at, r.sync_status, r.dirty_generation
         FROM search_index s JOIN sync_records r ON r.local_id = s.doc_id ORDER BY s.doc_id`,
    )).rows;

const oldRows = async () =>
    (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM search_index WHERE vector_version < 2')).rows[0].n;

describe('runSearchReindex', () => {
    it('rebuilds every old vector in batches of at most 200, touching nothing else', async () => {
        await seedVersion1Notes();
        const before = await snapshot();
        const query = db.query.bind(db);
        const batches: number[] = [];
        const spy = vi.spyOn(db, 'query').mockImplementation((async (sql: string, params?: unknown[]) => {
            const result = await query(sql, params);
            if (sql.trimStart().startsWith('UPDATE search_index')) batches.push(result.affectedRows ?? 0);
            return result;
        }) as typeof db.query);
        try {
            await runSearchReindex();
        } finally {
            spy.mockRestore();
        }

        expect(await oldRows()).toBe(0);
        expect(batches.length).toBeGreaterThanOrEqual(NOTES / REINDEX_BATCH_SIZE);
        expect(Math.max(...batches)).toBeLessThanOrEqual(REINDEX_BATCH_SIZE);
        expect(batches.reduce((a, b) => a + b, 0)).toBe(NOTES);
        expect(await snapshot()).toEqual(before);
        expect(live.suspend).toHaveBeenCalledTimes(1);
        expect(live.resume).toHaveBeenCalledTimes(1);

        // The rebuilt vectors ignore accents and carry the tags.
        const results = await advancedSearch('cafe 1234');
        expect(results[0].title).toBe('Note 1234');
        expect(results[0].contentHighlight).toContain('<mark>café</mark>');
        expect((await advancedSearch('kohlrabi')).length).toBeGreaterThan(0);
    });

    it('finishes the rest on the next run after stopping half-way', async () => {
        await seedVersion1Notes();
        for (let i = 0; i < 5; i++) expect(await reindexSearchBatch()).toBe(REINDEX_BATCH_SIZE);
        expect(await oldRows()).toBe(NOTES - 5 * REINDEX_BATCH_SIZE);

        await runSearchReindex();

        expect(await oldRows()).toBe(0);
    });

    it('does nothing, and pauses no live query, when every vector is current', async () => {
        await seedVersion1Notes();
        await runSearchReindex();
        live.suspend.mockClear();

        await runSearchReindex();

        expect(live.suspend).not.toHaveBeenCalled();
        expect(await reindexSearchBatch()).toBe(0);
    });
});
