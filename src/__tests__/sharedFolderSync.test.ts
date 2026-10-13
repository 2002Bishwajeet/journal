/**
 * #618: a folder's public flag round-trips through sync like its name: a push sends
 * it in the folder file, a pull applies it locally (a second device sees the folder
 * as shared, and an unshare from elsewhere makes it private here).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    createFolder, getFolderById, setFolderPublicLocal, upsertSyncRecord, getSyncRecord,
} from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockDsr, mockCreateFolder, mockUpdateFolder } = vi.hoisted(() => ({ mockDsr: vi.fn(), mockCreateFolder: vi.fn(), mockUpdateFolder: vi.fn() }));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider {
        dsrToFolderFileContent = mockDsr;
        createFolder = mockCreateFolder;
        updateFolder = mockUpdateFolder;
        constructor() {}
    },
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider { constructor() {} },
}));
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor { constructor() {} },
}));

import { SyncService } from '@/lib/homebase/SyncService';

const F = '61800000-0000-4000-8000-000000000003';
const svc = () => new SyncService(fakeDotYouClient(), fakeOnlineContext());

const remoteFolder = (versionTag: string) => ({
    fileId: 'folder-file-1',
    sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
    fileMetadata: { versionTag, appData: { uniqueId: F } },
}) as never;

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => {
    await resetTestDatabase();
    vi.clearAllMocks();
});

describe('pull', () => {
    it('a folder shared on another device arrives shared', async () => {
        mockDsr.mockResolvedValue({ name: 'Blog', isPublic: true });
        await svc().handleRemoteFolder(remoteFolder('v1'));
        expect(await getFolderById(F)).toMatchObject({ name: 'Blog', isPublic: true });
    });

    it('a folder unshared on another device becomes private here', async () => {
        await createFolder(F, 'Blog');
        await setFolderPublicLocal(F, true);
        await upsertSyncRecord({ localId: F, entityType: 'folder', remoteFileId: 'folder-file-1', versionTag: 'v1', syncStatus: 'synced' });
        mockDsr.mockResolvedValue({ name: 'Blog', isCollaborative: false, needsPassword: false });

        await svc().handleRemoteFolder(remoteFolder('v2'));

        expect((await getFolderById(F))?.isPublic).toBe(false);
        expect((await getSyncRecord(F))?.versionTag).toBe('v2');
    });
});

describe('push', () => {
    it('sends the folder public flag in the folder file', async () => {
        await createFolder(F, 'Blog');
        await setFolderPublicLocal(F, true);
        await upsertSyncRecord({ localId: F, entityType: 'folder', syncStatus: 'pending' });
        mockCreateFolder.mockResolvedValue({ fileId: 'folder-file-1', versionTag: 'v1' });

        await svc().pushFolder((await getSyncRecord(F))!);

        expect(mockCreateFolder).toHaveBeenCalledWith(F, expect.objectContaining({ name: 'Blog', isPublic: true }), expect.anything());
        expect((await getSyncRecord(F))?.syncStatus).toBe('synced');
    });

    it('updates a folder already on Homebase instead of re-creating it', async () => {
        await createFolder(F, 'Blog');
        await setFolderPublicLocal(F, true);
        await upsertSyncRecord({ localId: F, entityType: 'folder', remoteFileId: 'folder-file-1', versionTag: 'v1', syncStatus: 'pending' });
        mockUpdateFolder.mockResolvedValue({ versionTag: 'v2' });

        await svc().pushFolder((await getSyncRecord(F))!);

        expect(mockCreateFolder).not.toHaveBeenCalled();
        expect(mockUpdateFolder).toHaveBeenCalledWith('folder-file-1', 'v1', expect.objectContaining({ isPublic: true }));
        expect(await getSyncRecord(F)).toMatchObject({ syncStatus: 'synced', versionTag: 'v2' });
    });
});
