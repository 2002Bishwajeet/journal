import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import {
    upsertSyncRecord, savePendingImageUpload, getImageUploadsReadyForRetry, getPendingSyncCount,
    getEntityIdsInBackoff, recordSyncError, clearRetryBackoff, getPendingSyncItems,
    discardPendingImageUploads, getPendingImageUpload, getNextImageRetryAt,
} from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';
import { describeSyncError } from '@/lib/homebase/sync/syncErrorInfo';
import { explainSyncError } from '@/lib/diagnostics/report';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockAddImageToNote } = vi.hoisted(() => ({ mockAddImageToNote: vi.fn() }));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        addImageToNote = mockAddImageToNote;
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
const UPLOAD_ID = '22222222-2222-2222-2222-222222222222';

/** What the SDK throws for a refused request: an AxiosError with Homebase's JSON body. */
function httpError(status: number, data?: unknown): Error {
    return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
}

const PAYLOAD_LIMIT = httpError(400, {
    title: 'Too many Payloads count 26 in FileMetadata max 25',
    status: 400,
    errorCode: 'unhandledScenario',
});

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

describe('describeSyncError (#874)', () => {
    it("reads Homebase's errorCode and title from a 400 and calls it permanent", () => {
        expect(describeSyncError(PAYLOAD_LIMIT)).toEqual({
            message: 'HTTP 400: Too many Payloads count 26 in FileMetadata max 25',
            status: 400,
            code: 'unhandledScenario',
            permanent: true,
        });
    });

    it('keeps the Axios message when the body has no title', () => {
        expect(describeSyncError(httpError(404))).toMatchObject({
            message: 'Request failed with status code 404', status: 404, permanent: true,
        });
    });

    it('retries sign-in, timeout and rate-limit 4xx, a version conflict, 5xx and network errors', () => {
        for (const status of [401, 408, 429, 500, 503]) expect(describeSyncError(httpError(status)).permanent).toBe(false);
        expect(describeSyncError(httpError(400, { errorCode: 'versionTagMismatch' })).permanent).toBe(false);
        expect(describeSyncError(new Error('Network Error'))).toEqual({
            message: 'Network Error', status: undefined, code: undefined, permanent: false,
        });
    });

    it('explains the 25-payload limit in plain words', () => {
        const { message, code } = describeSyncError(PAYLOAD_LIMIT);
        expect(explainSyncError({ message, code: code ?? null, operation: 'upload' })).toEqual({
            plain: expect.stringContaining('more images than your Homebase allows'),
            code: 'unhandledScenario',
        });
    });
});

describe('image uploads that fail (#874)', () => {
    let svc: SyncService;
    let errorLog: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        await upsertSyncRecord({
            localId: DOC_ID, entityType: 'note', remoteFileId: 'remote-file-1', versionTag: 'v1',
            lastSyncedAt: new Date().toISOString(), syncStatus: 'synced',
        });
        await savePendingImageUpload({
            id: UPLOAD_ID, noteDocId: DOC_ID, blobData: new Uint8Array([1, 2, 3]), contentType: 'image/png',
            status: 'pending', retryCount: 0, createdAt: new Date().toISOString(),
        });
        svc = new SyncService(fakeDotYouClient('sam.dotyou.cloud'), fakeOnlineContext());
    });

    async function errorRow() {
        const r = await db.query<{ error_message: string; error_code: string | null; permanent: boolean; next_retry_at: Date | null }>(
            'SELECT error_message, error_code, permanent, next_retry_at FROM sync_errors WHERE entity_id = $1 AND resolved_at IS NULL',
            [UPLOAD_ID]);
        return r.rows[0];
    }

    it('stops retrying on a 4xx, keeps the server reason and counts it as failed, not waiting', async () => {
        mockAddImageToNote.mockRejectedValue(PAYLOAD_LIMIT);

        await svc.processPendingImageUploads();

        expect((await getPendingImageUpload(UPLOAD_ID))?.status).toBe('failed_permanent');
        expect(await errorRow()).toMatchObject({
            error_message: 'HTTP 400: Too many Payloads count 26 in FileMetadata max 25',
            error_code: 'unhandledScenario',
            permanent: true,
            next_retry_at: null,
        });
        expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(
            `upload of image ${UPLOAD_ID} failed (unhandledScenario): HTTP 400: Too many Payloads count 26 in FileMetadata max 25; not retrying`));
        expect(await getPendingSyncCount()).toEqual({ notes: 0, folders: 0, images: 0, failed: 1 });
        expect(await getNextImageRetryAt()).toBeUndefined();

        // The retry loop is over: later syncs never send it again
        await svc.processPendingImageUploads();
        expect(mockAddImageToNote).toHaveBeenCalledTimes(1);
        expect(await getImageUploadsReadyForRetry()).toEqual([]);

        const [item] = await getPendingSyncItems();
        expect(item).toMatchObject({ kind: 'image', status: 'failed', error: { code: 'unhandledScenario' } });
    });

    it('backs off on a 5xx and keeps it waiting', async () => {
        mockAddImageToNote.mockRejectedValue(httpError(503));

        await svc.processPendingImageUploads();

        expect((await getPendingImageUpload(UPLOAD_ID))?.status).toBe('failed');
        const row = await errorRow();
        expect(row.permanent).toBe(false);
        expect(await getPendingSyncCount()).toEqual({ notes: 0, folders: 0, images: 1, failed: 0 });
        // Not due again until the backoff ends
        expect(await getNextImageRetryAt()).toBeGreaterThan(Date.now());
        await svc.processPendingImageUploads();
        expect(mockAddImageToNote).toHaveBeenCalledTimes(1);
    });

    it('backs off on a network error', async () => {
        mockAddImageToNote.mockRejectedValue(new Error('Network Error'));
        await svc.processPendingImageUploads();
        expect((await getPendingImageUpload(UPLOAD_ID))?.status).toBe('failed');
        expect(await getNextImageRetryAt()).toBeGreaterThan(Date.now());
    });

    it('Retry puts a given-up image back in the queue and it uploads', async () => {
        mockAddImageToNote.mockRejectedValueOnce(PAYLOAD_LIMIT);
        await svc.processPendingImageUploads();

        await clearRetryBackoff();
        expect(await getPendingSyncCount()).toMatchObject({ images: 1, failed: 0 });
        expect((await getImageUploadsReadyForRetry()).map((u) => u.id)).toEqual([UPLOAD_ID]);
    });

    it('Discard keeps the bytes for this device but drops it from the queue, the counts and Diagnostics', async () => {
        mockAddImageToNote.mockRejectedValue(PAYLOAD_LIMIT);
        await svc.processPendingImageUploads();

        await discardPendingImageUploads([UPLOAD_ID]);

        const row = await getPendingImageUpload(UPLOAD_ID);
        expect(row?.status).toBe('discarded');
        expect(row?.blobData).toEqual(new Uint8Array([1, 2, 3]));
        expect(await errorRow()).toBeUndefined();
        expect(await getPendingSyncCount()).toEqual({ notes: 0, folders: 0, images: 0, failed: 0 });
        expect(await getPendingSyncItems()).toEqual([]);
        // Retry all leaves a discarded image alone
        await clearRetryBackoff();
        expect(await getImageUploadsReadyForRetry()).toEqual([]);
    });
});

describe('note pushes that fail with a 4xx (#874)', () => {
    beforeEach(async () => {
        await resetTestDatabase();
        await upsertSyncRecord({ localId: DOC_ID, entityType: 'note', syncStatus: 'pending' });
    });

    it('are left out of automatic retries and counted as failed until the user retries', async () => {
        await recordSyncError(DOC_ID, 'note', 'push', 'HTTP 400: bad', { code: 'invalidUpload', permanent: true });

        expect(await getEntityIdsInBackoff('push')).toEqual(new Set([DOC_ID]));
        expect(await getPendingSyncCount()).toEqual({ notes: 0, folders: 0, images: 0, failed: 1 });
        expect((await getPendingSyncItems())[0]).toMatchObject({ status: 'failed', nextRetryAt: null, error: { code: 'invalidUpload' } });

        await clearRetryBackoff(DOC_ID);
        expect(await getEntityIdsInBackoff('push')).toEqual(new Set());
        expect(await getPendingSyncCount()).toMatchObject({ notes: 1, failed: 0 });
    });

    it('a transient failure still backs off and stays waiting', async () => {
        await recordSyncError(DOC_ID, 'note', 'push', 'HTTP 503: down');
        expect(await getEntityIdsInBackoff('push')).toEqual(new Set([DOC_ID]));
        expect(await getPendingSyncCount()).toMatchObject({ notes: 1, failed: 0 });
    });
});
