import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';
import { upsertSearchIndex, searchNotesByTitle, updateSearchIndexMetadata, getSearchIndexEntry } from '@/lib/db/queries';

const SELF = '50000000-0000-0000-0000-0000000000ff';
const N1 = '50000000-0000-0000-0000-000000000001';
const N2 = '50000000-0000-0000-0000-000000000002';
const N3 = '50000000-0000-0000-0000-000000000003';

async function addNote(docId: string, title: string, archivalStatus?: number, modified?: string) {
    const now = modified ?? new Date().toISOString();
    await upsertSearchIndex({
        docId,
        title,
        plainTextContent: title,
        metadata: {
            title,
            folderId: 'main',
            timestamps: { created: now, modified: now },
            excludeFromAI: false,
            ...(archivalStatus !== undefined ? { archivalStatus } : {}),
        },
    });
}

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

describe('updateSearchIndexMetadata preserves editor-owned linkedNoteIds', () => {
    it('keeps existing linkedNoteIds when a metadata-only write omits them', async () => {
        const now = new Date().toISOString();
        // A note that already has outgoing links (written by the content-save path).
        await upsertSearchIndex({
            docId: N1,
            title: 'Has links',
            plainTextContent: 'body',
            metadata: {
                title: 'Has links',
                folderId: 'main',
                timestamps: { created: now, modified: now },
                excludeFromAI: false,
                linkedNoteIds: [N2, N3],
            },
        });

        // A title-only update whose metadata snapshot is stale (no linkedNoteIds).
        await updateSearchIndexMetadata(N1, 'Renamed', {
            title: 'Renamed',
            folderId: 'main',
            timestamps: { created: now, modified: now },
            excludeFromAI: false,
        });

        const entry = await getSearchIndexEntry(N1);
        expect(entry?.title).toBe('Renamed');
        expect(entry?.metadata.linkedNoteIds).toEqual([N2, N3]);
    });

    it('does not invent linkedNoteIds for notes that never had them', async () => {
        const now = new Date().toISOString();
        await addNote(N1, 'No links');
        await updateSearchIndexMetadata(N1, 'Still no links', {
            title: 'Still no links',
            folderId: 'main',
            timestamps: { created: now, modified: now },
            excludeFromAI: false,
        });
        const entry = await getSearchIndexEntry(N1);
        expect(entry?.metadata.linkedNoteIds).toBeUndefined();
    });
});

describe('searchNotesByTitle', () => {
    it('matches notes by case-insensitive title substring', async () => {
        await addNote(N1, 'Project Roadmap');
        await addNote(N2, 'Grocery list');
        const res = await searchNotesByTitle('road');
        expect(res.map((n) => n.docId)).toEqual([N1]);
    });

    it('excludes the current note (self link)', async () => {
        await addNote(SELF, 'Daily Journal');
        await addNote(N1, 'Journal ideas');
        const res = await searchNotesByTitle('journal', SELF);
        expect(res.map((n) => n.docId)).toEqual([N1]);
    });

    it('excludes archived (1) and trashed (2) notes', async () => {
        await addNote(N1, 'Note alpha', 0);
        await addNote(N2, 'Note bravo', 1);
        await addNote(N3, 'Note charlie', 2);
        const res = await searchNotesByTitle('note');
        expect(res.map((n) => n.docId)).toEqual([N1]);
    });

    it('returns recent active notes for an empty query, respecting the limit', async () => {
        await addNote(N1, 'One', 0, '2026-01-01T00:00:01.000Z');
        await addNote(N2, 'Two', 0, '2026-01-01T00:00:02.000Z');
        await addNote(N3, 'Three', 0, '2026-01-01T00:00:03.000Z');
        const res = await searchNotesByTitle('', undefined, 2);
        expect(res).toHaveLength(2);
        // most-recently-modified first
        expect(res[0].docId).toBe(N3);
    });
});
