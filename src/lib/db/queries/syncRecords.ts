import { getDatabase } from '../pglite';
import type { SyncRecord } from '@/types';
import { clearNoteListEntryCache } from './noteList';

export async function upsertSyncRecord(record: SyncRecord): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `INSERT INTO sync_records (local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status, content_hash, encrypted_key_header, author_odin_id, global_transit_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (local_id) DO UPDATE SET
           entity_type = EXCLUDED.entity_type,
           remote_file_id = EXCLUDED.remote_file_id,
           version_tag = EXCLUDED.version_tag,
           last_synced_at = EXCLUDED.last_synced_at,
           sync_status = EXCLUDED.sync_status,
           content_hash = EXCLUDED.content_hash,
           encrypted_key_header = EXCLUDED.encrypted_key_header,
           author_odin_id = EXCLUDED.author_odin_id,
           global_transit_id = EXCLUDED.global_transit_id`,
        [
            record.localId,
            record.entityType,
            record.remoteFileId || null,
            record.versionTag || null,
            record.lastSyncedAt || null,
            record.syncStatus,
            record.contentHash || null,
            record.encryptedKeyHeader || null,
            record.authorOdinId || null,
            record.globalTransitId || null,
        ]
    );
}

export async function getSyncRecord(localId: string): Promise<SyncRecord | null> {
    const db = await getDatabase();
    const result = await db.query<{
        local_id: string;
        entity_type: 'folder' | 'note';
        remote_file_id: string | null;
        version_tag: string | null;
        last_synced_at: string | null;
        sync_status: SyncRecord['syncStatus'];
        content_hash: string | null;
        encrypted_key_header: string | null;
        author_odin_id: string | null;
        global_transit_id: string | null;
        dirty_generation: number;
    }>(
        'SELECT local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status, content_hash, encrypted_key_header, author_odin_id, global_transit_id, dirty_generation FROM sync_records WHERE local_id = $1',
        [localId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
        localId: row.local_id,
        entityType: row.entity_type,
        remoteFileId: row.remote_file_id || undefined,
        versionTag: row.version_tag || undefined,
        lastSyncedAt: row.last_synced_at || undefined,
        syncStatus: row.sync_status,
        contentHash: row.content_hash || undefined,
        encryptedKeyHeader: row.encrypted_key_header || undefined,
        authorOdinId: row.author_odin_id || undefined,
        globalTransitId: row.global_transit_id || undefined,
        dirtyGeneration: row.dirty_generation ?? 0,
    };
}

export async function getPendingSyncRecords(entityType?: 'folder' | 'note', status: 'pending' | 'pending_delete' = 'pending'): Promise<SyncRecord[]> {
    const db = await getDatabase();
    const query = entityType
        ? `SELECT local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status, content_hash, encrypted_key_header, author_odin_id, global_transit_id, dirty_generation
           FROM sync_records WHERE sync_status = $1 AND entity_type = $2`
        : `SELECT local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status, content_hash, encrypted_key_header, author_odin_id, global_transit_id, dirty_generation
           FROM sync_records WHERE sync_status = $1`;
    const params = entityType ? [status, entityType] : [status];
    const result = await db.query<{
        local_id: string;
        entity_type: 'folder' | 'note';
        remote_file_id: string | null;
        version_tag: string | null;
        last_synced_at: string | null;
        sync_status: SyncRecord['syncStatus'];
        content_hash: string | null;
        encrypted_key_header: string | null;
        author_odin_id: string | null;
        global_transit_id: string | null;
        dirty_generation: number;
    }>(query, params);
    return result.rows.map(row => ({
        localId: row.local_id,
        entityType: row.entity_type,
        remoteFileId: row.remote_file_id || undefined,
        versionTag: row.version_tag || undefined,
        lastSyncedAt: row.last_synced_at || undefined,
        syncStatus: row.sync_status,
        contentHash: row.content_hash || undefined,
        encryptedKeyHeader: row.encrypted_key_header || undefined,
        authorOdinId: row.author_odin_id || undefined,
        globalTransitId: row.global_transit_id || undefined,
        dirtyGeneration: row.dirty_generation ?? 0,
    }));
}

export async function markSynced(localId: string, remoteFileId: string, versionTag: string, contentHash?: string, encryptedKeyHeader?: string, authorOdinId?: string, globalTransitId?: string, expectedGeneration?: number): Promise<void> {
    const db = await getDatabase();
    // Generation guard: when the caller snapshotted a dirty_generation (from the
    // record it read before a slow push), only promote to 'synced' if no edit has
    // bumped the generation since — otherwise an edit made DURING the push would be
    // clobbered back to synced. version_tag/content_hash/key header are ALWAYS
    // recorded so a superseded push still captures what the server now has.
    // A record deleted during the push stays 'pending_delete' so its remote delete is retried.
    await db.query(
        `UPDATE sync_records SET
           remote_file_id = $2,
           version_tag = $3,
           last_synced_at = CURRENT_TIMESTAMP,
           sync_status = CASE WHEN sync_status = 'pending_delete' THEN sync_status
                              WHEN $8::int IS NULL OR dirty_generation = $8::int THEN 'synced' ELSE sync_status END,
           content_hash = $4,
           encrypted_key_header = COALESCE($5, encrypted_key_header),
           author_odin_id = COALESCE($6, author_odin_id),
           global_transit_id = COALESCE($7, global_transit_id)
         WHERE local_id = $1`,
        [localId, remoteFileId, versionTag, contentHash || null, encryptedKeyHeader || null, authorOdinId || null, globalTransitId || null, expectedGeneration ?? null]
    );
}

/**
 * A note or folder was deleted locally: keep its sync record as 'pending_delete' (all
 * other fields intact) so the next sync deletes it remotely, or drop the record if it
 * never reached the server (#265).
 */
export async function markPendingDelete(localId: string): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `UPDATE sync_records SET sync_status = 'pending_delete' WHERE local_id = $1 AND remote_file_id IS NOT NULL`,
        [localId]
    );
    await db.query('DELETE FROM sync_records WHERE local_id = $1 AND remote_file_id IS NULL', [localId]);
}

/**
 * Drop a cached key header the current session can no longer decrypt (its shared
 * secret changed, or the file was re-keyed by a public/private toggle). markSynced
 * COALESCEs the column, so it cannot null it — hence this dedicated write. The next
 * push then takes the re-fetch branch in SyncService.pushNote.
 */
export async function clearCachedKeyHeader(localId: string): Promise<void> {
    const db = await getDatabase();
    await db.query(`UPDATE sync_records SET encrypted_key_header = NULL WHERE local_id = $1`, [localId]);
}

/**
 * A public/private toggle re-uploaded the note from `previousVersionTag` to `versionTag`.
 * Clears the now-wrong key header (see clearCachedKeyHeader) and, if this device was at
 * `previousVersionTag`, records `versionTag` so the upload's own websocket echo is skipped.
 * Pulling it would overwrite metadata edited since, e.g. the share dialog's link card (#222).
 * A device that was behind keeps its tag, so the pull still brings in the remote changes.
 */
export async function recordNoteRekey(localId: string, previousVersionTag: string, versionTag: string): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `UPDATE sync_records SET
           encrypted_key_header = NULL,
           version_tag = CASE WHEN version_tag = $2 THEN $3 ELSE version_tag END
         WHERE local_id = $1`,
        [localId, previousVersionTag, versionTag]
    );
}

export async function updateSyncStatus(localId: string, status: SyncRecord['syncStatus']): Promise<void> {
    const db = await getDatabase();
    // Every write that sets 'pending' bumps dirty_generation so a concurrent push's
    // markSynced (which snapshotted the old generation) cannot clobber it.
    await db.query(
        `UPDATE sync_records SET
           sync_status = $2,
           dirty_generation = dirty_generation + CASE WHEN $2 = 'pending' THEN 1 ELSE 0 END
         WHERE local_id = $1`,
        [localId, status]
    );
}

export async function deleteSyncRecord(localId: string): Promise<void> {
    const db = await getDatabase();
    await db.query('DELETE FROM sync_records WHERE local_id = $1', [localId]);
}

/**
 * Get count of pending sync items for UI display
 */
export async function getPendingSyncCount(): Promise<{ notes: number; folders: number; images: number }> {
    const db = await getDatabase();

    const notesResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM sync_records WHERE entity_type = 'note' AND sync_status IN ('pending', 'pending_delete')`
    );

    const foldersResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM sync_records WHERE entity_type = 'folder' AND sync_status IN ('pending', 'pending_delete')`
    );

    const imagesResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM pending_image_uploads WHERE status NOT IN ('synced', 'failed_permanent')`
    );

    return {
        notes: parseInt(notesResult.rows[0]?.count || '0', 10),
        folders: parseInt(foldersResult.rows[0]?.count || '0', 10),
        images: parseInt(imagesResult.rows[0]?.count || '0', 10),
    };
}

// ============================================
// Logout: Clear all local data
// ============================================

/**
 * Clear ALL local data. Call this on logout to prevent
 * data mixing between different Homebase identities.
 * 
 * WARNING: This is destructive and irreversible!
 */
export async function clearAllLocalData(): Promise<void> {
    const db = await getDatabase();

    console.log('[clearAllLocalData] Clearing all local data for logout...');

    await db.exec(`
        -- Clear all document content
        DELETE FROM document_updates;
        DELETE FROM search_index;
        
        -- Clear all folders (including Main - will be recreated on next login)
        DELETE FROM folders;
        
        -- Clear sync tracking
        DELETE FROM sync_records;
        DELETE FROM pending_image_uploads;
        DELETE FROM pending_image_deletions;
        DELETE FROM sync_errors;

        -- Clear version history
        DELETE FROM document_snapshots;
        
        -- Clear job queue
        DELETE FROM job_queue;
        
        -- Clear app state (session, last sync time, etc.)
        DELETE FROM app_state;
    `);

    // Drop cached row identities so a re-login can't serve entries for wiped notes.
    clearNoteListEntryCache();

    console.log('[clearAllLocalData] All local data cleared successfully');
}

// ============================================
// Migration: Create sync records for existing data
// ============================================

/**
 * Check if migration is needed (any notes/folders without sync records)
 */
export async function needsSyncMigration(): Promise<boolean> {
    const db = await getDatabase();

    // Check for notes without sync records
    const notesResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM search_index s 
         WHERE NOT EXISTS (SELECT 1 FROM sync_records r WHERE r.local_id = s.doc_id)`
    );

    // Check for folders without sync records
    const foldersResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM folders f 
         WHERE NOT EXISTS (SELECT 1 FROM sync_records r WHERE r.local_id = f.id)`
    );

    const notesCount = parseInt(notesResult.rows[0]?.count || '0', 10);
    const foldersCount = parseInt(foldersResult.rows[0]?.count || '0', 10);

    return notesCount > 0 || foldersCount > 0;
}

/**
 * Migrate existing notes and folders by creating sync records.
 * Only creates records for entities that don't have one yet.
 * Returns the number of records created.
 */
export async function migrateExistingDataToSync(): Promise<{ notes: number; folders: number }> {
    const db = await getDatabase();

    // Create sync records for notes without them
    const notesResult = await db.query(
        `INSERT INTO sync_records (local_id, entity_type, sync_status)
         SELECT s.doc_id, 'note', 'pending'
         FROM search_index s
         WHERE NOT EXISTS (SELECT 1 FROM sync_records r WHERE r.local_id = s.doc_id)
         ON CONFLICT (local_id) DO NOTHING`
    );

    // Create sync records for folders without them
    const foldersResult = await db.query(
        `INSERT INTO sync_records (local_id, entity_type, sync_status)
         SELECT f.id, 'folder', 'pending'
         FROM folders f
         WHERE NOT EXISTS (SELECT 1 FROM sync_records r WHERE r.local_id = f.id)
         ON CONFLICT (local_id) DO NOTHING`
    );

    return {
        notes: notesResult.affectedRows || 0,
        folders: foldersResult.affectedRows || 0,
    };
}
