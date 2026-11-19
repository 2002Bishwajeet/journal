/**
 * #150: a folder renamed on another device must be renamed here on the next sync.
 * handleRemoteFolder used createFolder (ON CONFLICT DO NOTHING), so an existing
 * folder kept its old name while its sync record moved to the new versionTag.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    createFolder, upsertFolder, getFolderById, upsertSyncRecord, getSyncRecord, setFolderLockedLocal,
} from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockDsr } = vi.hoisted(() => ({ mockDsr: vi.fn() }));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider {
        dsrToFolderFileContent = mockDsr;
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

const F = '44444444-4444-4444-4444-444444444444';
const fakeClient = fakeDotYouClient();
const fakeOnline = fakeOnlineContext();

function remoteFolder(versionTag: string) {
    return {
        fileId: 'folder-file-1',
        sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
        fileMetadata: { versionTag, appData: { uniqueId: F } },
    } as never;
}

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

describe('createFolder vs upsertFolder', () => {
    it('createFolder never overwrites an existing folder name', async () => {
        await createFolder(F, 'A');
        await createFolder(F, 'B');
        expect((await getFolderById(F))?.name).toBe('A');
    });

    it('upsertFolder overwrites an existing folder name', async () => {
        await createFolder(F, 'A');
        await upsertFolder(F, 'B');
        expect((await getFolderById(F))?.name).toBe('B');
    });
});

describe('SyncService.handleRemoteFolder', () => {
    it('applies a remote rename to an existing folder', async () => {
        await createFolder(F, 'Old');
        await upsertSyncRecord({
            localId: F, entityType: 'folder', remoteFileId: 'folder-file-1', versionTag: 'v1',
            lastSyncedAt: new Date().toISOString(), syncStatus: 'synced',
        });
        mockDsr.mockResolvedValue({ name: 'New' });

        await new SyncService(fakeClient, fakeOnline).handleRemoteFolder(remoteFolder('v2'));

        expect((await getFolderById(F))?.name).toBe('New');
        expect((await getSyncRecord(F))?.versionTag).toBe('v2');
    });

    it.each([true, false])('keeps an unpushed local lock (%s) over a remote rename, still pending (#1427)', async (locked) => {
        await upsertFolder(F, 'Old', false, !locked);
        await setFolderLockedLocal(F, locked);
        await upsertSyncRecord({
            localId: F, entityType: 'folder', remoteFileId: 'folder-file-1', versionTag: 'v1',
            lastSyncedAt: new Date().toISOString(), syncStatus: 'pending',
        });
        mockDsr.mockResolvedValue({ name: 'New', locked: !locked });

        await new SyncService(fakeClient, fakeOnline).handleRemoteFolder(remoteFolder('v2'));

        expect(await getFolderById(F)).toMatchObject({ name: 'New', locked });
        expect(await getSyncRecord(F)).toMatchObject({ versionTag: 'v2', syncStatus: 'pending' });
    });

    it('applies a remote lock to a synced folder', async () => {
        await createFolder(F, 'Old');
        await upsertSyncRecord({
            localId: F, entityType: 'folder', remoteFileId: 'folder-file-1', versionTag: 'v1',
            lastSyncedAt: new Date().toISOString(), syncStatus: 'synced',
        });
        mockDsr.mockResolvedValue({ name: 'Old', locked: true });

        await new SyncService(fakeClient, fakeOnline).handleRemoteFolder(remoteFolder('v2'));

        expect((await getFolderById(F))?.locked).toBe(true);
        expect((await getSyncRecord(F))?.syncStatus).toBe('synced');
    });

    it('creates a brand-new remote folder with a synced record', async () => {
        mockDsr.mockResolvedValue({ name: 'Fresh' });

        await new SyncService(fakeClient, fakeOnline).handleRemoteFolder(remoteFolder('v1'));

        expect((await getFolderById(F))?.name).toBe('Fresh');
        const record = await getSyncRecord(F);
        expect(record?.syncStatus).toBe('synced');
        expect(record?.versionTag).toBe('v1');
        expect(record?.remoteFileId).toBe('folder-file-1');
    });
});
