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
 * Images that failed on their thumbnails go back in the queue once on upgrade; each
 * upload draws the thumbnails again. Homebase refused a thumbnail over 1 MiB
 * ("ThumbnailDescriptor BytesWritten ... too long"), and js-lib alpha.88 threw on a
 * tiny thumb it couldn't fit ("The world has ended...").
 */
const THUMBNAIL_FAILURE = `(error_message LIKE '%ThumbnailDescriptor%too long%' OR error_message LIKE '%The world has ended%')`;
export const REQUEUE_THUMBNAIL_FAILURE_UPLOADS_SQL = `
  UPDATE pending_image_uploads SET status = 'pending', retry_count = 0, next_retry_at = NULL
   WHERE status IN ('failed', 'failed_permanent')
     AND id IN (SELECT entity_id FROM sync_errors WHERE resolved_at IS NULL AND ${THUMBNAIL_FAILURE});
  UPDATE sync_errors SET permanent = FALSE, next_retry_at = NULL
   WHERE resolved_at IS NULL AND ${THUMBNAIL_FAILURE};
`;
