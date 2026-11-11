import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import {
    upsertSearchIndex,
    getNotesForList,
    getNotesForListByFolder,
    getTrashedNotes,
    getArchivedNotes,
    setNoteArchivalStatusLocal,
    saveSnapshot,
    getSnapshots,
} from '@/lib/db/queries';

const ACTIVE_A = '10000000-0000-0000-0000-000000000001';
const ACTIVE_B = '10000000-0000-0000-0000-000000000002';
const TRASHED = '10000000-0000-0000-0000-000000000003';
const ARCHIVED = '10000000-0000-0000-0000-000000000004';

async function addNote(docId: string, title: string, archivalStatus?: number) {
    const now = new Date().toISOString();
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
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

describe('trash filtering in list queries', () => {
    it('getNotesForList excludes trashed notes (archivalStatus 2)', async () => {
        await addNote(ACTIVE_A, 'Active A');     // no archivalStatus
        await addNote(ACTIVE_B, 'Active B', 0);  // explicit active
        await addNote(TRASHED, 'Trashed', 2);

        const ids = (await getNotesForList()).map((n) => n.docId);

        expect(ids).toContain(ACTIVE_A);
        expect(ids).toContain(ACTIVE_B);
        expect(ids).not.toContain(TRASHED);
    });

    it('getNotesForListByFolder excludes trashed notes', async () => {
        await addNote(ACTIVE_A, 'Active A');
        await addNote(TRASHED, 'Trashed', 2);

        const ids = (await getNotesForListByFolder('main')).map((n) => n.docId);

        expect(ids).toContain(ACTIVE_A);
        expect(ids).not.toContain(TRASHED);
    });

    it('getTrashedNotes returns only trashed notes', async () => {
        await addNote(ACTIVE_A, 'Active A');
        await addNote(TRASHED, 'Trashed', 2);

        const trash = await getTrashedNotes();

        expect(trash.map((n) => n.docId)).toEqual([TRASHED]);
    });

    it('setNoteArchivalStatusLocal moves a note in/out of trash, preserving other metadata', async () => {
        await addNote(ACTIVE_A, 'Note A');

        await setNoteArchivalStatusLocal(ACTIVE_A, 2);
        expect((await getNotesForList()).map((n) => n.docId)).not.toContain(ACTIVE_A);
        const trashed = await getTrashedNotes();
        expect(trashed.map((n) => n.docId)).toContain(ACTIVE_A);
        expect(trashed[0].metadata.folderId).toBe('main'); // other metadata preserved

        await setNoteArchivalStatusLocal(ACTIVE_A, 0);
        expect((await getNotesForList()).map((n) => n.docId)).toContain(ACTIVE_A);
    });

    it('getNotesForList excludes archived notes (archivalStatus 1) as well as trashed', async () => {
        await addNote(ACTIVE_A, 'Active A');
        await addNote(ARCHIVED, 'Archived', 1);
        await addNote(TRASHED, 'Trashed', 2);

        const ids = (await getNotesForList()).map((n) => n.docId);

        expect(ids).toContain(ACTIVE_A);
        expect(ids).not.toContain(ARCHIVED);
        expect(ids).not.toContain(TRASHED);
    });

    it('getArchivedNotes returns only archived notes (status 1, not active or trashed)', async () => {
        await addNote(ACTIVE_A, 'Active A');
        await addNote(ARCHIVED, 'Archived', 1);
        await addNote(TRASHED, 'Trashed', 2);

        const ids = (await getArchivedNotes()).map((n) => n.docId);

        expect(ids).toEqual([ARCHIVED]);
    });
});

describe('moving a note to Trash drops its version history (#1070)', () => {
    const snap = { stateBlob: new Uint8Array([1]), stateVector: new Uint8Array([1]), preview: '', wordCount: 0 };

    it('removes the trashed note\'s snapshots and keeps other notes\' snapshots', async () => {
        await addNote(ACTIVE_A, 'A');
        await addNote(ACTIVE_B, 'B');
        await saveSnapshot(ACTIVE_A, snap);
        await saveSnapshot(ACTIVE_A, snap);
        await saveSnapshot(ACTIVE_B, snap);

        await setNoteArchivalStatusLocal(ACTIVE_A, 2);

        expect(await getSnapshots(ACTIVE_A)).toHaveLength(0);
        expect(await getSnapshots(ACTIVE_B)).toHaveLength(1);
    });

    it('archiving keeps the history, and a restored note comes back with an empty history', async () => {
        await addNote(ACTIVE_A, 'A');
        await saveSnapshot(ACTIVE_A, snap);
        await setNoteArchivalStatusLocal(ACTIVE_A, 1);
        expect(await getSnapshots(ACTIVE_A)).toHaveLength(1);

        await setNoteArchivalStatusLocal(ACTIVE_A, 2);
        await setNoteArchivalStatusLocal(ACTIVE_A, 0);

        expect((await getNotesForList()).map((n) => n.docId)).toContain(ACTIVE_A);
        expect(await getSnapshots(ACTIVE_A)).toEqual([]);
    });
});
