import * as Y from 'yjs';
import type { DotYouClient, HomebaseFile, DeletedHomebaseFile, EncryptedKeyHeader } from '@homebase-id/js-lib/core';
import { FolderDriveProvider } from './FolderDriveProvider';
import { NotesDriveProvider } from './NotesDriveProvider';
import { InboxProcessor } from './InboxProcessor';
import {
    getFolderById,
    createFolder as createLocalFolder,
    deleteFolder as deleteLocalFolder,
    getSearchIndexEntry,
    getDocumentsByFolder,
    upsertSearchIndex,
    deleteSearchIndexEntry,
    getDocumentUpdates,
    saveDocumentUpdate,
    deleteDocumentUpdates,
    getSyncRecord,
    upsertSyncRecord,
    getPendingSyncRecords,
    markSynced,
    deleteSyncRecord,
    getAppState,
    saveAppState,
    updateImageUploadStatus,
    incrementImageRetryCount,
    deletePendingImageUpload,
    saveSyncError,
    resolveSyncErrorsForEntity,
    getImageUploadsReadyForRetry,
    updateImageRetryAt,
    calculateNextRetryAt,
    getPendingImageDeletions,
    clearPendingImageDeletions,
} from '@/lib/db';
import { computeContentHash } from '@/lib/utils/hash';
import { extractPreviewTextFromYjs, serializeKeyHeader, tryJsonParse, validateKeyHeader } from '@/lib/utils';
import { MAIN_FOLDER_ID, STORAGE_KEY_LAST_SYNC } from './config';
import type { FolderFile, NoteFileContent, SyncRecord, SyncProgress } from '@/types';
import { stringGuidsEqual } from '@homebase-id/js-lib/helpers';
import { documentBroadcast } from '@/lib/broadcast';
import type { OnlineContextType } from '@/contexts/OnlineContext';

export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncResult {
    pulled: { folders: number; notes: number };
    pushed: { folders: number; notes: number };
    errors: string[];
}

/** Internal type for tracking conflict resolution state in pushNote */
type ConflictResolutionResult = {
    result: { versionTag: string; encryptedKeyHeader?: EncryptedKeyHeader };
    mergedBlob?: Uint8Array;
    mergedHash: string;
};

/**
 * SyncService orchestrates bidirectional sync between PGlite and Homebase.
 * 
 * Sync Flow:
 * 1. Pull remote changes (using InboxProcessor)
 * 2. Merge Yjs documents for notes (CRDT handles conflicts)
 * 3. Push local pending changes
 * 4. Process pending image uploads
 */
export class SyncService {
    #folderProvider: FolderDriveProvider;
    #notesProvider: NotesDriveProvider;
    #inboxProcessor: InboxProcessor;
    #status: SyncStatus = 'idle';
    #onlineContext: OnlineContextType;

    constructor(dotYouClient: DotYouClient, onlineContext: OnlineContextType) {
        this.#folderProvider = new FolderDriveProvider(dotYouClient);
        this.#notesProvider = new NotesDriveProvider(dotYouClient);
        this.#inboxProcessor = new InboxProcessor(dotYouClient);
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

            // 1. Pull remote changes
            const pullResult = await this.pullChanges(onProgress);
            result.pulled = pullResult;

            // 2. Push local changes
            const pushResult = await this.pushChanges(onProgress);
            result.pushed = pushResult;

            // 3. Process pending image uploads
            await this.processPendingImageUploads();

            // 4. Save sync timestamp
            await saveAppState(STORAGE_KEY_LAST_SYNC, this.#inboxProcessor.getCurrentSyncTime());

            this.#status = 'idle';
        } catch (error) {
            this.#status = 'error';
            result.errors.push(error instanceof Error ? error.message : 'Unknown sync error');
            console.error('[SyncService] Sync failed:', error);
        }

        return result;
    }

    /**
     * Pull remote changes to local.
     */
    async pullChanges(onProgress?: (progress: SyncProgress) => void): Promise<{ folders: number; notes: number }> {
        const lastSync = await getAppState<number>(STORAGE_KEY_LAST_SYNC);
        const { folders, notes } = await this.#inboxProcessor.processChanges(lastSync || undefined);

        let folderCount = 0;
        let noteCount = 0;
        const total = folders.length + notes.length;
        let current = 0;

        if (onProgress && total > 0) {
            onProgress({ phase: 'pull', current: 0, total, message: 'Fetching changes...' });
        }

        // Process folders first (notes depend on folders via folderId)
        for (const remoteFolderOrDeleted of folders) {
            try {
                if (remoteFolderOrDeleted.fileState === 'deleted') {
                    await this.handleDeletedFolder(remoteFolderOrDeleted as DeletedHomebaseFile);
                } else {
                    await this.handleRemoteFolder(remoteFolderOrDeleted as HomebaseFile<FolderFile>);
                }
                folderCount++;
                current++;
                if (onProgress) onProgress({ phase: 'pull', current, total, message: `Processing folder ${folderCount}/${folders.length}` });
                // Resolve any previous errors for this entity
                const id = remoteFolderOrDeleted.fileMetadata?.appData?.uniqueId;
                if (id) await resolveSyncErrorsForEntity(id);
            } catch (error) {
                console.error('[SyncService] Error processing remote folder:', error);
                // Track error in database
                const id = remoteFolderOrDeleted.fileMetadata?.appData?.uniqueId || 'unknown';
                await this.logSyncError(id, 'folder', 'pull', error);
            }
        }

        // Process notes
        for (const remoteNoteOrDeleted of notes) {
            try {
                if (remoteNoteOrDeleted.fileState === 'deleted') {
                    await this.handleDeletedNote(remoteNoteOrDeleted as DeletedHomebaseFile);
                } else {
                    await this.handleRemoteNote(remoteNoteOrDeleted as HomebaseFile<NoteFileContent>);
                }
                noteCount++;
                current++;
                if (onProgress) onProgress({ phase: 'pull', current, total, message: `Processing note ${noteCount}/${notes.length}` });
                // Resolve any previous errors
                const id = remoteNoteOrDeleted.fileMetadata?.appData?.uniqueId;
                if (id) await resolveSyncErrorsForEntity(id);
            } catch (error) {
                console.error('[SyncService] Error processing remote note:', error);
                const id = remoteNoteOrDeleted.fileMetadata?.appData?.uniqueId || 'unknown';
                await this.logSyncError(id, 'note', 'pull', error);
            }
        }

        return { folders: folderCount, notes: noteCount };
    }

    /**
     * Log sync error to database for tracking.
     */
    private async logSyncError(entityId: string, entityType: 'folder' | 'note' | 'image', operation: 'push' | 'pull' | 'upload', error: unknown): Promise<void> {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await saveSyncError({
            entityId,
            entityType,
            operation,
            errorMessage,
            retryCount: 0,
        });
    }

    /**
     * Push local changes to remote with parallel processing for notes.
     */
    async pushChanges(onProgress?: (progress: SyncProgress) => void): Promise<{ folders: number; notes: number }> {
        let folderCount = 0;
        let noteCount = 0;

        // Push pending folders first (sequential - usually few folders)
        const pendingFolders = await getPendingSyncRecords('folder');
        const pendingNotes = await getPendingSyncRecords('note');
        const total = pendingFolders.length + pendingNotes.length;
        let current = 0;

        if (onProgress && total > 0) {
            onProgress({ phase: 'push', current: 0, total, message: 'Pushing changes...' });
        }
        for (const record of pendingFolders) {
            try {
                await this.pushFolder(record);
                folderCount++;
                current++;
                if (onProgress) onProgress({ phase: 'push', current, total, message: `Pushing folder ${folderCount}/${pendingFolders.length}` });
                await resolveSyncErrorsForEntity(record.localId);
            } catch (error) {
                console.error('[SyncService] Error pushing folder:', error);
                await this.logSyncError(record.localId, 'folder', 'push', error);
            }
        }

        // Push pending notes (parallel with concurrency limit)
        // pendingNotes array is already fetched above
        const CONCURRENCY = 5;

        for (let i = 0; i < pendingNotes.length; i += CONCURRENCY) {
            const batch = pendingNotes.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(batch.map(r => this.pushNote(r)));

            for (let j = 0; j < results.length; j++) {
                if (results[j].status === 'fulfilled') {
                    noteCount++;
                    current++;
                    if (onProgress) onProgress({ phase: 'push', current, total, message: `Pushing note ${noteCount}/${pendingNotes.length}` });
                    await resolveSyncErrorsForEntity(batch[j].localId);
                } else {
                    console.error('[SyncService] Error pushing note:', (results[j] as PromiseRejectedResult).reason);
                    await this.logSyncError(batch[j].localId, 'note', 'push', (results[j] as PromiseRejectedResult).reason);
                }
            }
        }

        return { folders: folderCount, notes: noteCount };
    }

    /**
     * Handle a remote folder (create or update locally).
     */
    async handleRemoteFolder(remoteFile: HomebaseFile<FolderFile>): Promise<void> {
        const uniqueId = remoteFile.fileMetadata.appData.uniqueId;
        if (!uniqueId) return;

        // Parse the content - it's stored as a JSON string from Homebase
        const rawContent = remoteFile.fileMetadata.appData.content;
        const content = typeof rawContent === "string" ? tryJsonParse<FolderFile>(rawContent) : rawContent;
        const folderName = content?.name || 'Untitled Folder';

        const existingRecord = await getSyncRecord(uniqueId);

        if (!existingRecord) {
            // New folder from remote
            await createLocalFolder(uniqueId, folderName);
            await upsertSyncRecord({
                localId: uniqueId,
                entityType: 'folder',
                remoteFileId: remoteFile.fileId,
                versionTag: remoteFile.fileMetadata.versionTag,
                lastSyncedAt: new Date().toISOString(),
                syncStatus: 'synced',
                encryptedKeyHeader: serializeKeyHeader(remoteFile.sharedSecretEncryptedKeyHeader),
            });
        } else {
            // Update existing - remote wins for folders (simple content)
            await createLocalFolder(uniqueId, folderName);
            await markSynced(uniqueId, remoteFile.fileId, remoteFile.fileMetadata.versionTag, undefined, serializeKeyHeader(remoteFile.sharedSecretEncryptedKeyHeader));
        }
    }

    /**
     * Handle a deleted folder from remote.
     * Also deletes all notes in that folder locally.
     */
    async handleDeletedFolder(deleted: DeletedHomebaseFile): Promise<void> {
        const uniqueId = deleted.fileMetadata.appData.uniqueId;
        if (!uniqueId || uniqueId === MAIN_FOLDER_ID) return; // Never delete Main folder

        // Delete all notes in this folder locally - use indexed query instead of fetching all
        const notesInFolder = await getDocumentsByFolder(uniqueId);

        for (const note of notesInFolder) {
            try {
                await deleteSearchIndexEntry(note.docId);
                await deleteDocumentUpdates(note.docId);
                await deleteSyncRecord(note.docId);
            } catch (error) {
                console.warn(`[SyncService] Failed to delete local note ${note.docId} from deleted folder:`, error);
            }
        }

        // Delete the folder itself
        try {
            await deleteLocalFolder(uniqueId);
        } catch {
            // Folder may not exist locally
        }
        await deleteSyncRecord(uniqueId);
    }

    /**
     * Handle a remote note (create, update, or merge).
     * Uses Yjs CRDT merge for conflict resolution.
     */
    async handleRemoteNote(remoteFile: HomebaseFile<NoteFileContent>): Promise<void> {
        const uniqueId = remoteFile.fileMetadata.appData.uniqueId;
        if (!uniqueId) return;

        // Parse the content - it's stored as a JSON string from Homebase
        const rawContent = remoteFile.fileMetadata.appData.content;
        const content = typeof rawContent === "string" ? tryJsonParse<NoteFileContent>(rawContent) : rawContent;
        const noteTitle = content?.title || 'Untitled';
        const existingRecord = await getSyncRecord(uniqueId);

        if (stringGuidsEqual(remoteFile.fileMetadata.versionTag, existingRecord?.versionTag)) {
            // No changes - skip processing
            return;
        }



        // Get remote Yjs blob
        const lastModified = remoteFile.fileMetadata.updated;
        const remoteBlob = await this.#notesProvider.getNotePayload(remoteFile.fileId, lastModified);

        if (!existingRecord) {
            // New note from remote
            if (remoteBlob) {
                await saveDocumentUpdate(uniqueId, remoteBlob);
            }
            // Build local metadata from simplified content + groupId
            const folderId = remoteFile.fileMetadata.appData.groupId || MAIN_FOLDER_ID;
            const remoteTimestamp = new Date(
                remoteFile.fileMetadata.appData.userDate || Date.now()
            ).toISOString();

            const updatedAt = new Date(remoteFile.fileMetadata.updated).toISOString();

            // Extract plain text content from the Yjs blob for the note list display
            const plainTextContent = remoteBlob
                ? await extractPreviewTextFromYjs(uniqueId, remoteBlob)
                : '';

            const metadata = {
                title: noteTitle,
                folderId,
                tags: content?.tags,
                timestamps: { created: remoteTimestamp, modified: updatedAt },
                excludeFromAI: content?.excludeFromAI,
                isPinned: content?.isPinned,
            };

            const contentHash = remoteBlob ? await computeContentHash(metadata, remoteBlob) : undefined;


            await upsertSearchIndex({
                docId: uniqueId,
                title: noteTitle,
                plainTextContent,
                metadata
            });
            await upsertSyncRecord({
                localId: uniqueId,
                entityType: 'note',
                remoteFileId: remoteFile.fileId,
                versionTag: remoteFile.fileMetadata.versionTag,
                lastSyncedAt: new Date().toISOString(),
                syncStatus: 'synced',
                encryptedKeyHeader: serializeKeyHeader(remoteFile.sharedSecretEncryptedKeyHeader),
                contentHash,
            });
        } else {
            // Existing note - merge Yjs documents (CRDT handles conflicts automatically)
            let plainTextContent = '';
            let mergedBlob: Uint8Array | undefined;
            if (remoteBlob) {
                mergedBlob = await this.mergeYjsDocuments(uniqueId, remoteBlob);
                // Clear old updates and save merged state
                await deleteDocumentUpdates(uniqueId);
                await saveDocumentUpdate(uniqueId, mergedBlob);
                // Extract plain text content from the merged Yjs blob for the note list display
                plainTextContent = await extractPreviewTextFromYjs(uniqueId, mergedBlob);

                // Notify the editor that the document was updated
                documentBroadcast.notifyDocumentUpdated(uniqueId);
            }
            // Build local metadata from simplified content + groupId
            const folderId = remoteFile.fileMetadata.appData.groupId || MAIN_FOLDER_ID;


            // Preserve existing local timestamps to avoid unnecessary "last updated" changes
            const existingDoc = await getSearchIndexEntry(uniqueId);
            const existingTimestamps = existingDoc?.metadata.timestamps;
            // Fallback to remote userDate if no local timestamps exist
            const remoteTimestamp = new Date(
                remoteFile.fileMetadata.appData.userDate || Date.now()
            ).toISOString();

            const updatedAt = new Date(remoteFile.fileMetadata.updated).toISOString();

            const updatedMetadata = {
                title: noteTitle,
                folderId,
                tags: content?.tags,
                timestamps: existingTimestamps ?? { created: remoteTimestamp, modified: updatedAt },
                excludeFromAI: content?.excludeFromAI,
                isPinned: content?.isPinned,
            };

            const contentHash = mergedBlob ? await computeContentHash(updatedMetadata, mergedBlob) : undefined;

            await upsertSearchIndex({
                docId: uniqueId,
                title: noteTitle,
                plainTextContent,
                metadata: updatedMetadata
            });
            await markSynced(uniqueId, remoteFile.fileId, remoteFile.fileMetadata.versionTag, contentHash, serializeKeyHeader(remoteFile.sharedSecretEncryptedKeyHeader));
        }
    }

    /**
     * Handle a deleted note from remote.
     */
    async handleDeletedNote(deleted: DeletedHomebaseFile): Promise<void> {
        const uniqueId = deleted.fileMetadata.appData.uniqueId;
        if (!uniqueId) return;

        await deleteSearchIndexEntry(uniqueId);
        await deleteDocumentUpdates(uniqueId);
        await deleteSyncRecord(uniqueId);
    }

    /**
     * Merge local and remote Yjs documents.
     * Yjs CRDTs handle conflict resolution automatically.
     */
    async mergeYjsDocuments(docId: string, remoteBlob: Uint8Array): Promise<Uint8Array> {
        // Get all local updates
        const localUpdates = await getDocumentUpdates(docId);

        const mergedDoc = new Y.Doc();

        try {
            // Apply local updates first
            for (const update of localUpdates) {
                Y.applyUpdate(mergedDoc, update);
            }

            // Apply remote update (Yjs handles CRDT merge automatically)
            Y.applyUpdate(mergedDoc, remoteBlob);

            // Export merged state as a single update
            return Y.encodeStateAsUpdate(mergedDoc);
        } finally {
            mergedDoc.destroy();
        }
    }

    /**
     * Push a local folder to remote.
     * Always verifies remote file existence before updating.
     */
    async pushFolder(record: SyncRecord): Promise<void> {
        const folder = await getFolderById(record.localId);

        if (!folder) {
            // Folder was deleted locally, clean up sync record
            await deleteSyncRecord(record.localId);
            return;
        }

        const folderFile: FolderFile = {
            name: folder.name,
            isCollaborative: false, // TODO: V2 placeholder
            needsPassword: false,   // TODO: V2 placeholder
        };

        const onVersionConflict = async () => {
            console.warn(`[SyncService] Version conflict detected for folder ${record.localId}, will update`);

            const existingFile = await this.#folderProvider.getFolder(record.localId, { decrypt: false });
            if (!existingFile) throw new Error('Remote folder not found during conflict resolution');
            return await this.#folderProvider.updateFolder(
                existingFile.fileId,
                existingFile.fileMetadata.versionTag,
                folderFile
            );
        }

        const result = await this.#folderProvider.createFolder(record.localId, folderFile, {
            onVersionConflict,
        });
        await markSynced(record.localId, result.fileId, result.versionTag);

    }

    /**
     * Push a local note to remote.
     * Always verifies remote file existence before updating.
     */
    async pushNote(record: SyncRecord): Promise<void> {
        const doc = await getSearchIndexEntry(record.localId);

        if (!doc) {
            // Note was deleted locally, clean up sync record
            await deleteSyncRecord(record.localId);
            return;
        }

        // Enforce default title if missing
        if (!doc.title || doc.title.trim() === '') {
            doc.title = 'Untitled';
            doc.metadata.title = 'Untitled';
        }

        // Get Yjs state - merge all updates into single blob
        const updates = await getDocumentUpdates(record.localId);
        let yjsBlob: Uint8Array | undefined;

        // If content is completely empty, send a fresh empty YJS doc to ensure clean state
        // This avoids issues with large deletion histories or invalid states
        // If content is completely empty, send a fresh empty YJS doc to ensure clean state
        // This avoids issues with large deletion histories or invalid states
        if (!doc.plainTextContent || doc.plainTextContent.trim() === '') {
            const emptyDoc = new Y.Doc();
            yjsBlob = Y.encodeStateAsUpdate(emptyDoc);
            emptyDoc.destroy();


        } else if (updates.length > 0) {
            // Use try-finally to ensure Y.Doc cleanup even on exception
            const ydoc = new Y.Doc();
            try {
                for (const update of updates) {
                    Y.applyUpdate(ydoc, update);
                }
                yjsBlob = Y.encodeStateAsUpdate(ydoc);



            } finally {
                ydoc.destroy();
            }
        }

        // Compute content hash to check if upload is needed
        const currentHash = await computeContentHash(doc.metadata, yjsBlob);

        // Early exit: if we have a cached remoteFileId and hash matches, skip network call
        if (record.contentHash === currentHash) {
            console.debug(`[SyncService] Skipping upload for note ${record.localId} - content unchanged (Hash: ${currentHash})`);

            // Only mark as synced if we have a valid remoteFileId and status indicates it needs updating
            if (record.syncStatus === 'pending' || record.syncStatus === 'error') {
                if (record.remoteFileId) {
                    await markSynced(record.localId, record.remoteFileId, record.versionTag || '', currentHash);
                } else {
                    // Edge case: hash matches but no remoteFileId - this shouldn't happen
                    // The note was never uploaded but somehow has matching content hash
                    console.warn(`[SyncService] Hash matches but no remoteFileId for ${record.localId} - skipping markSynced`);
                }
            } else {
                // Hash matches and already synced - this is normal, just log for debugging
                console.debug(`[SyncService] Note ${record.localId} already synced with matching hash`);
            }

            return;
        }
        /* 
            if the content hash doesn't match, we check if the remoteFileId exists. if it exists proceed to update it 
        */

        if (record.remoteFileId) {
            try {
                // Deserialize cached key header if available (optimization to avoid network call)
                let cachedKeyHeader = record.encryptedKeyHeader ? tryJsonParse<EncryptedKeyHeader>(record.encryptedKeyHeader) : undefined

                // Should happen rarely but if deserialization failed, re-fetch from remote
                if (!cachedKeyHeader || !validateKeyHeader(cachedKeyHeader)) {
                    cachedKeyHeader = (await this.#notesProvider.getNote(record.localId))?.sharedSecretEncryptedKeyHeader;
                }

                // Get pending image deletions for this note
                const pendingDeletions = await getPendingImageDeletions(record.localId);
                const toDeletePayloads = pendingDeletions.length > 0
                    ? pendingDeletions.map(key => ({ key }))
                    : undefined;

                if (toDeletePayloads) {
                    console.log(`[SyncService] Deleting payloads for note ${record.localId}:`, pendingDeletions);
                }

                let conflictResult: ConflictResolutionResult | undefined;

                const onVersionConflict = async () => {
                    console.log(`[SyncService] Version conflict for note ${record.localId}`);

                    const freshFile = await this.#notesProvider.getNote(record.localId, { decrypt: false });
                    if (!freshFile) throw new Error('Remote note not found during conflict resolution');
                    cachedKeyHeader = freshFile.sharedSecretEncryptedKeyHeader;

                    const lastModified = freshFile.fileMetadata.updated;
                    const remoteBlob = await this.#notesProvider.getNotePayload(freshFile.fileId, lastModified);
                    let mergedBlob: Uint8Array | undefined = yjsBlob;

                    if (remoteBlob && yjsBlob) {
                        // Merge local and remote Yjs documents (mergeYjsDocuments already applies local updates)
                        mergedBlob = await this.mergeYjsDocuments(record.localId, remoteBlob);
                    } else if (remoteBlob && !yjsBlob) {
                        // Local is empty, preserving remote content
                        console.warn(`[SyncService] Local content empty, preserving remote for ${record.localId}`);
                        mergedBlob = remoteBlob;
                    }

                    // Update local Yjs state with merged blob if we merged
                    if (mergedBlob) {
                        await deleteDocumentUpdates(record.localId);
                        await saveDocumentUpdate(record.localId, mergedBlob);
                    }

                    const result = await this.#notesProvider.updateNote(
                        record.localId,
                        freshFile.fileId,
                        freshFile.fileMetadata.versionTag,
                        doc.metadata,
                        mergedBlob,
                        cachedKeyHeader,
                        { toDeletePayloads }
                    );

                    // Compute hash for the merged blob
                    const mergedHash = mergedBlob
                        ? await computeContentHash(doc.metadata, mergedBlob)
                        : currentHash;

                    // Store result for use after the call returns
                    conflictResult = { result, mergedBlob, mergedHash };

                    return result;
                };

                const result = await this.#notesProvider.updateNote(
                    record.localId,
                    record.remoteFileId,
                    record.versionTag || '',
                    doc.metadata,
                    yjsBlob,
                    cachedKeyHeader,
                    { onVersionConflict, toDeletePayloads }
                );

                // Determine final values based on whether conflict resolution occurred
                const finalHash = conflictResult?.mergedHash || currentHash;
                const finalVersionTag = conflictResult?.result.versionTag || result.versionTag;
                const finalKeyHeader = conflictResult?.result.encryptedKeyHeader || result.encryptedKeyHeader;

                // Serialize key header for caching
                const keyHeaderToCache = finalKeyHeader
                    ? serializeKeyHeader(finalKeyHeader)
                    : undefined;

                await markSynced(record.localId, record.remoteFileId, finalVersionTag, finalHash, keyHeaderToCache);

                // Clear pending image deletions after successful sync
                if (pendingDeletions.length > 0) {
                    await clearPendingImageDeletions(record.localId);
                }
            } catch (error) {
                // If update fails (e.g., version conflict), try to re-fetch and retry
                console.warn('[SyncService] Update failed, will retry on next sync:', error);
                throw error;
            }
        } else {
            // File doesn't exist remotely, create it
            const result = await this.#notesProvider.createNote(
                record.localId,
                doc.metadata,
                yjsBlob, undefined, {
                encrypt: true,
            }
            );
            await markSynced(record.localId, result.fileId, result.versionTag, currentHash);
        }
    }

    /**
     * Process pending image uploads with exponential backoff.
     */
    async processPendingImageUploads(): Promise<void> {
        // Get uploads ready for retry (respects next_retry_at)
        const pendingUploads = await getImageUploadsReadyForRetry();

        for (const upload of pendingUploads) {
            try {
                const syncRecord = await getSyncRecord(upload.noteDocId);
                if (!syncRecord?.remoteFileId || !syncRecord.versionTag) {
                    // Note hasn't been synced yet, skip for now
                    continue;
                }

                await updateImageUploadStatus(upload.id, 'uploading');

                const result = await this.#notesProvider.addImageToNote(
                    upload.noteDocId, // uniqueId - consistent with how notes are tracked
                    syncRecord.versionTag,
                    { file: new Blob([new Uint8Array(upload.blobData)], { type: upload.contentType }) },
                );

                // Update the Yjs document to replace pending reference with permanent one
                await this.updateImageReference(
                    upload.noteDocId,
                    upload.id, // data-pending-id
                    syncRecord.remoteFileId,
                    result.payloadKey
                );

                // Success - update sync record and remove pending upload
                await markSynced(upload.noteDocId, syncRecord.remoteFileId, result.versionTag);
                await deletePendingImageUpload(upload.id);

                console.log(`[SyncService] Image ${upload.id} uploaded as ${result.payloadKey}`);
            } catch (error) {
                console.error(`[SyncService] Image upload failed:`, error);

                // Exponential backoff: schedule next retry
                const nextRetryAt = calculateNextRetryAt(upload.retryCount);
                await incrementImageRetryCount(upload.id);
                await updateImageUploadStatus(upload.id, 'failed');
                await updateImageRetryAt(upload.id, nextRetryAt);

                console.log(`[SyncService] Image ${upload.id} retry scheduled for ${nextRetryAt.toISOString()}`);
            }
        }
    }

    /**
     * Update the Yjs document to replace pending image reference with permanent payloadKey.
     * The new src format is: attachment://fileId/payloadKey
     */
    private async updateImageReference(
        docId: string,
        pendingId: string,
        fileId: string,
        payloadKey: string
    ): Promise<void> {
        const updates = await getDocumentUpdates(docId);
        if (!updates.length) return;

        const ydoc = new Y.Doc();
        for (const update of updates) {
            Y.applyUpdate(ydoc, update);
        }

        const fragment = ydoc.getXmlFragment('prosemirror');
        let found = false;

        // Walk the Yjs XML tree and find the image with data-pending-id
        const replaceInFragment = (node: Y.XmlElement | Y.XmlText | Y.XmlFragment) => {
            if (node instanceof Y.XmlElement) {
                const attrs = node.getAttributes();

                // Check for data-pending-id attribute (use stringGuidsEqual for UUID comparison)
                if (stringGuidsEqual(attrs['data-pending-id'], pendingId)) {
                    // Replace with permanent reference
                    node.setAttribute('src', `attachment://${fileId}/${payloadKey}`);
                    node.removeAttribute('data-pending-id');
                    found = true;
                }

                // Recurse children - need to handle all child types
                for (let i = 0; i < node.length; i++) {
                    const child = node.get(i);
                    if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) {
                        replaceInFragment(child);
                    }
                }
            } else if (node instanceof Y.XmlFragment) {
                for (let i = 0; i < node.length; i++) {
                    const child = node.get(i);
                    if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) {
                        replaceInFragment(child);
                    }
                }
            }
        };

        replaceInFragment(fragment);

        if (found) {
            // Save updated state
            const newUpdate = Y.encodeStateAsUpdate(ydoc);
            await deleteDocumentUpdates(docId);
            await saveDocumentUpdate(docId, newUpdate);

            // Notify the editor that the document was updated
            documentBroadcast.notifyDocumentUpdated(docId);

            console.log(`[SyncService] Updated Yjs doc for ${docId}`);
        }

        ydoc.destroy();
    }

    /**
     * Sync a single note immediately (for debounced saves).
     */
    async syncNote(docId: string): Promise<void> {
        const record = await getSyncRecord(docId);
        if (record) {
            await this.pushNote(record);
        }
    }

    /**
     * Sync a single folder immediately.
     */
    async syncFolder(folderId: string): Promise<void> {
        const record = await getSyncRecord(folderId);
        if (record) {
            await this.pushFolder(record);
        }
    }

    /**
     * Delete a note from Homebase remotely using the stored remoteFileId.
     * This should be called before deleting the local sync record.
     */
    async deleteNoteRemote(docId: string): Promise<void> {
        const record = await getSyncRecord(docId);
        if (record?.remoteFileId) {
            try {
                await this.#notesProvider.deleteNote(record.remoteFileId);
                console.log(`[SyncService] Deleted remote note: ${docId}`);
            } catch (error) {
                console.error(`[SyncService] Failed to delete remote note ${docId}:`, error);
                // Don't throw - local delete should still proceed
            }
        }
    }

    /**
     * Delete a folder from Homebase remotely using the stored remoteFileId.
     * This should be called before deleting the local sync record.
     */
    async deleteFolderRemote(folderId: string): Promise<void> {
        const record = await getSyncRecord(folderId);
        if (record?.remoteFileId) {
            try {
                await this.#folderProvider.deleteFolder(record.remoteFileId);
                console.log(`[SyncService] Deleted remote folder: ${folderId}`);
            } catch (error) {
                console.error(`[SyncService] Failed to delete remote folder ${folderId}:`, error);
                // Don't throw - local delete should still proceed
            }
        }
    }
}
