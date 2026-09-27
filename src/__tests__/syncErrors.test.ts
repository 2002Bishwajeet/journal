/**
 * sync_errors upsert-with-backoff tests (#146).
 *
 * Tests the real recordSyncError / getEntityIdsInBackoff / resolveSyncErrorsForEntity
 * functions from queries.ts against a real PGlite test DB, plus the
 * SYNC_ERRORS_ACTIVE_INDEX_SQL dedupe migration.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

import { recordSyncError, getEntityIdsInBackoff, resolveSyncErrorsForEntity, getUnresolvedSyncErrors } from '@/lib/db/queries';
import { SYNC_ERRORS_ACTIVE_INDEX_SQL } from '@/lib/db/syncErrorsSchema';

const ENTITY_ID = '22222222-2222-2222-2222-222222222222';

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

describe('recordSyncError upsert with backoff', () => {
    beforeEach(async () => {
        await resetTestDatabase();
    });

    it('collapses repeated failures for the same entity/operation into one unresolved row', async () => {
        await recordSyncError(ENTITY_ID, 'note', 'push', 'first failure');
        await recordSyncError(ENTITY_ID, 'note', 'push', 'second failure');
        await recordSyncError(ENTITY_ID, 'note', 'push', 'third failure');

        const unresolved = await getUnresolvedSyncErrors();
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0].retryCount).toBe(3);
        expect(unresolved[0].errorMessage).toBe('third failure');
    });

    it('next_retry_at strictly increases across repeated failures', async () => {
        await recordSyncError(ENTITY_ID, 'note', 'push', 'fail 1');
        const after1 = (await getUnresolvedSyncErrors())[0].nextRetryAt!;
        await recordSyncError(ENTITY_ID, 'note', 'push', 'fail 2');
        const after2 = (await getUnresolvedSyncErrors())[0].nextRetryAt!;
        await recordSyncError(ENTITY_ID, 'note', 'push', 'fail 3');
        const after3 = (await getUnresolvedSyncErrors())[0].nextRetryAt!;

        expect(new Date(after2).getTime()).toBeGreaterThan(new Date(after1).getTime());
        expect(new Date(after3).getTime()).toBeGreaterThan(new Date(after2).getTime());
    });

    it('starts a fresh row with retry_count 1 once the previous error is resolved', async () => {
        await recordSyncError(ENTITY_ID, 'note', 'push', 'fail 1');
        await recordSyncError(ENTITY_ID, 'note', 'push', 'fail 2');
        await resolveSyncErrorsForEntity(ENTITY_ID);

        await recordSyncError(ENTITY_ID, 'note', 'push', 'fail again');

        const unresolved = await getUnresolvedSyncErrors();
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0].retryCount).toBe(1);
    });

    it('getEntityIdsInBackoff includes the id right after a failure and excludes it once next_retry_at has passed', async () => {
        await recordSyncError(ENTITY_ID, 'note', 'push', 'failure');

        let inBackoff = await getEntityIdsInBackoff('push');
        expect(inBackoff.has(ENTITY_ID)).toBe(true);

        await db.query(
            `UPDATE sync_errors SET next_retry_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE entity_id = $1`,
            [ENTITY_ID],
        );

        inBackoff = await getEntityIdsInBackoff('push');
        expect(inBackoff.has(ENTITY_ID)).toBe(false);
    });

    it('SYNC_ERRORS_ACTIVE_INDEX_SQL dedupes pre-existing unresolved duplicates down to the highest id', async () => {
        // Simulate the pre-#146 append-only world: several rows for the same
        // (entity_id, operation), inserted directly (bypassing recordSyncError).
        // Drop the unique index first since it forbids duplicates going forward.
        await db.exec(`DROP INDEX IF EXISTS idx_sync_errors_active;`);
        let lastId = 0;
        for (let i = 0; i < 3; i++) {
            const result = await db.query<{ id: number }>(
                `INSERT INTO sync_errors (entity_id, entity_type, operation, error_message, retry_count)
                 VALUES ($1, 'note', 'push', 'dup', 1) RETURNING id`,
                [ENTITY_ID],
            );
            lastId = result.rows[0].id;
        }

        await db.exec(SYNC_ERRORS_ACTIVE_INDEX_SQL);

        const unresolved = await db.query<{ id: number }>(
            `SELECT id FROM sync_errors WHERE entity_id = $1 AND resolved_at IS NULL`,
            [ENTITY_ID],
        );
        expect(unresolved.rows).toHaveLength(1);
        expect(unresolved.rows[0].id).toBe(lastId);

        // And the resulting state is safe to upsert against.
        await recordSyncError(ENTITY_ID, 'note', 'push', 'after dedupe');
        const afterUpsert = await db.query<{ id: number }>(
            `SELECT id FROM sync_errors WHERE entity_id = $1 AND resolved_at IS NULL`,
            [ENTITY_ID],
        );
        expect(afterUpsert.rows).toHaveLength(1);
    });
});
