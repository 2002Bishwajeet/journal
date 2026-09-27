/**
 * #265: a note delete that fails to reach the server must not silently look like
 * it succeeded. The local delete still happens right away, but the note's sync
 * record is kept as 'pending_delete' and the remote delete is retried on every
 * sync until it succeeds (mirrors #258 for folders).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    upsertSyncRecord, getSyncRecord, upsertSearchIndex, getSearchIndexEntry,
    deleteSearchIndexEntry, deleteDocumentUpdates, getUnresolvedSyncErrors, getPendingSyncCount,
} from '@/lib/db/queries';
import type { OnlineContextType } from '@/contexts/OnlineContext';
import type { DocumentMetadata } from '@/types';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

const { mockDeleteFile, mockProcessChanges } = vi.hoisted(() => ({
    mockDeleteFile: vi.fn(),
    mockProcessChanges: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return { ...actual, deleteFile: mockDeleteFile };
});
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor {
        processChanges = mockProcessChanges;
        getCurrentSyncTime = () => Date.now();
        constructor() {}
    },
}));

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { SyncService } from '@/lib/homebase/SyncService';

const NOTE_ID = '55555555-5555-5555-5555-555555555555';
const fakeClient = { getHostIdentity: () => 'me.dotyou.cloud' } as unknown as DotYouClient;
const fakeOnline = { isOnline: true } as unknown as OnlineContextType;

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

let svc: SyncService;
beforeEach(async () => {
    await resetTestDatabase();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockDeleteFile.mockResolvedValue(true);
    mockProcessChanges.mockResolvedValue({ folders: [], notes: [], invitations: [] });
    svc = new SyncService(fakeClient, fakeOnline);
    await upsertSearchIndex({ docId: NOTE_ID, title: 'Doomed', plainTextContent: '', metadata: { title: 'Doomed', folderId: 'main', tags: [] } as unknown as DocumentMetadata });
    await upsertSyncRecord({ localId: NOTE_ID, entityType: 'note', syncStatus: 'synced', remoteFileId: 'file-1', versionTag: 'v1' });
});

/** What useNotes.deleteNoteMutation does: remote delete, then the local delete. */
async function deleteNoteLikeTheUi() {
    await svc.deleteNoteRemote(NOTE_ID);
    await Promise.all([deleteSearchIndexEntry(NOTE_ID), deleteDocumentUpdates(NOTE_ID)]);
}

/** Let the next sync retry right away instead of waiting out the push backoff. */
async function expireBackoff() {
    await db.query(`UPDATE sync_errors SET next_retry_at = CURRENT_TIMESTAMP - INTERVAL '1 second'`);
}

describe('note delete when the server delete fails (#265)', () => {
    it('removes the local note and its sync record when the remote delete succeeds', async () => {
        await deleteNoteLikeTheUi();

        expect(mockDeleteFile).toHaveBeenCalledWith(fakeClient, expect.anything(), 'file-1');
        expect(await getSearchIndexEntry(NOTE_ID)).toBeNull();
        expect(await getSyncRecord(NOTE_ID)).toBeNull();
    });

    it('keeps a pending-delete record through the local delete, retries it on sync and clears it on success', async () => {
        mockDeleteFile.mockRejectedValueOnce(new Error('offline'));

        await deleteNoteLikeTheUi();

        expect(await getSearchIndexEntry(NOTE_ID)).toBeNull(); // local delete still happened
        const pending = await getSyncRecord(NOTE_ID);
        expect(pending?.syncStatus).toBe('pending_delete');
        expect(pending?.remoteFileId).toBe('file-1');
        expect((await getUnresolvedSyncErrors()).map(e => e.entityId)).toContain(NOTE_ID);
        expect((await getPendingSyncCount()).notes).toBe(1);

        await expireBackoff();
        mockDeleteFile.mockClear();
        const result = await svc.sync();

        expect(result.errors).toEqual([]);
        expect(mockDeleteFile).toHaveBeenCalledWith(fakeClient, expect.anything(), 'file-1');
        expect(await getSyncRecord(NOTE_ID)).toBeNull();
        expect(await getUnresolvedSyncErrors()).toEqual([]);
    });

    it('never clears the pending-delete record while the remote delete keeps failing', async () => {
        mockDeleteFile.mockRejectedValue(new Error('500'));

        await deleteNoteLikeTheUi();
        for (let i = 0; i < 2; i++) {
            await expireBackoff();
            mockDeleteFile.mockClear();
            await svc.sync();
            expect(mockDeleteFile).toHaveBeenCalledTimes(1);
            expect((await getSyncRecord(NOTE_ID))?.syncStatus).toBe('pending_delete');
        }
    });

    it('does not resurrect a pending-delete note when the pull sees it again', async () => {
        mockDeleteFile.mockRejectedValue(new Error('offline'));
        await deleteNoteLikeTheUi();
        vi.spyOn(NotesDriveProvider.prototype, 'dsrToNoteFileContent').mockResolvedValue({ title: 'Doomed' } as never);
        const payloadSpy = vi.spyOn(NotesDriveProvider.prototype, 'getNotePayload').mockResolvedValue(undefined as never);

        await svc.handleRemoteNote({
            fileId: 'file-1',
            fileMetadata: { versionTag: 'v2', updated: 1700000000000, appData: { uniqueId: NOTE_ID, groupId: 'main' } },
        } as never);

        expect(payloadSpy).not.toHaveBeenCalled();
        expect(await getSearchIndexEntry(NOTE_ID)).toBeNull();
        expect((await getSyncRecord(NOTE_ID))?.syncStatus).toBe('pending_delete');
    });
});
