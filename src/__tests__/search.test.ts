/**
 * advancedSearch (hybrid FTS + trigram + LIKE) against the real schema.
 * Notes are seeded through upsertSearchIndex so search_vector is built by the
 * app's own code, and pg_trgm is loaded, so a broken query fails here instead of
 * silently taking the LIKE fallback.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { upsertSearchIndex, advancedSearch } from '@/lib/db/queries';

async function addNote(docId: string, title: string, plainTextContent: string) {
    const now = new Date().toISOString();
    await upsertSearchIndex({
        docId,
        title,
        plainTextContent,
        metadata: {
            title,
            folderId: 'main',
            timestamps: { created: now, modified: now },
            excludeFromAI: false,
        },
    });
}

const ids = (results: { docId: string }[]) => results.map((r) => r.docId);

beforeAll(async () => {
    setTestDb(await createTestDatabase());
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

describe('advancedSearch', () => {
    it('ranks a note with the word in its title above one with it only in the body', async () => {
        const inBody = '20000000-0000-0000-0000-000000000001';
        const inTitle = '20000000-0000-0000-0000-000000000002';
        await addNote(inBody, 'Weekly notes', 'Planning the garden beds for spring.');
        await addNote(inTitle, 'Garden layout', 'Where the tomatoes and beans go.');

        const results = await advancedSearch('garden');

        expect(ids(results)).toEqual([inTitle, inBody]);
        expect(results[0].matchType).toBe('title');
    });

    it('ranks a stemmed full-text match above a trigram-only match', async () => {
        const fts = '20000000-0000-0000-0000-000000000003';
        const trigram = '20000000-0000-0000-0000-000000000004';
        await addNote(trigram, 'Runnin', 'Nothing else to see here.');
        await addNote(fts, 'Morning notes', 'She runs every day before work.');

        const results = await advancedSearch('running');

        expect(ids(results)).toEqual([fts, trigram]);
        expect(results[0].matchType).toBe('content');
        expect(results[1].matchType).toBe('fuzzy');
    });

    it('finds a typo through trigram similarity, which a LIKE search cannot', async () => {
        const journal = '20000000-0000-0000-0000-000000000005';
        await addNote(journal, 'Journal ideas', '');

        const results = await advancedSearch('jurnal');

        expect(ids(results)).toEqual([journal]);
        expect(results[0].matchType).toBe('fuzzy');
    });

    it('returns nothing for an empty or whitespace-only query', async () => {
        await addNote('20000000-0000-0000-0000-000000000006', 'Anything', 'At all.');

        expect(await advancedSearch('')).toEqual([]);
        expect(await advancedSearch('   ')).toEqual([]);
    });

    it('does not fall back to LIKE search on a normal query', async () => {
        const errorSpy = vi.spyOn(console, 'error');
        try {
            await addNote('20000000-0000-0000-0000-000000000007', 'Garden layout', 'Tomatoes.');

            await advancedSearch('garden');

            expect(errorSpy).not.toHaveBeenCalledWith('[advancedSearch] Error:', expect.anything());
        } finally {
            errorSpy.mockRestore();
        }
    });
});
