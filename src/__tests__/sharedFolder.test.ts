/**
 * #618: share a folder. The create rule (a note created in a shared folder starts
 * public), the folder flag in the local DB, and which notes sharing or unsharing a
 * folder changes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import {
    createFolder,
    getAllFolders,
    getFolderById,
    getFolderNotesToShare,
    getSearchIndexEntry,
    isFolderPublic,
    setFolderPublicLocal,
    upsertSearchIndex,
} from '@/lib/db/queries';
import { createNoteWithContentInDb } from '@/lib/notes/createNote';
import { newNoteShareFields } from '@/lib/share/sharedFolder';
import type { DocumentMetadata } from '@/types';

const SHARED = '61800000-0000-4000-8000-000000000001';
const PRIVATE = '61800000-0000-4000-8000-000000000002';

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => {
    await resetTestDatabase();
    await createFolder(SHARED, 'Shared');
    await createFolder(PRIVATE, 'Private');
    await setFolderPublicLocal(SHARED, true);
});

describe('newNoteShareFields (the create rule)', () => {
    it('makes a note created in a shared folder public and indexable', () => {
        expect(newNoteShareFields({ isPublic: true })).toEqual({ isPublic: true, shareIndexable: true });
    });

    it('sets nothing for a private or unknown folder', () => {
        expect(newNoteShareFields({ isPublic: false })).toEqual({});
        expect(newNoteShareFields({})).toEqual({});
        expect(newNoteShareFields(null)).toEqual({});
        expect(newNoteShareFields(undefined)).toEqual({});
    });
});

describe('folder public flag', () => {
    it('defaults to private and reads back once shared', async () => {
        expect((await getFolderById(PRIVATE))?.isPublic).toBe(false);
        expect((await getFolderById(SHARED))?.isPublic).toBe(true);
        const mine = (await getAllFolders()).filter((f) => f.id === SHARED || f.id === PRIVATE);
        expect(mine.map((f) => [f.name, f.isPublic])).toEqual([['Private', false], ['Shared', true]]);
    });

    it('isFolderPublic is false for a folder id that is not a UUID or not known', async () => {
        expect(await isFolderPublic(SHARED)).toBe(true);
        expect(await isFolderPublic(PRIVATE)).toBe(false);
        expect(await isFolderPublic('main')).toBe(false);
        expect(await isFolderPublic('61800000-0000-4000-8000-0000000000ff')).toBe(false);
    });
});

describe('creating a note', () => {
    it('in a shared folder starts public', async () => {
        const { docId } = await createNoteWithContentInDb({ title: 'In shared', content: 'Hello', folderId: SHARED });
        const entry = await getSearchIndexEntry(docId);
        expect(entry?.metadata).toMatchObject({ folderId: SHARED, isPublic: true, shareIndexable: true });
    });

    it('in a private folder stays private', async () => {
        const { docId } = await createNoteWithContentInDb({ title: 'In private', content: 'Hello', folderId: PRIVATE });
        const entry = await getSearchIndexEntry(docId);
        expect(entry?.metadata.isPublic).toBeUndefined();
        expect(entry?.metadata.shareIndexable).toBeUndefined();
    });
});

describe('getFolderNotesToShare', () => {
    const note = async (docId: string, folderId: string, extra: Partial<DocumentMetadata> = {}) => {
        const now = new Date().toISOString();
        await upsertSearchIndex({
            docId,
            title: docId,
            plainTextContent: '',
            metadata: { title: docId, folderId, tags: [], timestamps: { created: now, modified: now }, excludeFromAI: false, ...extra },
        });
    };
    const id = (n: number) => `61800000-0000-4000-8000-1000000000${String(n).padStart(2, '0')}`;

    beforeEach(async () => {
        await note(id(1), PRIVATE);
        await note(id(2), PRIVATE, { isPublic: true });
        await note(id(3), PRIVATE, { archivalStatus: 1 }); // archived: still in the folder
        await note(id(4), PRIVATE, { archivalStatus: 2 }); // trashed: left alone
        await note(id(5), SHARED);
    });

    it('sharing changes every non-trashed note in the folder that is not public yet', async () => {
        expect((await getFolderNotesToShare(PRIVATE, true)).sort()).toEqual([id(1), id(3)]);
    });

    it('unsharing changes every public note in the folder', async () => {
        expect(await getFolderNotesToShare(PRIVATE, false)).toEqual([id(2)]);
    });
});
