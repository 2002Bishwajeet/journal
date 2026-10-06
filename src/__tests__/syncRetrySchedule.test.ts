/**
 * #263: a sync pass skips notes whose push is backing off (sync_errors.next_retry_at
 * in the future). The pass must report when the earliest such backoff ends, so the
 * caller can schedule a sync then instead of waiting for an unrelated trigger.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { upsertSyncRecord, recordSyncError, savePendingImageUpload, updateImageRetryAt } from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockProcessChanges } = vi.hoisted(() => ({ mockProcessChanges: vi.fn() }));
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor {
        processChanges = mockProcessChanges;
        getCurrentSyncTime = () => Date.now();
        constructor() {}
    },
}));

import { SyncService } from '@/lib/homebase/SyncService';

const NOTE_BACKOFF = '66666666-6666-6666-6666-666666666666';
const NOTE_LATER = '77777777-7777-7777-7777-777777777777';
const fakeClient = fakeDotYouClient();
const fakeOnline = fakeOnlineContext();

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

let svc: SyncService;
beforeEach(async () => {
    await resetTestDatabase();
    vi.restoreAllMocks();
    mockProcessChanges.mockResolvedValue({ folders: [], notes: [], invitations: [] });
    svc = new SyncService(fakeClient, fakeOnline);
    vi.spyOn(svc, 'pushNote').mockResolvedValue(undefined);
});

async function nextRetryAtOf(entityId: string): Promise<number> {
    const { rows } = await db.query<{ next_retry_at: string | Date }>(
        'SELECT next_retry_at FROM sync_errors WHERE entity_id = $1', [entityId]);
    return new Date(rows[0].next_retry_at).getTime();
}

describe('sync reports when skipped pushes can be retried (#263)', () => {
    it('returns the earliest next_retry_at of a pending note skipped for backoff', async () => {
        await upsertSyncRecord({ localId: NOTE_BACKOFF, entityType: 'note', syncStatus: 'pending' });
        await upsertSyncRecord({ localId: NOTE_LATER, entityType: 'note', syncStatus: 'pending' });
        await recordSyncError(NOTE_BACKOFF, 'note', 'push', 'failed');
        await recordSyncError(NOTE_LATER, 'note', 'push', 'failed');
        await recordSyncError(NOTE_LATER, 'note', 'push', 'failed again'); // longer backoff

        const result = await svc.sync();

        expect(svc.pushNote).not.toHaveBeenCalled(); // both skipped
        expect(result.nextRetryAt).toBe(await nextRetryAtOf(NOTE_BACKOFF));
    });

    it('returns when a failed image upload can be retried, so it retries without an edit (#374)', async () => {
        await upsertSyncRecord({ localId: NOTE_BACKOFF, entityType: 'note', syncStatus: 'synced' });
        await savePendingImageUpload({
            id: NOTE_LATER, noteDocId: NOTE_BACKOFF, blobData: new Uint8Array([1]), contentType: 'image/png',
            status: 'failed', retryCount: 1, createdAt: new Date().toISOString(),
        });
        const retryAt = new Date(Date.now() + 10_000);
        await updateImageRetryAt(NOTE_LATER, retryAt);

        const result = await svc.sync();

        expect(result.nextRetryAt).toBe(retryAt.getTime());
    });

    it('returns no retry time when nothing is waiting on a backoff', async () => {
        await upsertSyncRecord({ localId: NOTE_BACKOFF, entityType: 'note', syncStatus: 'synced' });
        // A stale error for a note that no longer needs pushing must not schedule a sync
        await recordSyncError(NOTE_BACKOFF, 'note', 'push', 'failed');

        const result = await svc.sync();

        expect(result.nextRetryAt).toBeUndefined();
    });
});
