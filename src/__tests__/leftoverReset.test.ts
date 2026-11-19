/**
 * The plain database an older desktop build left (#1362): what counts as an unsynced change
 * there (against a real PGlite), and when a sync counts as having failed to send them, which
 * shows the reset prompt.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

import { upsertSearchIndex, upsertSyncRecord, createFolder, savePendingImageUpload, countUnsyncedChanges } from '@/lib/db/queries';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { leftoverPushFailed } from '@/hooks/useLeftoverReset';
import type { SyncResult } from '@/lib/homebase/SyncService';

const NOTE = '11111111-1111-4111-8111-111111111111';
const NOTE_WITHOUT_RECORD = '22222222-2222-4222-8222-222222222222';
const FOLDER = '55555555-5555-4555-8555-555555555555';

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

async function addNote(docId: string) {
    await upsertSearchIndex({
        docId,
        title: 'A note',
        plainTextContent: 'body',
        metadata: {
            title: 'A note',
            folderId: MAIN_FOLDER_ID,
            timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
            excludeFromAI: false,
        },
    });
}

describe('countUnsyncedChanges', () => {
    beforeEach(async () => {
        await resetTestDatabase();
        await addNote(NOTE);
        await createFolder(FOLDER, 'Work');
        for (const [localId, entityType] of [[NOTE, 'note'], [FOLDER, 'folder'], [MAIN_FOLDER_ID, 'folder']] as const) {
            await upsertSyncRecord({ localId, entityType, syncStatus: 'synced', remoteFileId: `r-${localId}` });
        }
    });

    it('finds nothing when every note, folder and image has synced', async () => {
        expect(await countUnsyncedChanges(db)).toBe(0);
    });

    it('counts pending notes and folders, notes without a sync record and images not uploaded', async () => {
        await upsertSyncRecord({ localId: NOTE, entityType: 'note', syncStatus: 'pending' });
        await upsertSyncRecord({ localId: FOLDER, entityType: 'folder', syncStatus: 'pending_delete', remoteFileId: 'r' });
        await addNote(NOTE_WITHOUT_RECORD);
        await savePendingImageUpload({
            id: '66666666-6666-4666-8666-666666666666',
            noteDocId: NOTE,
            blobData: new Uint8Array([1]),
            contentType: 'image/png',
            // Sync stopped retrying it: still not on Homebase.
            status: 'failed_permanent',
            retryCount: 5,
            createdAt: new Date().toISOString(),
        });

        expect(await countUnsyncedChanges(db)).toBe(4);
    });
});

describe('leftoverPushFailed', () => {
    const pending = (total: number, failed = 0) => ({ notes: total, folders: 0, images: 0, total, failed });
    const result = (errors: string[] = [], failed = false): SyncResult => ({
        pulled: { folders: 0, notes: 0 },
        pushed: { folders: 0, notes: 0 },
        errors,
        failed,
    });

    it.each([
        ['a sync that failed with changes left', { syncStatus: 'error' as const, lastSyncResult: null, pendingCount: pending(2) }, true],
        ['a sync with push errors', { syncStatus: 'idle' as const, lastSyncResult: result(['push failed']), pendingCount: pending(2) }, true],
        ['a sync that stopped retrying a change', { syncStatus: 'idle' as const, lastSyncResult: result(), pendingCount: pending(0, 1) }, true],
        ['a sync that sent everything', { syncStatus: 'idle' as const, lastSyncResult: result(), pendingCount: pending(0) }, false],
        ['a failed sync with nothing left to send', { syncStatus: 'error' as const, lastSyncResult: result([], true), pendingCount: pending(0) }, false],
        ['a sync still running', { syncStatus: 'syncing' as const, lastSyncResult: result(['push failed']), pendingCount: pending(2) }, false],
        ['no sync yet (offline)', { syncStatus: 'idle' as const, lastSyncResult: null, pendingCount: pending(2) }, false],
        ['an edit made during a clean sync', { syncStatus: 'idle' as const, lastSyncResult: result(), pendingCount: pending(1) }, false],
    ])('%s: %s', (_name, state, expected) => {
        expect(leftoverPushFailed(state)).toBe(expected);
    });
});
