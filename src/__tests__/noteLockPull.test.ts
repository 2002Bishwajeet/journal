/**
 * #1427: a lock or Remove lock made on this device and not pushed yet must survive a pull of a
 * changed server copy, whatever that copy says, or the next push uploads the server's value
 * and the note is unlocked (or re-locked) everywhere.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { EncryptedKeyHeader } from '@homebase-id/js-lib/core';
import * as Y from 'yjs';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { getSearchIndexEntry, getSyncRecord, saveDocumentUpdate, upsertSearchIndex, upsertSyncRecord } from '@/lib/db/queries';
import { serializeKeyHeader } from '@/lib/utils';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';
import type { DocumentMetadata, SyncRecord } from '@/types';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockDsr, mockGetNotePayload, mockUpdateNote } = vi.hoisted(() => ({
    mockDsr: vi.fn(),
    mockGetNotePayload: vi.fn(),
    mockUpdateNote: vi.fn(),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        dsrToContent = mockDsr;
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
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';

const NOTE_ID = '14271427-1427-1427-1427-142714271427';
const KEY_HEADER = { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' } as unknown as EncryptedKeyHeader;
const fakeClient = fakeDotYouClient('sam.dotyou.cloud');
const fakeOnline = fakeOnlineContext();

const META: DocumentMetadata = {
    title: 'Diary',
    folderId: MAIN_FOLDER_ID,
    tags: [],
    timestamps: { created: '2026-11-19T00:00:00.000Z', modified: '2026-11-19T00:00:00.000Z' },
    excludeFromAI: false,
};

function textUpdate(text: string): Uint8Array {
    const d = new Y.Doc();
    d.getText('body').insert(0, text);
    const u = Y.encodeStateAsUpdate(d);
    d.destroy();
    return u;
}
// The server holds what this device holds: no local edit keeps the note pending.
const BODY = textUpdate('Body');

const header = {
    fileId: 'note-file-1',
    sharedSecretEncryptedKeyHeader: KEY_HEADER,
    fileMetadata: { versionTag: 'v2', updated: 1763510400000, appData: { uniqueId: NOTE_ID, groupId: MAIN_FOLDER_ID } },
} as never;

async function seed(locked: boolean, syncStatus: SyncRecord['syncStatus']) {
    await saveDocumentUpdate(NOTE_ID, BODY);
    await upsertSearchIndex({ docId: NOTE_ID, title: META.title, plainTextContent: 'Body', metadata: { ...META, locked } });
    await upsertSyncRecord({
        localId: NOTE_ID, entityType: 'note', syncStatus, remoteFileId: 'note-file-1',
        versionTag: 'v1', contentHash: 'stale', encryptedKeyHeader: serializeKeyHeader(KEY_HEADER),
    } as SyncRecord);
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
    mockGetNotePayload.mockResolvedValue(BODY);
});

describe('a pull keeps an unpushed note lock (#1427)', () => {
    // true: locked here, the server copy says `locked: false` (an earlier Remove lock).
    // false: Remove lock here, the server copy says `locked: true`.
    it.each([true, false])('keeps the local lock (%s) over a changed server copy, and pushes it', async (locked) => {
        await seed(locked, 'pending');
        mockDsr.mockResolvedValue({ title: 'Diary, edited', tags: [], excludeFromAI: false, locked: !locked });

        const svc = new SyncService(fakeClient, fakeOnline);
        await svc.handleRemoteNote(header);

        const entry = await getSearchIndexEntry(NOTE_ID);
        expect(entry?.title).toBe('Diary, edited');
        expect(entry?.metadata.locked).toBe(locked);

        const record = (await getSyncRecord(NOTE_ID))!;
        expect(record).toMatchObject({ versionTag: 'v2', syncStatus: 'pending' });
        mockUpdateNote.mockResolvedValue({ versionTag: 'v3' });
        await svc.pushNote(record);
        expect(mockUpdateNote).toHaveBeenCalledTimes(1);
        expect((mockUpdateNote.mock.calls[0][3] as DocumentMetadata).locked).toBe(locked);
    });

    it.each([true, false])('takes the server lock (%s) for a synced note', async (locked) => {
        await seed(!locked, 'synced');
        mockDsr.mockResolvedValue({ title: 'Diary', tags: [], excludeFromAI: false, locked });

        await new SyncService(fakeClient, fakeOnline).handleRemoteNote(header);

        expect((await getSearchIndexEntry(NOTE_ID))?.metadata.locked).toBe(locked);
        expect((await getSyncRecord(NOTE_ID))?.syncStatus).toBe('synced');
    });
});
