import { getDatabase } from '../pglite';

// ============================================
// Settings → Diagnostics (#800)
// ============================================

export type PendingItemKind = 'note' | 'folder' | 'image';
export type PendingItemStatus = 'pending' | 'retrying' | 'failed';

export interface PendingItemError {
    message: string;
    code: string | null;
    operation: string;
    /** When this run of failures began. */
    since: string;
}

export interface PendingSyncItem {
    id: string;
    kind: PendingItemKind;
    status: PendingItemStatus;
    /** A note or folder deleted here whose delete has not reached the server. */
    isDelete: boolean;
    /** Note or folder title; for an image, the title of the note it belongs to. Null when unknown. */
    title: string | null;
    /** The note to open when the row is tapped (the image's note for an image). */
    noteId: string | null;
    folderId: string | null;
    contentType: string | null;
    lastSyncedAt: string | null;
    retryCount: number;
    nextRetryAt: string | null;
    error: PendingItemError | null;
}

type Timestamp = string | Date | null;

const toIso = (value: Timestamp): string | null => (value ? new Date(value).toISOString() : null);

/**
 * `retrying` while an automatic retry is scheduled, `failed` once it errored with
 * none scheduled (or the upload was given up on), `pending` before any failure.
 */
export function derivePendingStatus(
    input: { givenUp: boolean; hasError: boolean; retryCount: number; nextRetryAt: string | null },
    now = Date.now(),
): PendingItemStatus {
    if (input.givenUp) return 'failed';
    const waiting = input.nextRetryAt !== null && new Date(input.nextRetryAt).getTime() > now;
    if (waiting) return 'retrying';
    return input.hasError || input.retryCount > 0 ? 'failed' : 'pending';
}

interface ErrorColumns {
    error_message: string | null;
    error_code: string | null;
    error_operation: string | null;
    error_since: Timestamp;
}

// The newest unresolved sync_errors row of an entity (at most one per operation).
const LATEST_ERROR_JOIN = `
    LEFT JOIN LATERAL (
        SELECT error_message, error_code, operation AS error_operation, created_at AS error_since,
               retry_count AS error_retry_count, next_retry_at AS error_next_retry_at
        FROM sync_errors
        WHERE entity_id = ENTITY_ID AND resolved_at IS NULL
        ORDER BY id DESC LIMIT 1
    ) e ON TRUE`;

function errorOf(row: ErrorColumns): PendingItemError | null {
    if (row.error_message === null) return null;
    return {
        message: row.error_message,
        code: row.error_code,
        operation: row.error_operation ?? 'push',
        since: toIso(row.error_since) ?? new Date(0).toISOString(),
    };
}

/**
 * Everything the sync badge counts, with the story behind each item: notes and
 * folders with a pending change or delete (sync_records), and images still
 * waiting to upload (pending_image_uploads), each joined to its newest
 * unresolved sync_errors row. Notes and folders first, newest failures on top.
 */
export async function getPendingSyncItems(now = Date.now()): Promise<PendingSyncItem[]> {
    const db = await getDatabase();

    const records = await db.query<
        ErrorColumns & {
            id: string;
            kind: 'note' | 'folder';
            sync_status: string;
            last_synced_at: Timestamp;
            title: string | null;
            folder_id: string | null;
            error_retry_count: number | null;
            error_next_retry_at: Timestamp;
        }
    >(
        `SELECT r.local_id AS id, r.entity_type AS kind, r.sync_status, r.last_synced_at,
                COALESCE(s.title, f.name) AS title,
                CASE WHEN r.entity_type = 'note' THEN s.metadata->>'folderId' END AS folder_id,
                e.error_message, e.error_code, e.error_operation, e.error_since,
                e.error_retry_count, e.error_next_retry_at
         FROM sync_records r
         LEFT JOIN search_index s ON r.entity_type = 'note' AND s.doc_id = r.local_id
         LEFT JOIN folders f ON r.entity_type = 'folder' AND f.id = r.local_id
         ${LATEST_ERROR_JOIN.replace('ENTITY_ID', 'r.local_id')}
         WHERE r.entity_type IN ('note', 'folder') AND r.sync_status IN ('pending', 'pending_delete')
         ORDER BY e.error_since DESC NULLS LAST, r.local_id`,
    );

    const images = await db.query<
        ErrorColumns & {
            id: string;
            note_doc_id: string;
            content_type: string;
            status: string;
            retry_count: number | null;
            next_retry_at: Timestamp;
            note_title: string | null;
            folder_id: string | null;
        }
    >(
        `SELECT u.id, u.note_doc_id, u.content_type, u.status, u.retry_count, u.next_retry_at,
                s.title AS note_title, s.metadata->>'folderId' AS folder_id,
                e.error_message, e.error_code, e.error_operation, e.error_since
         FROM pending_image_uploads u
         LEFT JOIN search_index s ON s.doc_id = u.note_doc_id
         ${LATEST_ERROR_JOIN.replace('ENTITY_ID', 'u.id')}
         WHERE u.status <> 'synced'
         ORDER BY u.created_at`,
    );

    const noteAndFolderItems = records.rows.map((row): PendingSyncItem => {
        const error = errorOf(row);
        const nextRetryAt = toIso(row.error_next_retry_at);
        const retryCount = row.error_retry_count ?? 0;
        return {
            id: row.id,
            kind: row.kind,
            status: derivePendingStatus({ givenUp: false, hasError: error !== null, retryCount, nextRetryAt }, now),
            isDelete: row.sync_status === 'pending_delete',
            title: row.title,
            noteId: row.kind === 'note' && row.title !== null ? row.id : null,
            folderId: row.folder_id,
            contentType: null,
            lastSyncedAt: toIso(row.last_synced_at),
            retryCount,
            nextRetryAt,
            error,
        };
    });

    const imageItems = images.rows.map((row): PendingSyncItem => {
        const error = errorOf(row);
        const nextRetryAt = toIso(row.next_retry_at);
        const retryCount = row.retry_count ?? 0;
        return {
            id: row.id,
            kind: 'image',
            status: derivePendingStatus(
                { givenUp: row.status === 'failed_permanent', hasError: error !== null, retryCount, nextRetryAt },
                now,
            ),
            isDelete: false,
            title: row.note_title,
            noteId: row.note_title !== null ? row.note_doc_id : null,
            folderId: row.folder_id,
            contentType: row.content_type,
            lastSyncedAt: null,
            retryCount,
            nextRetryAt,
            error,
        };
    });

    return [...noteAndFolderItems, ...imageItems];
}

/**
 * Make failed items due now so the next sync pass tries them instead of skipping
 * them for backoff: all of them, or just `entityId`.
 */
export async function clearRetryBackoff(entityId?: string): Promise<void> {
    const db = await getDatabase();
    const params = entityId ? [entityId] : [];
    const only = (column: string) => (entityId ? `AND ${column} = $1` : '');
    await db.query(`UPDATE sync_errors SET next_retry_at = NULL WHERE resolved_at IS NULL ${only('entity_id')}`, params);
    await db.query(`UPDATE pending_image_uploads SET next_retry_at = NULL WHERE status <> 'synced' ${only('id')}`, params);
}

export interface DatabaseInfo {
    /** e.g. "PostgreSQL 17.5" */
    engine: string;
    sizeBytes: number | null;
}

export async function getDatabaseInfo(): Promise<DatabaseInfo> {
    const db = await getDatabase();
    const result = await db.query<{ version: string; size: string | number | bigint | null }>(
        `SELECT version() AS version, pg_database_size(current_database()) AS size`,
    );
    const row = result.rows[0];
    const size = Number(row?.size ?? NaN);
    return {
        engine: row?.version.match(/PostgreSQL [\d.]+/)?.[0] ?? 'PostgreSQL',
        sizeBytes: Number.isFinite(size) ? size : null,
    };
}
