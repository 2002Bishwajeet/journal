/**
 * sync_errors: dedupe existing unresolved rows down to one per
 * (entity_id, operation), then enforce that invariant going forward with a
 * partial unique index recordSyncError's ON CONFLICT upserts against (#146).
 *
 * A separate tiny module (not pglite.ts) so tests can import it without
 * pulling in the worker/boot code.
 */
export const SYNC_ERRORS_ACTIVE_INDEX_SQL = `
  UPDATE sync_errors SET resolved_at = CURRENT_TIMESTAMP
   WHERE resolved_at IS NULL
     AND id NOT IN (SELECT MAX(id) FROM sync_errors WHERE resolved_at IS NULL GROUP BY entity_id, operation);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_errors_active
    ON sync_errors (entity_id, operation) WHERE resolved_at IS NULL;
`;

/**
 * Images given up on because a thumbnail was over Homebase's 1 MiB limit
 * ("ThumbnailDescriptor BytesWritten ... too long") go back in the queue once on
 * upgrade: each upload draws the thumbnails again, now within the limit.
 */
export const REQUEUE_OVERSIZED_THUMBNAIL_UPLOADS_SQL = `
  UPDATE pending_image_uploads SET status = 'pending', retry_count = 0, next_retry_at = NULL
   WHERE status = 'failed_permanent'
     AND id IN (SELECT entity_id FROM sync_errors
                 WHERE resolved_at IS NULL AND error_message LIKE '%ThumbnailDescriptor%too long%');
  UPDATE sync_errors SET permanent = FALSE, next_retry_at = NULL
   WHERE resolved_at IS NULL AND error_message LIKE '%ThumbnailDescriptor%too long%';
`;
