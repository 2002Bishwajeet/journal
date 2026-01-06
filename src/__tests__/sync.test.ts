/**
 * Sync Queries Integration Tests
 * 
 * Tests the sync record and pending image upload CRUD functions.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import type { SyncRecord, PendingImageUpload } from '@/types';

// Helper to generate UUIDs for tests
function generateTestId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

describe('Sync Query Functions', () => {
    let db: PGlite;

    beforeAll(async () => {
        db = await createTestDatabase();
    });

    afterAll(async () => {
        await closeTestDatabase();
    });

    beforeEach(async () => {
        await resetTestDatabase();
    });

    // ============================================
    // Simulated query functions (matching queries.ts)
    // ============================================

    async function upsertSyncRecord(record: SyncRecord): Promise<void> {
        await db.query(
            `INSERT INTO sync_records (local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (local_id) DO UPDATE SET
               entity_type = EXCLUDED.entity_type,
               remote_file_id = EXCLUDED.remote_file_id,
               version_tag = EXCLUDED.version_tag,
               last_synced_at = EXCLUDED.last_synced_at,
               sync_status = EXCLUDED.sync_status`,
            [
                record.localId,
                record.entityType,
                record.remoteFileId || null,
                record.versionTag || null,
                record.lastSyncedAt || null,
                record.syncStatus,
            ]
        );
    }

    async function getSyncRecord(localId: string): Promise<SyncRecord | null> {
        const result = await db.query<{
            local_id: string;
            entity_type: 'folder' | 'note';
            remote_file_id: string | null;
            version_tag: string | null;
            last_synced_at: string | null;
            sync_status: 'pending' | 'synced' | 'conflict' | 'error';
        }>(
            'SELECT local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status FROM sync_records WHERE local_id = $1',
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
        };
    }

    async function getPendingSyncRecords(entityType?: 'folder' | 'note'): Promise<SyncRecord[]> {
        const query = entityType
            ? `SELECT local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status 
               FROM sync_records WHERE sync_status = 'pending' AND entity_type = $1`
            : `SELECT local_id, entity_type, remote_file_id, version_tag, last_synced_at, sync_status 
               FROM sync_records WHERE sync_status = 'pending'`;
        const params = entityType ? [entityType] : [];
        const result = await db.query<{
            local_id: string;
            entity_type: 'folder' | 'note';
            remote_file_id: string | null;
            version_tag: string | null;
            last_synced_at: string | null;
            sync_status: 'pending' | 'synced' | 'conflict' | 'error';
        }>(query, params);
        return result.rows.map(row => ({
            localId: row.local_id,
            entityType: row.entity_type,
            remoteFileId: row.remote_file_id || undefined,
            versionTag: row.version_tag || undefined,
            lastSyncedAt: row.last_synced_at || undefined,
            syncStatus: row.sync_status,
        }));
    }

    async function markSynced(localId: string, remoteFileId: string, versionTag: string): Promise<void> {
        await db.query(
            `UPDATE sync_records SET 
               remote_file_id = $2, 
               version_tag = $3, 
               last_synced_at = CURRENT_TIMESTAMP, 
               sync_status = 'synced' 
             WHERE local_id = $1`,
            [localId, remoteFileId, versionTag]
        );
    }

    async function deleteSyncRecord(localId: string): Promise<void> {
        await db.query('DELETE FROM sync_records WHERE local_id = $1', [localId]);
    }

    async function savePendingImageUpload(upload: Omit<PendingImageUpload, 'blobData'> & { blobData: Uint8Array }): Promise<void> {
        await db.query(
            `INSERT INTO pending_image_uploads (id, note_doc_id, blob_data, content_type, status, retry_count, payload_key, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
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

    async function getPendingImageUploads(): Promise<Array<{
        id: string;
        noteDocId: string;
        status: string;
        retryCount: number;
    }>> {
        const result = await db.query<{
            id: string;
            note_doc_id: string;
            status: string;
            retry_count: number;
        }>(
            `SELECT id, note_doc_id, status, retry_count 
             FROM pending_image_uploads WHERE status != 'synced' ORDER BY created_at ASC`
        );
        return result.rows.map(row => ({
            id: row.id,
            noteDocId: row.note_doc_id,
            status: row.status,
            retryCount: row.retry_count,
        }));
    }

    async function incrementImageRetryCount(id: string): Promise<void> {
        await db.query('UPDATE pending_image_uploads SET retry_count = retry_count + 1 WHERE id = $1', [id]);
    }

    async function deletePendingImageUpload(id: string): Promise<void> {
        await db.query('DELETE FROM pending_image_uploads WHERE id = $1', [id]);
    }

    // ============================================
    // Tests
    // ============================================

    describe('Sync Record CRUD', () => {
        it('should create and retrieve a sync record', async () => {
            const localId = generateTestId();

            await upsertSyncRecord({
                localId,
                entityType: 'note',
                syncStatus: 'pending',
            });

            const record = await getSyncRecord(localId);
            expect(record).not.toBeNull();
            expect(record?.localId).toBe(localId);
            expect(record?.entityType).toBe('note');
            expect(record?.syncStatus).toBe('pending');
        });

        it('should update existing sync record', async () => {
            const localId = generateTestId();

            await upsertSyncRecord({
                localId,
                entityType: 'folder',
                syncStatus: 'pending',
            });

            await upsertSyncRecord({
                localId,
                entityType: 'folder',
                remoteFileId: 'remote-123',
                versionTag: 'v1',
                syncStatus: 'synced',
            });

            const record = await getSyncRecord(localId);
            expect(record?.remoteFileId).toBe('remote-123');
            expect(record?.versionTag).toBe('v1');
            expect(record?.syncStatus).toBe('synced');
        });

        it('should get pending sync records', async () => {
            const noteId = generateTestId();
            const folderId = generateTestId();
            const syncedId = generateTestId();

            await upsertSyncRecord({ localId: noteId, entityType: 'note', syncStatus: 'pending' });
            await upsertSyncRecord({ localId: folderId, entityType: 'folder', syncStatus: 'pending' });
            await upsertSyncRecord({ localId: syncedId, entityType: 'note', syncStatus: 'synced' });

            const allPending = await getPendingSyncRecords();
            expect(allPending.length).toBe(2);

            const pendingNotes = await getPendingSyncRecords('note');
            expect(pendingNotes.length).toBe(1);
            expect(pendingNotes[0].localId).toBe(noteId);

            const pendingFolders = await getPendingSyncRecords('folder');
            expect(pendingFolders.length).toBe(1);
            expect(pendingFolders[0].localId).toBe(folderId);
        });

        it('should mark record as synced', async () => {
            const localId = generateTestId();

            await upsertSyncRecord({
                localId,
                entityType: 'note',
                syncStatus: 'pending',
            });

            await markSynced(localId, 'remote-file-456', 'version-abc');

            const record = await getSyncRecord(localId);
            expect(record?.remoteFileId).toBe('remote-file-456');
            expect(record?.versionTag).toBe('version-abc');
            expect(record?.syncStatus).toBe('synced');
            expect(record?.lastSyncedAt).not.toBeNull();
        });

        it('should delete sync record', async () => {
            const localId = generateTestId();

            await upsertSyncRecord({
                localId,
                entityType: 'note',
                syncStatus: 'pending',
            });

            await deleteSyncRecord(localId);

            const record = await getSyncRecord(localId);
            expect(record).toBeNull();
        });
    });

    describe('Pending Image Upload CRUD', () => {
        it('should create and retrieve pending uploads', async () => {
            const uploadId = generateTestId();
            const noteId = generateTestId();

            await savePendingImageUpload({
                id: uploadId,
                noteDocId: noteId,
                blobData: new Uint8Array([1, 2, 3]),
                contentType: 'image/png',
                status: 'pending',
                retryCount: 0,
                createdAt: new Date().toISOString(),
            });

            const uploads = await getPendingImageUploads();
            expect(uploads.length).toBe(1);
            expect(uploads[0].id).toBe(uploadId);
            expect(uploads[0].status).toBe('pending');
        });

        it('should increment retry count', async () => {
            const uploadId = generateTestId();
            const noteId = generateTestId();

            await savePendingImageUpload({
                id: uploadId,
                noteDocId: noteId,
                blobData: new Uint8Array([1]),
                contentType: 'image/jpeg',
                status: 'pending',
                retryCount: 0,
                createdAt: new Date().toISOString(),
            });

            await incrementImageRetryCount(uploadId);
            await incrementImageRetryCount(uploadId);

            const uploads = await getPendingImageUploads();
            expect(uploads[0].retryCount).toBe(2);
        });

        it('should delete pending upload', async () => {
            const uploadId = generateTestId();
            const noteId = generateTestId();

            await savePendingImageUpload({
                id: uploadId,
                noteDocId: noteId,
                blobData: new Uint8Array([1]),
                contentType: 'image/gif',
                status: 'pending',
                retryCount: 0,
                createdAt: new Date().toISOString(),
            });

            await deletePendingImageUpload(uploadId);

            const uploads = await getPendingImageUploads();
            expect(uploads.length).toBe(0);
        });
    });
});
