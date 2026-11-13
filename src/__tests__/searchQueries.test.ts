// @vitest-environment happy-dom
/** The search dialog's bounded empty-state queries, against the real schema. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { upsertSearchIndex, getRecentlyModifiedNotes, getNotesByIds } from '@/lib/db/queries';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function addNote(n: number, modified: string, archivalStatus?: number, body = 'body') {
    await upsertSearchIndex({
        docId: id(n),
        title: `Note ${n}`,
        plainTextContent: body,
        metadata: {
            title: `Note ${n}`,
            folderId: 'main',
            timestamps: { created: modified, modified },
            excludeFromAI: false,
            archivalStatus,
        },
    });
}

const at = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();

beforeAll(async () => { setTestDb(await createTestDatabase()); });
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

describe('getRecentlyModifiedNotes', () => {
    it('respects the limit and the order, skips trashed and archived, and cuts the preview', async () => {
        await addNote(1, at(1));
        await addNote(2, at(3));
        await addNote(3, at(2));
        await addNote(4, at(9), 2);
        await addNote(5, at(8), 1);
        await addNote(6, at(4), undefined, 'x'.repeat(500));
        const all = await getRecentlyModifiedNotes();
        expect(all.map((n) => n.docId)).toEqual([id(6), id(2), id(3), id(1)]);
        expect(all[0].preview.length).toBe(150);
        expect((await getRecentlyModifiedNotes(2)).map((n) => n.docId)).toEqual([id(6), id(2)]);
    });
});

describe('getNotesByIds', () => {
    it('returns the requested active notes and skips trashed and unknown ids', async () => {
        await addNote(1, at(1));
        await addNote(2, at(2), 2);
        const rows = await getNotesByIds([id(1), id(2), id(3)]);
        expect(rows.map((n) => n.docId)).toEqual([id(1)]);
        expect(await getNotesByIds([])).toEqual([]);
    });
});
