/**
 * #263: a sync pass skips notes whose push is backing off (sync_errors.next_retry_at
 * in the future). The pass must report when the earliest such backoff ends, so the
 * caller can schedule a sync then instead of waiting for an unrelated trigger.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { upsertSyncRecord, recordSyncError } from '@/lib/db/queries';
import type { OnlineContextType } from '@/contexts/OnlineContext';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

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

    it('returns no retry time when nothing is waiting on a backoff', async () => {
        await upsertSyncRecord({ localId: NOTE_BACKOFF, entityType: 'note', syncStatus: 'synced' });
        // A stale error for a note that no longer needs pushing must not schedule a sync
        await recordSyncError(NOTE_BACKOFF, 'note', 'push', 'failed');

        const result = await svc.sync();

        expect(result.nextRetryAt).toBeUndefined();
    });
});
