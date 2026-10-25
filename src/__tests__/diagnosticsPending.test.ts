/**
 * Settings → Diagnostics (#800): the pending list joins sync_records, sync_errors,
 * the note and folder names, and the image upload queue, against a real PGlite.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

import {
    upsertSearchIndex, upsertSyncRecord, createFolder, recordSyncError, resolveSyncErrorsForEntity,
    savePendingImageUpload, getPendingSyncCount, getPendingSyncItems, clearRetryBackoff,
    derivePendingStatus, getDatabaseInfo,
} from '@/lib/db/queries';

const NOTE_OK = '11111111-1111-4111-8111-111111111111';
const NOTE_FAILING = '22222222-2222-4222-8222-222222222222';
const NOTE_DELETED = '33333333-3333-4333-8333-333333333333';
const NOTE_SYNCED = '44444444-4444-4444-8444-444444444444';
const FOLDER = '55555555-5555-4555-8555-555555555555';
const IMAGE = '66666666-6666-4666-8666-666666666666';
const FOLDER_ID_OF_NOTES = '77777777-7777-4777-8777-777777777777';

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

async function addNote(docId: string, title: string) {
    await upsertSearchIndex({
        docId,
        title,
        plainTextContent: 'secret body text',
        metadata: {
            title,
            folderId: FOLDER_ID_OF_NOTES,
            timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
            excludeFromAI: false,
        },
    });
}

describe('getPendingSyncItems', () => {
    beforeEach(async () => {
        await resetTestDatabase();
        await addNote(NOTE_OK, 'Fine note');
        await addNote(NOTE_FAILING, 'Failing note');
        await addNote(NOTE_SYNCED, 'Already synced');
        await createFolder(FOLDER, 'Work');
        await upsertSyncRecord({ localId: NOTE_OK, entityType: 'note', syncStatus: 'pending' });
        await upsertSyncRecord({ localId: NOTE_FAILING, entityType: 'note', syncStatus: 'pending' });
        await upsertSyncRecord({ localId: NOTE_SYNCED, entityType: 'note', syncStatus: 'synced', remoteFileId: 'r1' });
        await upsertSyncRecord({ localId: NOTE_DELETED, entityType: 'note', syncStatus: 'pending_delete', remoteFileId: 'r2' });
        await upsertSyncRecord({ localId: FOLDER, entityType: 'folder', syncStatus: 'pending' });
        await savePendingImageUpload({
            id: IMAGE,
            noteDocId: NOTE_OK,
            blobData: new Uint8Array([1, 2, 3]),
            contentType: 'image/png',
            status: 'pending',
            retryCount: 0,
            createdAt: new Date().toISOString(),
        });
    });

    it('lists exactly what the sync badge counts, with titles, kinds and open targets', async () => {
        const items = await getPendingSyncItems();
        const counts = await getPendingSyncCount();
        expect(items).toHaveLength(counts.notes + counts.folders + counts.images);
        expect(items.map((i) => i.id)).not.toContain(NOTE_SYNCED);

        const byId = Object.fromEntries(items.map((i) => [i.id, i]));
        expect(byId[NOTE_OK]).toMatchObject({ kind: 'note', title: 'Fine note', noteId: NOTE_OK, folderId: FOLDER_ID_OF_NOTES, status: 'pending', isDelete: false, error: null });
        expect(byId[FOLDER]).toMatchObject({ kind: 'folder', title: 'Work', noteId: null });
        expect(byId[NOTE_DELETED]).toMatchObject({ kind: 'note', isDelete: true, title: null, noteId: null });
        expect(byId[IMAGE]).toMatchObject({ kind: 'image', title: 'Fine note', noteId: NOTE_OK, contentType: 'image/png', status: 'pending' });
    });

    it('never carries note content or image bytes', async () => {
        expect(JSON.stringify(await getPendingSyncItems())).not.toContain('secret body text');
    });

    it('joins the newest unresolved error and reports the retry schedule', async () => {
        await recordSyncError(NOTE_FAILING, 'note', 'push', 'first failure');
        await recordSyncError(NOTE_FAILING, 'note', 'push', 'Request failed with status code 403');

        const failing = (await getPendingSyncItems()).find((i) => i.id === NOTE_FAILING)!;
        expect(failing.error).toMatchObject({ message: 'Request failed with status code 403', operation: 'push' });
        expect(failing.retryCount).toBe(2);
        expect(failing.nextRetryAt).not.toBeNull();
        expect(failing.status).toBe('retrying');
    });

    it('ignores a resolved error', async () => {
        await recordSyncError(NOTE_FAILING, 'note', 'push', 'old failure');
        await resolveSyncErrorsForEntity(NOTE_FAILING);

        const failing = (await getPendingSyncItems()).find((i) => i.id === NOTE_FAILING)!;
        expect(failing.error).toBeNull();
        expect(failing.status).toBe('pending');
    });

    it('puts failing items first and shows an image given up on as failed', async () => {
        await recordSyncError(FOLDER, 'folder', 'push', 'Network Error');
        await db.query(`UPDATE pending_image_uploads SET status = 'failed_permanent', retry_count = 6 WHERE id = $1`, [IMAGE]);

        const items = await getPendingSyncItems();
        expect(items[0].id).toBe(FOLDER);
        const image = items.find((i) => i.id === IMAGE)!;
        expect(image).toMatchObject({ status: 'failed', retryCount: 6 });
    });

    it('clearRetryBackoff makes failed items due now, for one entity or all', async () => {
        await recordSyncError(NOTE_FAILING, 'note', 'push', 'boom');
        await recordSyncError(FOLDER, 'folder', 'push', 'boom');

        await clearRetryBackoff(NOTE_FAILING);
        let items = await getPendingSyncItems();
        expect(items.find((i) => i.id === NOTE_FAILING)).toMatchObject({ nextRetryAt: null, status: 'failed' });
        expect(items.find((i) => i.id === FOLDER)!.nextRetryAt).not.toBeNull();

        await clearRetryBackoff();
        items = await getPendingSyncItems();
        expect(items.find((i) => i.id === FOLDER)!.nextRetryAt).toBeNull();
    });
});

describe('derivePendingStatus', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const later = '2026-01-01T00:05:00.000Z';
    const earlier = '2025-12-31T23:55:00.000Z';

    it('is pending before any failure', () => {
        expect(derivePendingStatus({ givenUp: false, hasError: false, retryCount: 0, nextRetryAt: null }, now)).toBe('pending');
    });

    it('is retrying while a retry is scheduled', () => {
        expect(derivePendingStatus({ givenUp: false, hasError: true, retryCount: 2, nextRetryAt: later }, now)).toBe('retrying');
    });

    it('is failed once it errored with no retry scheduled', () => {
        expect(derivePendingStatus({ givenUp: false, hasError: true, retryCount: 2, nextRetryAt: null }, now)).toBe('failed');
        expect(derivePendingStatus({ givenUp: false, hasError: true, retryCount: 2, nextRetryAt: earlier }, now)).toBe('failed');
    });

    it('is failed when given up on, whatever the schedule', () => {
        expect(derivePendingStatus({ givenUp: true, hasError: false, retryCount: 6, nextRetryAt: later }, now)).toBe('failed');
    });
});

describe('getDatabaseInfo', () => {
    it('reports the engine and size', async () => {
        const info = await getDatabaseInfo();
        expect(info.engine).toMatch(/^PostgreSQL \d+/);
        expect(info.sizeBytes).toBeGreaterThan(0);
    });
});
