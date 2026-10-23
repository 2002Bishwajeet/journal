/**
 * #637: on a new device the first pull of a big account is a bulk pull. A folder
 * or note made while it runs must survive the pull and be pushed by the same sync.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    createFolder, getFolderById, upsertSyncRecord, getSyncRecord, upsertSearchIndex, getSearchIndexEntry,
} from '@/lib/db/queries';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockDsr, mockCreateFolder, mockProcessChanges } = vi.hoisted(() => ({
    mockDsr: vi.fn(),
    mockCreateFolder: vi.fn(),
    mockProcessChanges: vi.fn(),
}));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider {
        dsrToFolderFileContent = mockDsr;
        createFolder = mockCreateFolder;
        constructor() {}
    },
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider { constructor() {} },
}));
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor {
        processChanges = mockProcessChanges;
        getCurrentSyncTime = () => Date.now();
        constructor() {}
    },
}));

import { SyncService } from '@/lib/homebase/SyncService';

const LOCAL_FOLDER = '63700000-0000-0000-0000-0000000000f1';
const LOCAL_NOTE = '63700000-0000-0000-0000-0000000000a1';

/** 25 remote folders: above the bulk-pull threshold, so live queries are suspended. */
function remoteFolders() {
    return Array.from({ length: 25 }, (_, i) => ({
        fileId: `remote-folder-${i}`,
        fileState: 'active',
        sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
        fileMetadata: { versionTag: 'v1', appData: { uniqueId: `63700000-0000-0000-0000-${String(i + 1).padStart(12, '0')}` } },
    }));
}

/** What useFolders' create and useNotes' create write: a local row plus a pending record. */
async function createLocallyLikeTheUi() {
    await createFolder(LOCAL_FOLDER, 'Made mid-pull');
    await upsertSyncRecord({ localId: LOCAL_FOLDER, entityType: 'folder', syncStatus: 'pending' });
    const now = new Date().toISOString();
    await upsertSearchIndex({
        docId: LOCAL_NOTE,
        title: 'Typed mid-pull',
        plainTextContent: '',
        metadata: { title: 'Typed mid-pull', folderId: MAIN_FOLDER_ID, tags: [], excludeFromAI: false, timestamps: { created: now, modified: now } },
    });
    await upsertSyncRecord({ localId: LOCAL_NOTE, entityType: 'note', syncStatus: 'pending' });
}

beforeAll(async () => {
    setTestDb(await createTestDatabase());
});
afterAll(async () => { await closeTestDatabase(); });

describe('first sync with a folder and note made during the pull (#637)', () => {
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        mockProcessChanges.mockResolvedValue({ folders: remoteFolders(), notes: [], invitations: [] });
        mockCreateFolder.mockResolvedValue({ fileId: 'pushed-folder-file', versionTag: 'pv1' });
        // The user makes the folder and note while the 10th remote folder is being handled
        let calls = 0;
        mockDsr.mockImplementation(async () => {
            calls += 1;
            if (calls === 10) await createLocallyLikeTheUi();
            return { name: `Remote ${calls}` };
        });
    });

    it('keeps the local folder and note through the pull and pushes both', async () => {
        const svc = new SyncService(fakeDotYouClient(), fakeOnlineContext());
        const pushNote = vi.spyOn(svc, 'pushNote').mockResolvedValue();

        const result = await svc.sync();

        expect(result.errors).toEqual([]);
        expect(result.pulled.folders).toBe(25);
        expect((await getFolderById(LOCAL_FOLDER))?.name).toBe('Made mid-pull');
        expect(mockCreateFolder).toHaveBeenCalledWith(LOCAL_FOLDER, expect.objectContaining({ name: 'Made mid-pull' }), expect.anything());
        const folderRecord = await getSyncRecord(LOCAL_FOLDER);
        expect(folderRecord?.syncStatus).toBe('synced');
        expect(folderRecord?.remoteFileId).toBe('pushed-folder-file');

        expect((await getSearchIndexEntry(LOCAL_NOTE))?.title).toBe('Typed mid-pull');
        expect(pushNote).toHaveBeenCalledWith(expect.objectContaining({ localId: LOCAL_NOTE }));
    });
});
