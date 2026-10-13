/**
 * #620: renaming a folder updates the local row (trimmed, no-op when empty/unchanged)
 * and the push merges the new name over the remote FolderFile so fields this device
 * doesn't track (colour, ...) survive.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { createFolder, renameFolder, getFolderById, upsertSyncRecord } from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockCreate, mockGet, mockUpdate } = vi.hoisted(() => ({
    mockCreate: vi.fn(), mockGet: vi.fn(), mockUpdate: vi.fn(),
}));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider {
        createFolder = mockCreate;
        getFolder = mockGet;
        updateFolder = mockUpdate;
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

const F = '55555555-5555-5555-5555-555555555555';

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

describe('renameFolder', () => {
    it('renames and trims', async () => {
        await createFolder(F, 'Old');
        expect(await renameFolder(F, '  New  ')).toBe(true);
        expect((await getFolderById(F))?.name).toBe('New');
    });

    it('is a no-op for an empty or unchanged name', async () => {
        await createFolder(F, 'Old');
        expect(await renameFolder(F, '   ')).toBe(false);
        expect(await renameFolder(F, 'Old')).toBe(false);
        expect((await getFolderById(F))?.name).toBe('Old');
    });
});

describe('pushFolder after a rename', () => {
    it('keeps remote fields (colour) it did not set', async () => {
        await createFolder(F, 'New');
        await upsertSyncRecord({ localId: F, entityType: 'folder', remoteFileId: 'file-1', syncStatus: 'pending' });
        mockCreate.mockImplementation(async (_id, _file, opts) => ({ ...(await opts.onVersionConflict()), fileId: 'file-1' }));
        mockGet.mockResolvedValue({
            fileId: 'file-1',
            fileMetadata: {
                versionTag: 'v1',
                appData: { content: { name: 'Old', color: 'red', isCollaborative: false, needsPassword: false } },
            },
        });
        mockUpdate.mockResolvedValue({ versionTag: 'v2' });

        const svc = new SyncService(fakeDotYouClient(), fakeOnlineContext());
        await svc.pushFolder({ localId: F, entityType: 'folder', syncStatus: 'pending' });

        expect(mockUpdate).toHaveBeenCalledWith('file-1', 'v1', expect.objectContaining({ name: 'New', color: 'red' }));
    });
});
