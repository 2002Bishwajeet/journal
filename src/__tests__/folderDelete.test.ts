/**
 * #149: deleting a folder must delete all of its notes — on the server and locally.
 * Notes are uploaded with appData.groupId = the folder's uniqueId, so the server
 * group-delete must use that id (not the folder file's fileId). Locally, trashed
 * and archived notes of the folder must be swept too.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    upsertSearchIndex, upsertSyncRecord, getSyncRecord, getSearchIndexEntry,
    createFolder, getAllDocIdsByFolder,
} from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockDeleteFile, mockDeleteByGroup } = vi.hoisted(() => ({
    mockDeleteFile: vi.fn(),
    mockDeleteByGroup: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return { ...actual, deleteFile: mockDeleteFile, deleteFilesByGroupId: mockDeleteByGroup };
});

import { FolderDriveProvider } from '@/lib/homebase/FolderDriveProvider';
import { SyncService } from '@/lib/homebase/SyncService';

const FOLDER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_FOLDER_ID = '33333333-3333-3333-3333-333333333333';
const ACTIVE = 'aaaaaaaa-0000-0000-0000-000000000001';
const ARCHIVED = 'aaaaaaaa-0000-0000-0000-000000000002';
const TRASHED = 'aaaaaaaa-0000-0000-0000-000000000003';
const OTHER = 'bbbbbbbb-0000-0000-0000-000000000001';
const fakeClient = fakeDotYouClient();
const fakeOnline = fakeOnlineContext();

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

beforeEach(async () => {
    await resetTestDatabase();
    vi.clearAllMocks();
    mockDeleteFile.mockResolvedValue(true);
    mockDeleteByGroup.mockResolvedValue(true);
});

async function addNote(docId: string, folderId: string, archivalStatus?: number) {
    await upsertSearchIndex({
        docId,
        title: docId,
        plainTextContent: '',
        metadata: {
            title: docId, folderId, tags: [], excludeFromAI: false, archivalStatus,
            timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
        },
    });
    await upsertSyncRecord({ localId: docId, entityType: 'note', syncStatus: 'synced', remoteFileId: `rf-${docId}` });
}

describe('FolderDriveProvider.deleteFolder', () => {
    it('deletes the folder file by fileId and its notes by the folder uniqueId', async () => {
        await new FolderDriveProvider(fakeClient).deleteFolder('file-1', FOLDER_ID);

        expect(mockDeleteFile).toHaveBeenCalledWith(fakeClient, expect.anything(), 'file-1');
        expect(mockDeleteByGroup).toHaveBeenCalledWith(fakeClient, expect.anything(), [FOLDER_ID]);
    });
});

describe('SyncService.deleteFolderRemote', () => {
    it('group-deletes by the folder uniqueId, not its remote fileId', async () => {
        await upsertSyncRecord({ localId: FOLDER_ID, entityType: 'folder', syncStatus: 'synced', remoteFileId: 'file-1' });

        await new SyncService(fakeClient, fakeOnline).deleteFolderRemote(FOLDER_ID);

        expect(mockDeleteFile).toHaveBeenCalledWith(fakeClient, expect.anything(), 'file-1');
        expect(mockDeleteByGroup).toHaveBeenCalledWith(fakeClient, expect.anything(), [FOLDER_ID]);
    });

    it('still group-deletes the notes when the folder file itself was never uploaded', async () => {
        // Folder push failed (or not reached yet) but its notes were pushed with groupId = folderId
        await upsertSyncRecord({ localId: FOLDER_ID, entityType: 'folder', syncStatus: 'pending' });

        await new SyncService(fakeClient, fakeOnline).deleteFolderRemote(FOLDER_ID);

        expect(mockDeleteFile).not.toHaveBeenCalled();
        expect(mockDeleteByGroup).toHaveBeenCalledWith(fakeClient, expect.anything(), [FOLDER_ID]);
    });
});

describe('folder delete sweeps trashed and archived notes', () => {
    beforeEach(async () => {
        await createFolder(FOLDER_ID, 'Doomed');
        await addNote(ACTIVE, FOLDER_ID, 0);
        await addNote(ARCHIVED, FOLDER_ID, 1);
        await addNote(TRASHED, FOLDER_ID, 2);
        await addNote(OTHER, OTHER_FOLDER_ID, 0);
    });

    it('getAllDocIdsByFolder returns active, archived and trashed notes of that folder only', async () => {
        const ids = await getAllDocIdsByFolder(FOLDER_ID);
        expect(ids.sort()).toEqual([ACTIVE, ARCHIVED, TRASHED].sort());
    });

    it('handleDeletedFolder removes every note of the folder and leaves other folders alone', async () => {
        await new SyncService(fakeClient, fakeOnline).handleDeletedFolder({
            fileMetadata: { appData: { uniqueId: FOLDER_ID } },
        } as never);

        for (const id of [ACTIVE, ARCHIVED, TRASHED]) {
            expect(await getSearchIndexEntry(id)).toBeNull();
            expect(await getSyncRecord(id)).toBeNull();
        }
        expect(await getSearchIndexEntry(OTHER)).not.toBeNull();
        expect(await getSyncRecord(OTHER)).not.toBeNull();
    });
});
