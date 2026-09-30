/**
 * #259: notes orphaned by the pre-#254 folder-delete bug keep pulling in with a
 * folderId that points at no local folder row. handleRemoteNote must fall such
 * notes back to Main instead of resurrecting the unreachable folderId.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { createFolder, getSearchIndexEntry, upsertSyncRecord } from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockDsr, mockGetNotePayload, mockDsrFolder, mockProcessChanges } = vi.hoisted(() => ({
    mockDsr: vi.fn(),
    mockGetNotePayload: vi.fn(),
    mockDsrFolder: vi.fn(),
    mockProcessChanges: vi.fn(),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        dsrToContent = mockDsr;
        getNotePayload = mockGetNotePayload;
        constructor() {}
    },
}));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider {
        dsrToFolderFileContent = mockDsrFolder;
        constructor() {}
    },
}));
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor {
        processChanges = mockProcessChanges;
        constructor() {}
    },
}));

import { SyncService } from '@/lib/homebase/SyncService';
import { MAIN_FOLDER_ID, COLLABORATIVE_FOLDER_ID } from '@/lib/homebase/config';

const fakeClient = fakeDotYouClient();
const fakeOnline = fakeOnlineContext();

function remoteNote(uniqueId: string, groupId: string | undefined, versionTag = 'v1') {
    return {
        fileId: 'note-file-1',
        sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
        fileMetadata: {
            versionTag,
            updated: 1700000000000,
            globalTransitId: 'gtid-1',
            appData: { uniqueId, groupId },
        },
    } as never;
}

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

describe('SyncService.handleRemoteNote orphaned folderId (#259)', () => {
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        mockDsr.mockResolvedValue({ title: 'T', tags: [] });
        mockGetNotePayload.mockResolvedValue(null);
    });

    it('falls back to Main when groupId points at no local folder row', async () => {
        const orphanId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        const noteId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

        await new SyncService(fakeClient, fakeOnline).handleRemoteNote(remoteNote(noteId, orphanId));

        const entry = await getSearchIndexEntry(noteId);
        expect(entry?.metadata.folderId).toBe(MAIN_FOLDER_ID);
    });

    it('keeps COLLABORATIVE_FOLDER_ID as-is (a real pseudo-folder, not orphaned)', async () => {
        const noteId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

        await new SyncService(fakeClient, fakeOnline).handleRemoteNote(remoteNote(noteId, COLLABORATIVE_FOLDER_ID));

        const entry = await getSearchIndexEntry(noteId);
        expect(entry?.metadata.folderId).toBe(COLLABORATIVE_FOLDER_ID);
    });

    it('leaves folderId unaffected when the local folder row exists', async () => {
        const realFolderId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
        const noteId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
        await createFolder(realFolderId, 'Real Folder');

        await new SyncService(fakeClient, fakeOnline).handleRemoteNote(remoteNote(noteId, realFolderId));

        const entry = await getSearchIndexEntry(noteId);
        expect(entry?.metadata.folderId).toBe(realFolderId);
    });

    it('also falls back to Main on the existing-note (merge) branch', async () => {
        const orphanId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
        const noteId = '11111111-2222-3333-4444-555555555555';
        await upsertSyncRecord({
            localId: noteId,
            entityType: 'note',
            remoteFileId: 'note-file-1',
            versionTag: 'v0',
            lastSyncedAt: new Date().toISOString(),
            syncStatus: 'synced',
        });

        await new SyncService(fakeClient, fakeOnline).handleRemoteNote(remoteNote(noteId, orphanId, 'v1'));

        const entry = await getSearchIndexEntry(noteId);
        expect(entry?.metadata.folderId).toBe(MAIN_FOLDER_ID);
    });
});

describe('SyncService.pullChanges keeps groupId when the folder pull failed this batch (#259)', () => {
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        mockDsr.mockResolvedValue({ title: 'T', tags: [] });
        mockGetNotePayload.mockResolvedValue(null);
    });

    it('does not move the note to Main when its folder failed to pull in the same batch', async () => {
        const failingFolderId = '99999999-9999-9999-9999-999999999999';
        const noteId = '88888888-8888-8888-8888-888888888888';
        // The folder pull throws (e.g. transient network/parse error) — its local
        // row never gets created, but that's not proof the folder is gone.
        mockDsrFolder.mockRejectedValue(new Error('boom'));
        mockProcessChanges.mockResolvedValue({
            folders: [{
                fileId: 'folder-file-1',
                fileMetadata: { versionTag: 'v1', appData: { uniqueId: failingFolderId } },
            }],
            notes: [remoteNote(noteId, failingFolderId)],
            invitations: [],
        });

        await new SyncService(fakeClient, fakeOnline).pullChanges();

        const entry = await getSearchIndexEntry(noteId);
        expect(entry?.metadata.folderId).toBe(failingFolderId);
    });
});
