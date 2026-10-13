/**
 * #644: pushing a shared folder draws its link card against the card the remote file
 * names, and stores a new one with the folder only when it is stale.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { createFolder, setFolderPublicLocal, upsertSyncRecord, getSyncRecord } from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockCreateFolder, mockUpdateFolder, mockGetFolder, mockDrawCard } = vi.hoisted(() => ({
    mockCreateFolder: vi.fn(), mockUpdateFolder: vi.fn(), mockGetFolder: vi.fn(), mockDrawCard: vi.fn(),
}));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider {
        createFolder = mockCreateFolder;
        updateFolder = mockUpdateFolder;
        getFolder = mockGetFolder;
        drawCardIfStale = mockDrawCard;
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

const F = '64400000-0000-4000-8000-000000000001';
const svc = () => new SyncService(fakeDotYouClient(), fakeOnlineContext());
const card = { cardImageKey: 'jrnl_card', from: { name: 'Blog', count: 0 } };

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => {
    await resetTestDatabase();
    vi.clearAllMocks();
    mockDrawCard.mockResolvedValue(null);
    mockUpdateFolder.mockResolvedValue({ versionTag: 'v2' });
});

const pending = () => upsertSyncRecord({ localId: F, entityType: 'folder', remoteFileId: 'folder-file-1', versionTag: 'v1', syncStatus: 'pending' });
const remote = (content: object) => ({ fileId: 'folder-file-1', fileMetadata: { versionTag: 'v1', appData: { content: JSON.stringify(content) } } });

describe('push of the link card', () => {
    it('should store a redrawn card with the folder, comparing against the remote one', async () => {
        await createFolder(F, 'Blog');
        await setFolderPublicLocal(F, true);
        await pending();
        mockGetFolder.mockResolvedValue(remote({ name: 'Blog', card }));
        const image = new Blob(['x']);
        const next = { cardImageKey: 'jrnl_card', from: { name: 'Blog', count: 0 } };
        mockDrawCard.mockResolvedValue({ image, card: next });

        await svc().pushFolder((await getSyncRecord(F))!);

        expect(mockDrawCard).toHaveBeenCalledWith(expect.objectContaining({ name: 'Blog' }), 0, card);
        expect(mockUpdateFolder).toHaveBeenCalledWith('folder-file-1', 'v1', expect.objectContaining({ card: next }), image);
    });

    it('should upload no image when the card is current', async () => {
        await createFolder(F, 'Blog');
        await setFolderPublicLocal(F, true);
        await pending();
        mockGetFolder.mockResolvedValue(remote({ name: 'Blog', card }));

        await svc().pushFolder((await getSyncRecord(F))!);

        expect(mockUpdateFolder).toHaveBeenCalledWith('folder-file-1', 'v1', expect.anything(), undefined);
    });

    it('should draw no card for a private folder', async () => {
        await createFolder(F, 'Blog');
        await pending();
        mockGetFolder.mockResolvedValue(remote({}));

        await svc().pushFolder((await getSyncRecord(F))!);

        expect(mockDrawCard).not.toHaveBeenCalled();
    });
});
