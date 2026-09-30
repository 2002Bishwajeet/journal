import { getDatabase } from '../pglite';
import type { SyncError } from '@/types';

// ============================================
// Sync Error Tracking
// ============================================

/**
 * Record a sync failure. Upserts against the single active (unresolved) row for
 * this (entity_id, operation) instead of appending a new row per failure, and
 * backs off the next retry exponentially (5s * 2^retryCount, capped at 5 minutes).
 * The exponent is capped too: 5s * 2^41 overflows a Postgres interval, which would
 * make every later failure for this entity throw and abort sync().
 * Mirrors calculateNextRetryAt's curve (images.ts) — computed in SQL (not by calling it)
 * so the backoff uses the row's current retry_count atomically; keep both in sync.
 */
export async function recordSyncError(
    entityId: string,
    entityType: 'folder' | 'note' | 'image',
    operation: 'push' | 'pull' | 'upload',
    errorMessage: string,
): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `INSERT INTO sync_errors (entity_id, entity_type, operation, error_message, retry_count, next_retry_at)
         VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP + INTERVAL '5 seconds')
         ON CONFLICT (entity_id, operation) WHERE resolved_at IS NULL
         DO UPDATE SET retry_count = sync_errors.retry_count + 1,
                       next_retry_at = CURRENT_TIMESTAMP + LEAST(INTERVAL '5 seconds' * power(2, LEAST(sync_errors.retry_count, 6)), INTERVAL '5 minutes'),
                       error_message = EXCLUDED.error_message`,
        [entityId, entityType, operation, errorMessage]
    );
}

/**
 * Note ids whose pull failed and are due for a retry (#147). Rows at
 * maxAttempts stop being selected but stay unresolved.
 */
export async function getPullRetriesDue(maxAttempts = 5): Promise<string[]> {
    const db = await getDatabase();
    const result = await db.query<{ entity_id: string }>(
        `SELECT entity_id FROM sync_errors
         WHERE resolved_at IS NULL AND operation = 'pull' AND entity_type = 'note' AND retry_count < $1
           AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)`,
        [maxAttempts]
    );
    return result.rows.map(row => row.entity_id);
}

/**
 * Entity ids currently backing off from a failed operation (next_retry_at is
 * still in the future), so callers can skip retrying them this sync pass.
 */
export async function getEntityIdsInBackoff(operation: 'push' | 'pull'): Promise<Set<string>> {
    const db = await getDatabase();
    const result = await db.query<{ entity_id: string }>(
        `SELECT entity_id FROM sync_errors
         WHERE resolved_at IS NULL AND operation = $1 AND next_retry_at > CURRENT_TIMESTAMP`,
        [operation]
    );
    return new Set(result.rows.map(row => row.entity_id));
}

/**
 * Entity ids with an unresolved error for this (entityType, operation) pair —
 * unlike getEntityIdsInBackoff, this includes ones already past their retry time
 * (still failing, not yet resolved). Used to avoid treating an entity that failed
 * to pull as confirmed gone (#259).
 */
export async function getEntityIdsWithUnresolvedError(
    entityType: 'folder' | 'note' | 'image',
    operation: 'push' | 'pull' | 'upload',
): Promise<Set<string>> {
    const db = await getDatabase();
    const result = await db.query<{ entity_id: string }>(
        `SELECT entity_id FROM sync_errors
         WHERE resolved_at IS NULL AND entity_type = $1 AND operation = $2`,
        [entityType, operation]
    );
    return new Set(result.rows.map(row => row.entity_id));
}

/**
 * When the earliest push backoff of a record that still needs pushing ends (ms since
 * epoch), or undefined if none is waiting. Lets the caller schedule the retry (#263).
 */
export async function getNextPushRetryAt(): Promise<number | undefined> {
    const db = await getDatabase();
    const result = await db.query<{ next_retry_at: string | Date | null }>(
        `SELECT MIN(e.next_retry_at) AS next_retry_at FROM sync_errors e
         JOIN sync_records r ON r.local_id = e.entity_id
         WHERE e.resolved_at IS NULL AND e.operation = 'push' AND e.next_retry_at > CURRENT_TIMESTAMP
           AND r.sync_status IN ('pending', 'pending_delete')`
    );
    const nextRetryAt = result.rows[0]?.next_retry_at;
    return nextRetryAt ? new Date(nextRetryAt).getTime() : undefined;
}

/**
 * Get all unresolved sync errors
 */
export async function getUnresolvedSyncErrors(): Promise<SyncError[]> {
    const db = await getDatabase();
    const result = await db.query<{
        id: number;
        entity_id: string;
        entity_type: 'folder' | 'note' | 'image';
        operation: 'push' | 'pull' | 'upload';
        error_message: string;
        error_code: string | null;
        retry_count: number;
        next_retry_at: string | null;
        created_at: string;
    }>(
        `SELECT id, entity_id, entity_type, operation, error_message, error_code, retry_count, next_retry_at, created_at
         FROM sync_errors WHERE resolved_at IS NULL 
         ORDER BY created_at DESC`
    );
    return result.rows.map(row => ({
        id: row.id,
        entityId: row.entity_id,
        entityType: row.entity_type,
        operation: row.operation,
        errorMessage: row.error_message,
        errorCode: row.error_code || undefined,
        retryCount: row.retry_count,
        nextRetryAt: row.next_retry_at || undefined,
        createdAt: row.created_at,
    }));
}

/**
 * Mark a sync error as resolved
 */
export async function resolveSyncError(errorId: number): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `UPDATE sync_errors SET resolved_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [errorId]
    );
}

/**
 * Resolve all errors for an entity (e.g., after successful sync)
 */
export async function resolveSyncErrorsForEntity(entityId: string): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `UPDATE sync_errors SET resolved_at = CURRENT_TIMESTAMP 
         WHERE entity_id = $1 AND resolved_at IS NULL`,
        [entityId]
    );
}

/**
 * Clear all resolved errors older than specified days
 */
export async function clearOldSyncErrors(daysOld: number = 7): Promise<number> {
    const db = await getDatabase();
    const result = await db.query(
        `DELETE FROM sync_errors 
         WHERE resolved_at IS NOT NULL 
         AND resolved_at < CURRENT_TIMESTAMP - INTERVAL '${daysOld} days'`
    );
    return result.affectedRows || 0;
}

/**
 * Get count of unresolved sync errors
 */
export async function getSyncErrorCount(): Promise<number> {
    const db = await getDatabase();
    const result = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM sync_errors WHERE resolved_at IS NULL`
    );
    return parseInt(result.rows[0]?.count || '0', 10);
}
