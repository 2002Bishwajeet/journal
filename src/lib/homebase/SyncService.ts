import type { DotYouClient, HomebaseFile } from '@homebase-id/js-lib/core';
import { FolderDriveProvider } from './FolderDriveProvider';
import { NotesDriveProvider } from './NotesDriveProvider';
import { InboxProcessor } from './InboxProcessor';
import {
    getSyncRecord,
    upsertSyncRecord,
    deleteSyncRecord,
    saveAppState,
    recordSyncError,
    resolveSyncErrorsForEntity,
    getNextPushRetryAt,
    markPendingDelete,
    clearOldSyncErrors,
} from '@/lib/db';
import { STORAGE_KEY_LAST_SYNC } from './config';
import type { SyncRecord, SyncProgress } from '@/types';
import { documentBroadcast } from '@/lib/broadcast';
import type { OnlineContextType } from '@/contexts/OnlineContext';
import type { SyncContext } from './sync/context';
import * as peer from './sync/peerNotes';
import * as pull from './sync/pull';
import * as push from './sync/push';
import * as images from './sync/imageUploads';
import * as merge from './sync/merge';

export { classifyPeerFetchError } from './sync/peerNotes';
export type { EnsureNoteContentStatus, EnsureNoteContentResult } from './sync/peerNotes';

export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncResult {
    pulled: { folders: number; notes: number };
    pushed: { folders: number; notes: number };
    errors: string[];
    /** When records skipped for push backoff can be retried (ms since epoch), #263 */
    nextRetryAt?: number;
}

/**
 * SyncService orchestrates bidirectional sync between PGlite and Homebase.
 *
 * Sync Flow:
 * 1. Pull remote changes (using InboxProcessor)
 * 2. Merge Yjs documents for notes (CRDT handles conflicts)
 * 3. Push local pending changes
 * 4. Process pending image uploads
 *
 * The pull, push, peer-note, image-upload and merge logic lives in ./sync/;
 * the methods here delegate to it.
 */
export class SyncService {
    #ctx: SyncContext;
    #status: SyncStatus = 'idle';
    #onlineContext: OnlineContextType;

    constructor(dotYouClient: DotYouClient, onlineContext: OnlineContextType) {
        this.#ctx = {
            folderProvider: new FolderDriveProvider(dotYouClient),
            notesProvider: new NotesDriveProvider(dotYouClient),
            inboxProcessor: new InboxProcessor(dotYouClient),
            hostIdentity: dotYouClient.getHostIdentity(),
            // Called through the instance so a spy on logSyncError still sees it
            logSyncError: (...args) => this.logSyncError(...args),
        };
        this.#onlineContext = onlineContext;
    }

    getStatus(): SyncStatus {
        return this.#status;
    }

    private isOnline(): boolean {
        return this.#onlineContext.isOnline;
    }

    /**
     * Request all active PGliteProviders to flush pending updates to DB.
     * Uses DocumentBroadcast singleton to notify providers.
     */
    private async flushAllProviders(): Promise<void> {
        await documentBroadcast.requestFlushAndWait();
    }

    /**
     * Flush in-editor changes to the local store, then push this note to the
     * server. Called before sharing so recipients bootstrap real content rather
     * than an empty note.
     */
    async flushAndSyncNote(docId: string): Promise<void> {
        await this.flushAllProviders();
        const record = await getSyncRecord(docId);
        if (record) await this.pushNote(record);
    }

    getNoteProvider(): NotesDriveProvider {
        return this.#ctx.notesProvider;
    }

    async ensurePeerNoteContent(
        docId: string,
        authorOdinId: string | undefined,
    ): Promise<peer.EnsureNoteContentResult> {
        return peer.ensurePeerNoteContent(this.#ctx, docId, authorOdinId);
    }

    async revalidatePeerNote(
        docId: string,
        authorOdinId: string | undefined,
    ): Promise<'skipped' | 'unchanged' | 'updated'> {
        return peer.revalidatePeerNote(this.#ctx, docId, authorOdinId);
    }

    /**
     * Full bidirectional sync with optional progress callback.
     */
    async sync(onProgress?: (progress: SyncProgress) => void): Promise<SyncResult> {
        if (this.#status === 'syncing') {
            return { pulled: { folders: 0, notes: 0 }, pushed: { folders: 0, notes: 0 }, errors: ['Sync already in progress'] };
        }

        // Network guard - skip sync if offline
        if (!this.isOnline()) {
            return { pulled: { folders: 0, notes: 0 }, pushed: { folders: 0, notes: 0 }, errors: ['Network offline'] };
        }

        this.#status = 'syncing';
        const result: SyncResult = {
            pulled: { folders: 0, notes: 0 },
            pushed: { folders: 0, notes: 0 },
            errors: [],
        };

        try {
            // 0. Flush all active editors to ensure pending updates are saved to DB
            await this.flushAllProviders();
            await clearOldSyncErrors();

            // 1. Pull remote changes
            const pullResult = await this.pullChanges(onProgress);
            result.pulled = pullResult;

            // 2. Push local changes
            const pushResult = await this.pushChanges(onProgress);
            result.pushed = pushResult;

            // 3. Process pending image uploads
            await this.processPendingImageUploads();

            // 4. Save sync timestamp
            await saveAppState(STORAGE_KEY_LAST_SYNC, this.#ctx.inboxProcessor.getCurrentSyncTime());

            // 5. Report when the pushes skipped for backoff can be retried (#263)
            result.nextRetryAt = await getNextPushRetryAt();

            this.#status = 'idle';
        } catch (error) {
            this.#status = 'error';
            result.errors.push(error instanceof Error ? error.message : 'Unknown sync error');
            console.error('[SyncService] Sync failed:', error);
        }

        return result;
    }

    async pullChanges(onProgress?: (progress: SyncProgress) => void): Promise<{ folders: number; notes: number }> {
        return pull.pullChanges(this.#ctx, this, onProgress);
    }

    /**
     * Log sync error to database for tracking.
     */
    private async logSyncError(entityId: string, entityType: 'folder' | 'note' | 'image', operation: 'push' | 'pull' | 'upload', error: unknown): Promise<void> {
        if (!entityId) {
            console.error('[SyncService] logSyncError called with an empty entityId; not writing a sync_errors row');
            return;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        await recordSyncError(entityId, entityType, operation, errorMessage);
    }

    async pushChanges(onProgress?: (progress: SyncProgress) => void): Promise<{ folders: number; notes: number }> {
        return push.pushChanges(this.#ctx, this, onProgress);
    }

    async handleRemoteFolder(remoteFile: HomebaseFile<string>): Promise<void> {
        return pull.handleRemoteFolder(this.#ctx, remoteFile);
    }

    async handleDeletedFolder(deleted: pull.DeletedFileRef): Promise<void> {
        return pull.handleDeletedFolder(deleted);
    }

    async handleInvitation(remoteFile: HomebaseFile<string>): Promise<void> {
        return peer.handleInvitation(this.#ctx, remoteFile);
    }

    async handleDeletedInvitation(deleted: pull.DeletedFileRef): Promise<void> {
        return peer.handleDeletedInvitation(deleted);
    }

    async handleRemoteNote(remoteFile: HomebaseFile<unknown>): Promise<void> {
        return pull.handleRemoteNote(this.#ctx, remoteFile);
    }

    async handleDeletedNote(deleted: pull.DeletedFileRef): Promise<void> {
        return pull.handleDeletedNote(deleted);
    }

    async mergeYjsDocuments(docId: string, remoteBlob: Uint8Array): Promise<Uint8Array> {
        return merge.mergeYjsDocuments(docId, remoteBlob);
    }

    async pushFolder(record: SyncRecord): Promise<void> {
        return push.pushFolder(this.#ctx, record);
    }

    async pushNote(record: SyncRecord): Promise<void> {
        return push.pushNote(this.#ctx, record);
    }

    async processPendingImageUploads(): Promise<void> {
        return images.processPendingImageUploads(this.#ctx, {
            updateImageReference: (...args) => this.updateImageReference(...args),
        });
    }

    private async updateImageReference(
        docId: string,
        pendingId: string,
        fileId: string,
        payloadKey: string
    ): Promise<boolean> {
        return images.updateImageReference(docId, pendingId, fileId, payloadKey);
    }

    /**
     * Sync a single note immediately (for debounced saves).
     */
    async syncNote(docId: string): Promise<void> {
        // Flush the active editor's in-memory Yjs updates to the DB (acknowledged,
        // not blind-timed) so pushNote reads the latest content and records a hash
        // that matches what is actually uploaded.
        await documentBroadcast.requestFlushAndWait(docId);
        const record = await getSyncRecord(docId);
        if (record) {
            await this.pushNote(record);
            await resolveSyncErrorsForEntity(docId);
        }
    }

    /**
     * Sync a single folder immediately.
     */
    async syncFolder(folderId: string): Promise<void> {
        const record = await getSyncRecord(folderId);
        if (record) {
            await this.pushFolder(record);
            await resolveSyncErrorsForEntity(folderId);
        }
    }

    /**
     * Delete a note from Homebase remotely using the stored remoteFileId.
     * This should be called before deleting the local sync record.
     */
    async deleteNoteRemote(docId: string): Promise<void> {
        const record = await getSyncRecord(docId);
        try {
            if (record?.remoteFileId) {
                await this.#ctx.notesProvider.deleteNote(record.remoteFileId);
                console.log(`[SyncService] Deleted remote note: ${docId}`);
            }
            await deleteSyncRecord(docId);
            await resolveSyncErrorsForEntity(docId);
        } catch (error) {
            console.error(`[SyncService] Failed to delete remote note ${docId}:`, error);
            // Don't throw - local delete should still proceed. Keep the sync record as
            // 'pending_delete' so pushChanges retries the remote delete (#265).
            await markPendingDelete(docId);
            await this.logSyncError(docId, 'note', 'push', error);
        }
    }

    /**
     * Soft-delete / restore a note remotely by setting its Homebase archivalStatus
     * (0 = active, 2 = trashed). Throws on failure so the caller can roll back —
     * unlike a hard delete, a half-applied trash would resurface on the next pull.
     */
    async setNoteArchivalStatusRemote(docId: string, status: number): Promise<void> {
        const record = await getSyncRecord(docId);
        if (!record?.remoteFileId) return;
        const { versionTag } = await this.#ctx.notesProvider.setNoteArchivalStatus(docId, status, record.remoteFileId);
        // Keep the cached versionTag fresh so later edits/deletes don't conflict.
        await upsertSyncRecord({ ...record, versionTag });
    }

    /**
     * Delete a folder from Homebase remotely using the stored remoteFileId.
     * This should be called before deleting the local sync record.
     */
    async deleteFolderRemote(folderId: string): Promise<void> {
        const record = await getSyncRecord(folderId);
        try {
            await this.#ctx.folderProvider.deleteFolder(record?.remoteFileId, folderId);
            console.log(`[SyncService] Deleted remote folder: ${folderId}`);
            await deleteSyncRecord(folderId);
            await resolveSyncErrorsForEntity(folderId);
        } catch (error) {
            console.error(`[SyncService] Failed to delete remote folder ${folderId}:`, error);
            // Don't throw - local delete should still proceed. Keep the sync record as
            // 'pending_delete' so pushChanges retries the remote delete (#258).
            await upsertSyncRecord({
                localId: folderId,
                entityType: 'folder',
                remoteFileId: record?.remoteFileId,
                syncStatus: 'pending_delete',
            });
            await this.logSyncError(folderId, 'folder', 'push', error);
        }
    }
}
