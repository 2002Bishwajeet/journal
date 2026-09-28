/**
 * #257: a push version conflict must merge only the Yjs content and keep the
 * server's current folder (groupId). Re-sending the locally captured folderId
 * would move the note back into a folder a collaborator moved it out of — and a
 * later group-delete of that old folder would then delete the note with it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { EncryptedKeyHeader } from '@homebase-id/js-lib/core';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    saveDocumentUpdate, upsertSyncRecord, getSyncRecord, upsertSearchIndex, getSearchIndexEntry, createFolder,
} from '@/lib/db/queries';
import { serializeKeyHeader } from '@/lib/utils';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';
import type { DocumentMetadata, SyncRecord } from '@/types';
import * as Y from 'yjs';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockGetNote, mockGetNotePayload, mockUpdateNote } = vi.hoisted(() => ({
    mockGetNote: vi.fn(),
    mockGetNotePayload: vi.fn(),
    mockUpdateNote: vi.fn(),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        getNote = mockGetNote;
        getNotePayload = mockGetNotePayload;
        updateNote = mockUpdateNote;
        constructor() {}
    },
}));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider { constructor() {} },
}));
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor { constructor() {} },
}));

import { SyncService } from '@/lib/homebase/SyncService';

const DOC_ID = '11111111-1111-1111-1111-111111111111';
const FOLDER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FOLDER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const fakeClient = fakeDotYouClient('sam.dotyou.cloud');
const fakeOnline = fakeOnlineContext();
const KEY_HEADER = { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' } as unknown as EncryptedKeyHeader;

function textUpdate(text: string): Uint8Array {
    const d = new Y.Doc();
    d.getText('body').insert(0, text);
    const u = Y.encodeStateAsUpdate(d);
    d.destroy();
    return u;
}

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
    svc = new SyncService(fakeClient, fakeOnline);

    const metadata = { title: 'Note', folderId: FOLDER_A, tags: [] } as unknown as DocumentMetadata;
    await saveDocumentUpdate(DOC_ID, textUpdate('Local'));
    await upsertSearchIndex({ docId: DOC_ID, title: 'Note', plainTextContent: 'Local', metadata });
    // Folder B is a real folder a collaborator moved the note into (#259: it must exist
    // locally, or the conflict resolution would now treat it as orphaned and fall back to Main)
    await createFolder(FOLDER_B, 'Folder B');
    await upsertSyncRecord({
        localId: DOC_ID, entityType: 'note', syncStatus: 'pending', remoteFileId: 'file-1',
        versionTag: 'v1', contentHash: 'stale', encryptedKeyHeader: serializeKeyHeader(KEY_HEADER),
    } as SyncRecord);

    // A collaborator moved the note to folder B since our last sync
    mockGetNote.mockResolvedValue({
        fileId: 'file-1',
        sharedSecretEncryptedKeyHeader: KEY_HEADER,
        fileMetadata: { versionTag: 'v-remote', updated: 1700000002000, appData: { groupId: FOLDER_B } },
    });
    mockGetNotePayload.mockResolvedValue(textUpdate('Remote'));
});

/** Outer updateNote call hits a version conflict; the retry inside the callback succeeds. */
function conflictOnFirstCall() {
    mockUpdateNote.mockImplementation(async (...args: unknown[]) => {
        const options = args[8] as { onVersionConflict?: () => Promise<unknown> } | undefined;
        if (options?.onVersionConflict) return await options.onVersionConflict();
        return { versionTag: 'v-merged' };
    });
}

describe('SyncService.pushNote folder on version conflict (#257)', () => {
    it('keeps the server folder (groupId) for the conflict retry, not the stale local one', async () => {
        conflictOnFirstCall();

        await svc.pushNote((await getSyncRecord(DOC_ID))!);

        expect(mockUpdateNote).toHaveBeenCalledTimes(2);
        expect((mockUpdateNote.mock.calls[1][3] as DocumentMetadata).folderId).toBe(FOLDER_B);
    });

    it('does not move the note back to the stale folder on the next push', async () => {
        conflictOnFirstCall();
        await svc.pushNote((await getSyncRecord(DOC_ID))!);

        expect((await getSearchIndexEntry(DOC_ID))?.metadata.folderId).toBe(FOLDER_B);
        mockUpdateNote.mockClear();
        await svc.pushNote((await getSyncRecord(DOC_ID))!);
        expect(mockUpdateNote).not.toHaveBeenCalled();
    });

    it('does not overwrite a local folder change made while the retry was in flight', async () => {
        const FOLDER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
        mockUpdateNote.mockImplementation(async (...args: unknown[]) => {
            const options = args[8] as { onVersionConflict?: () => Promise<unknown> } | undefined;
            if (options?.onVersionConflict) return await options.onVersionConflict();
            const entry = (await getSearchIndexEntry(DOC_ID))!;
            await upsertSearchIndex({ ...entry, metadata: { ...entry.metadata, folderId: FOLDER_C } });
            return { versionTag: 'v-merged' };
        });

        await svc.pushNote((await getSyncRecord(DOC_ID))!);

        expect((await getSearchIndexEntry(DOC_ID))?.metadata.folderId).toBe(FOLDER_C);
    });

    it('sends the local folderId when there is no conflict', async () => {
        mockUpdateNote.mockResolvedValue({ versionTag: 'v2' });

        await svc.pushNote((await getSyncRecord(DOC_ID))!);

        expect(mockUpdateNote).toHaveBeenCalledTimes(1);
        expect((mockUpdateNote.mock.calls[0][3] as DocumentMetadata).folderId).toBe(FOLDER_A);
        expect(mockGetNote).not.toHaveBeenCalled();
    });

    it('falls back to Main when the conflict retry groupId has no local folder row (#259)', async () => {
        const ORPHAN_FOLDER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
        // The freshly re-fetched remote file points at a folder that was deleted
        // (pre-#254 bug) and never existed locally in this test's fixtures.
        mockGetNote.mockResolvedValue({
            fileId: 'file-1',
            sharedSecretEncryptedKeyHeader: KEY_HEADER,
            fileMetadata: { versionTag: 'v-remote', updated: 1700000002000, appData: { groupId: ORPHAN_FOLDER } },
        });
        conflictOnFirstCall();

        await svc.pushNote((await getSyncRecord(DOC_ID))!);

        expect((mockUpdateNote.mock.calls[1][3] as DocumentMetadata).folderId).toBe(MAIN_FOLDER_ID);
        expect((await getSearchIndexEntry(DOC_ID))?.metadata.folderId).toBe(MAIN_FOLDER_ID);
    });
});
