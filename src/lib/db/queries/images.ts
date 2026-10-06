import { getDatabase } from '../pglite';
import type { PendingImageUpload } from '@/types';

// Pending Image Uploads

export async function savePendingImageUpload(upload: PendingImageUpload): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `INSERT INTO pending_image_uploads (id, note_doc_id, blob_data, content_type, status, retry_count, payload_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           retry_count = EXCLUDED.retry_count,
           payload_key = EXCLUDED.payload_key`,
        [
            upload.id,
            upload.noteDocId,
            upload.blobData,
            upload.contentType,
            upload.status,
            upload.retryCount,
            upload.payloadKey || null,
            upload.createdAt,
        ]
    );
}

export async function getPendingImageUploads(noteDocId?: string): Promise<PendingImageUpload[]> {
    const db = await getDatabase();
    const query = noteDocId
        ? `SELECT id, note_doc_id, blob_data, content_type, status, retry_count, payload_key, created_at 
           FROM pending_image_uploads WHERE note_doc_id = $1 AND status NOT IN ('synced', 'failed_permanent') ORDER BY created_at ASC`
        : `SELECT id, note_doc_id, blob_data, content_type, status, retry_count, payload_key, created_at 
           FROM pending_image_uploads WHERE status NOT IN ('synced', 'failed_permanent') ORDER BY created_at ASC`;
    const params = noteDocId ? [noteDocId] : [];
    const result = await db.query<{
        id: string;
        note_doc_id: string;
        blob_data: Uint8Array;
        content_type: string;
        status: 'pending' | 'uploading' | 'failed' | 'failed_permanent';
        retry_count: number;
        payload_key: string | null;
        created_at: string;
    }>(query, params);
    return result.rows.map(row => ({
        id: row.id,
        noteDocId: row.note_doc_id,
        blobData: row.blob_data,
        contentType: row.content_type,
        status: row.status,
        retryCount: row.retry_count,
        payloadKey: row.payload_key || undefined,
        createdAt: row.created_at,
    }));
}

export async function updateImageUploadStatus(id: string, status: string, payloadKey?: string): Promise<void> {
    const db = await getDatabase();
    if (payloadKey) {
        await db.query('UPDATE pending_image_uploads SET status = $2, payload_key = $3 WHERE id = $1', [id, status, payloadKey]);
    } else {
        await db.query('UPDATE pending_image_uploads SET status = $2 WHERE id = $1', [id, status]);
    }
}

export async function incrementImageRetryCount(id: string): Promise<void> {
    const db = await getDatabase();
    await db.query('UPDATE pending_image_uploads SET retry_count = retry_count + 1 WHERE id = $1', [id]);
}

export async function deletePendingImageUpload(id: string): Promise<void> {
    const db = await getDatabase();
    await db.query('DELETE FROM pending_image_uploads WHERE id = $1', [id]);
}

export async function getPendingImageUpload(
    id: string,
): Promise<Pick<PendingImageUpload, 'blobData' | 'contentType' | 'status'> | null> {
    const db = await getDatabase();
    const result = await db.query<{
        blob_data: Uint8Array;
        content_type: string;
        status: PendingImageUpload['status'];
    }>('SELECT blob_data, content_type, status FROM pending_image_uploads WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? { blobData: row.blob_data, contentType: row.content_type, status: row.status } : null;
}

/** Status only, without the image bytes: cheap enough to poll. */
export async function getPendingImageUploadStatus(id: string): Promise<PendingImageUpload['status'] | null> {
    const db = await getDatabase();
    const result = await db.query<{ status: PendingImageUpload['status'] }>(
        'SELECT status FROM pending_image_uploads WHERE id = $1', [id]);
    return result.rows[0]?.status ?? null;
}

/** User-requested retry: due now, with a fresh attempt budget, even if it was given up on. */
export async function retryPendingImageUploadNow(id: string): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `UPDATE pending_image_uploads SET next_retry_at = NULL, retry_count = 0, status = 'pending' WHERE id = $1`, [id]);
}

/** Bytes of an image uploaded from this device, kept so it renders offline (#179). */
export async function getLocalImageBytes(
    remoteFileId: string,
    payloadKey: string,
): Promise<Pick<PendingImageUpload, 'blobData' | 'contentType'> | null> {
    const db = await getDatabase();
    const result = await db.query<{ blob_data: Uint8Array; content_type: string }>(
        `SELECT p.blob_data, p.content_type FROM pending_image_uploads p
         JOIN sync_records s ON s.local_id = p.note_doc_id
         WHERE s.remote_file_id = $1 AND p.payload_key = $2 AND p.status = 'synced' LIMIT 1`,
        [remoteFileId, payloadKey]);
    const row = result.rows[0];
    return row ? { blobData: row.blob_data, contentType: row.content_type } : null;
}

/** Drop the locally kept bytes of images removed from a note. */
export async function deleteLocalImagesByKeys(noteDocId: string, payloadKeys: string[]): Promise<void> {
    const db = await getDatabase();
    await db.query(
        'DELETE FROM pending_image_uploads WHERE note_doc_id = $1 AND payload_key = ANY($2)',
        [noteDocId, payloadKeys]);
}

// ============================================
// Exponential Backoff Helpers
// ============================================

/**
 * Calculate next retry time using exponential backoff
 */
export function calculateNextRetryAt(retryCount: number, baseDelayMs: number = 5000): Date {
    // Exponential backoff: 5s, 10s, 20s, 40s, 80s, etc. with max of 5 minutes
    const delayMs = Math.min(baseDelayMs * Math.pow(2, retryCount), 5 * 60 * 1000);
    return new Date(Date.now() + delayMs);
}

/**
 * Update image upload with next retry time
 */
export async function updateImageRetryAt(id: string, nextRetryAt: Date): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `UPDATE pending_image_uploads SET next_retry_at = $2 WHERE id = $1`,
        [id, nextRetryAt.toISOString()]
    );
}

/** When the earliest image upload backing off can be retried (ms since epoch), #374. */
export async function getNextImageRetryAt(): Promise<number | undefined> {
    const db = await getDatabase();
    const result = await db.query<{ next_retry_at: string | Date | null }>(
        `SELECT MIN(next_retry_at) AS next_retry_at FROM pending_image_uploads
         WHERE status NOT IN ('synced', 'failed_permanent') AND next_retry_at > CURRENT_TIMESTAMP`
    );
    const nextRetryAt = result.rows[0]?.next_retry_at;
    return nextRetryAt ? new Date(nextRetryAt).getTime() : undefined;
}

/**
 * Get image uploads that are ready for retry (next_retry_at has passed or is null)
 */
export async function getImageUploadsReadyForRetry(): Promise<PendingImageUpload[]> {
    const db = await getDatabase();
    const result = await db.query<{
        id: string;
        note_doc_id: string;
        blob_data: Uint8Array;
        content_type: string;
        status: 'pending' | 'uploading' | 'failed' | 'failed_permanent';
        retry_count: number;
        payload_key: string | null;
        next_retry_at: string | null;
        created_at: string;
    }>(
        `SELECT id, note_doc_id, blob_data, content_type, status, retry_count, payload_key, next_retry_at, created_at 
         FROM pending_image_uploads 
         WHERE status NOT IN ('synced', 'failed_permanent')
         AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
         ORDER BY created_at ASC`
    );
    return result.rows.map(row => ({
        id: row.id,
        noteDocId: row.note_doc_id,
        blobData: row.blob_data,
        contentType: row.content_type,
        status: row.status,
        retryCount: row.retry_count,
        payloadKey: row.payload_key || undefined,
        createdAt: row.created_at,
    }));
}

// ============================================
// Pending Image Deletions (for tracking remote payloads to delete)
// ============================================

/**
 * Save a pending image deletion (image was removed from editor)
 */
export async function savePendingImageDeletion(noteDocId: string, payloadKey: string): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `INSERT INTO pending_image_deletions (note_doc_id, payload_key)
         VALUES ($1, $2)
         ON CONFLICT (note_doc_id, payload_key) DO NOTHING`,
        [noteDocId, payloadKey]
    );
}

/**
 * Get all pending image deletions for a note
 */
export async function getPendingImageDeletions(noteDocId: string): Promise<string[]> {
    const db = await getDatabase();
    const result = await db.query<{ payload_key: string }>(
        `SELECT payload_key FROM pending_image_deletions WHERE note_doc_id = $1`,
        [noteDocId]
    );
    return result.rows.map(row => row.payload_key);
}

/**
 * Drop one pending image deletion (the payload is referenced by the note again, e.g. after undo)
 */
export async function removePendingImageDeletion(noteDocId: string, payloadKey: string): Promise<void> {
    const db = await getDatabase();
    await db.query(
        'DELETE FROM pending_image_deletions WHERE note_doc_id = $1 AND payload_key = $2',
        [noteDocId, payloadKey]
    );
}

/**
 * Clear the given pending image deletions for a note (after they were sent in a successful sync).
 * Rows queued after the push read them stay queued for the next push (#242).
 */
export async function clearPendingImageDeletions(noteDocId: string, payloadKeys: string[]): Promise<void> {
    const db = await getDatabase();
    await db.query(
        'DELETE FROM pending_image_deletions WHERE note_doc_id = $1 AND payload_key = ANY($2)',
        [noteDocId, payloadKeys]
    );
}
