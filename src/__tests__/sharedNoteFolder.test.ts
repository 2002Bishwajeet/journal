/**
 * #682: sharing keeps a note in its folder. Notes shared before that live in the hidden
 * collaborative folder: the owner's Main lists their own, someone else's stay out.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { upsertSearchIndex, getNotesForListByFolder } from '@/lib/db/queries';
import { COLLABORATIVE_FOLDER_ID, MAIN_FOLDER_ID } from '@/lib/homebase/config';
import { sharedNoteFolderId } from '@/lib/homebase/shareTargets';

const HOST = 'me.id';
const OWN_SHARED = '20000000-0000-0000-0000-000000000001';
const PEER_SHARED = '20000000-0000-0000-0000-000000000002';
const IN_MAIN = '20000000-0000-0000-0000-000000000003';
const IN_FOLDER = '20000000-0000-0000-0000-000000000004';
const FOLDER = '30000000-0000-0000-0000-000000000001';

async function addNote(docId: string, folderId: string, authorOdinId?: string) {
    const now = new Date().toISOString();
    await upsertSearchIndex({
        docId,
        title: docId,
        plainTextContent: docId,
        metadata: {
            title: docId,
            folderId,
            timestamps: { created: now, modified: now },
            excludeFromAI: false,
            isCollaborative: folderId === COLLABORATIVE_FOLDER_ID,
            ...(authorOdinId && { authorOdinId }),
        },
    });
}

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => {
    await resetTestDatabase();
    await addNote(OWN_SHARED, COLLABORATIVE_FOLDER_ID);
    await addNote(PEER_SHARED, COLLABORATIVE_FOLDER_ID, 'friend.id');
    await addNote(IN_MAIN, MAIN_FOLDER_ID);
    await addNote(IN_FOLDER, FOLDER);
});

describe('the collaborative folder fallback', () => {
    it("lists the owner's own notes from the collaborative folder in Main", async () => {
        const ids = (await getNotesForListByFolder(MAIN_FOLDER_ID, HOST)).map((n) => n.docId);

        expect(ids.toSorted()).toEqual([OWN_SHARED, IN_MAIN].toSorted());
    });

    it("leaves someone else's note out of Main", async () => {
        const ids = (await getNotesForListByFolder(MAIN_FOLDER_ID, HOST)).map((n) => n.docId);

        expect(ids).not.toContain(PEER_SHARED);
    });

    it('keeps the note in the collaborative folder itself, unchanged', async () => {
        const entries = await getNotesForListByFolder(COLLABORATIVE_FOLDER_ID, HOST);

        expect(entries.map((n) => n.docId).toSorted()).toEqual([OWN_SHARED, PEER_SHARED].toSorted());
        expect(entries.every((n) => n.metadata.folderId === COLLABORATIVE_FOLDER_ID)).toBe(true);
    });

    it('adds nothing to another folder', async () => {
        const ids = (await getNotesForListByFolder(FOLDER, HOST)).map((n) => n.docId);

        expect(ids).toEqual([IN_FOLDER]);
    });
});

describe('sharedNoteFolderId', () => {
    it('writes Main for a note in the collaborative folder', () => {
        expect(sharedNoteFolderId(COLLABORATIVE_FOLDER_ID)).toBe(MAIN_FOLDER_ID);
    });

    it('keeps any other folder', () => {
        expect(sharedNoteFolderId(FOLDER)).toBe(FOLDER);
        expect(sharedNoteFolderId(MAIN_FOLDER_ID)).toBe(MAIN_FOLDER_ID);
    });
});
