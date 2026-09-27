/**
 * #258: a folder delete that fails to reach the server must not silently look like
 * it succeeded. The local delete still happens right away, but the folder's sync
 * record is kept as 'pending_delete' and the remote delete is retried on every
 * sync until it succeeds.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    upsertSyncRecord, getSyncRecord, createFolder, deleteFolder, getFolderById,
    getUnresolvedSyncErrors, getPendingSyncCount, markSynced,
} from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockDeleteFile, mockDeleteByGroup, mockProcessChanges, mockDsr } = vi.hoisted(() => ({
    mockDeleteFile: vi.fn(),
    mockDeleteByGroup: vi.fn(),
    mockProcessChanges: vi.fn(),
    mockDsr: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return { ...actual, deleteFile: mockDeleteFile, deleteFilesByGroupId: mockDeleteByGroup };
});
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor {
        processChanges = mockProcessChanges;
        getCurrentSyncTime = () => Date.now();
        constructor() {}
    },
}));

import { FolderDriveProvider } from '@/lib/homebase/FolderDriveProvider';
import { SyncService } from '@/lib/homebase/SyncService';

const FOLDER_ID = '22222222-2222-2222-2222-222222222222';
const fakeClient = fakeDotYouClient();
const fakeOnline = fakeOnlineContext();

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

let svc: SyncService;
beforeEach(async () => {
    await resetTestDatabase();
    vi.clearAllMocks();
    mockDeleteFile.mockResolvedValue(true);
    mockDeleteByGroup.mockResolvedValue(true);
    mockProcessChanges.mockResolvedValue({ folders: [], notes: [], invitations: [] });
    svc = new SyncService(fakeClient, fakeOnline);
    await createFolder(FOLDER_ID, 'Doomed');
    await upsertSyncRecord({ localId: FOLDER_ID, entityType: 'folder', syncStatus: 'synced', remoteFileId: 'file-1' });
});

/** What useFolders.deleteFolderMutation does: remote delete, then the local delete. */
async function deleteFolderLikeTheUi() {
    await svc.deleteFolderRemote(FOLDER_ID);
    await deleteFolder(FOLDER_ID);
}

/** Let the next sync retry right away instead of waiting out the push backoff. */
async function expireBackoff() {
    await db.query(`UPDATE sync_errors SET next_retry_at = CURRENT_TIMESTAMP - INTERVAL '1 second'`);
}

describe('folder delete when the server delete fails (#258)', () => {
    it('removes the local folder and its sync record when the remote delete succeeds', async () => {
        await deleteFolderLikeTheUi();

        expect(await getFolderById(FOLDER_ID)).toBeNull();
        expect(await getSyncRecord(FOLDER_ID)).toBeNull();
    });

    it('keeps a pending-delete record through the local delete, retries it on sync and clears it on success', async () => {
        mockDeleteByGroup.mockRejectedValueOnce(new Error('offline'));

        await deleteFolderLikeTheUi();

        expect(await getFolderById(FOLDER_ID)).toBeNull(); // local delete still happened
        const pending = await getSyncRecord(FOLDER_ID);
        expect(pending?.syncStatus).toBe('pending_delete');
        expect(pending?.remoteFileId).toBe('file-1');
        expect((await getUnresolvedSyncErrors()).map(e => e.entityId)).toContain(FOLDER_ID);
        expect((await getPendingSyncCount()).folders).toBe(1);

        await expireBackoff();
        mockDeleteFile.mockClear();
        mockDeleteByGroup.mockClear();
        const result = await svc.sync();

        expect(result.errors).toEqual([]);
        expect(mockDeleteFile).toHaveBeenCalledWith(fakeClient, expect.anything(), 'file-1');
        expect(mockDeleteByGroup).toHaveBeenCalledWith(fakeClient, expect.anything(), [FOLDER_ID]);
        expect(await getSyncRecord(FOLDER_ID)).toBeNull();
        expect(await getUnresolvedSyncErrors()).toEqual([]);
    });

    it('never clears the pending-delete record while the remote delete keeps failing', async () => {
        mockDeleteByGroup.mockRejectedValue(new Error('500'));

        await deleteFolderLikeTheUi();
        for (let i = 0; i < 2; i++) {
            await expireBackoff();
            mockDeleteByGroup.mockClear();
            await svc.sync();
            expect(mockDeleteByGroup).toHaveBeenCalledTimes(1);
            expect((await getSyncRecord(FOLDER_ID))?.syncStatus).toBe('pending_delete');
        }
    });

    it('does not resurrect a pending-delete folder when the pull sees it again', async () => {
        mockDeleteByGroup.mockRejectedValue(new Error('offline'));
        await deleteFolderLikeTheUi();
        vi.spyOn(FolderDriveProvider.prototype, 'dsrToFolderFileContent').mockImplementation(mockDsr);
        mockDsr.mockResolvedValue({ name: 'Doomed' });

        await svc.handleRemoteFolder({
            fileId: 'file-1',
            fileMetadata: { versionTag: 'v2', appData: { uniqueId: FOLDER_ID } },
        } as never);

        expect(await getFolderById(FOLDER_ID)).toBeNull();
        expect((await getSyncRecord(FOLDER_ID))?.syncStatus).toBe('pending_delete');
    });

    it('keeps pending_delete when a folder push that was in flight during the delete finishes', async () => {
        mockDeleteByGroup.mockRejectedValueOnce(new Error('offline'));
        await deleteFolderLikeTheUi();

        await markSynced(FOLDER_ID, 'file-1', 'v2'); // what pushFolder records on success

        expect((await getSyncRecord(FOLDER_ID))?.syncStatus).toBe('pending_delete');
    });
});
