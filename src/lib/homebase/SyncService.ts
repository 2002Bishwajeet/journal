import * as Y from 'yjs';
import type { DotYouClient, HomebaseFile, DeletedHomebaseFile, PayloadDescriptor } from '@homebase-id/js-lib/core';
import { FolderDriveProvider } from './FolderDriveProvider';
import { NotesDriveProvider } from './NotesDriveProvider';
import { InboxProcessor } from './InboxProcessor';
import {
    getAllFolders,
    createFolder as createLocalFolder,
    deleteFolder as deleteLocalFolder,
    getAllDocuments,
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
} from '@/lib/db';
import { computeContentHash } from '@/lib/utils/hash';
import { extractPreviewTextFromYjs, tryJsonParse } from '@/lib/utils';
import { MAIN_FOLDER_ID, STORAGE_KEY_LAST_SYNC } from './config';
import type { FolderFile, NoteFileContent, SyncRecord, SyncProgress } from '@/types';
import { stringGuidsEqual } from '@homebase-id/js-lib/helpers';

export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncResult {
    pulled: { folders: number; notes: number };
    pushed: { folders: number; notes: number };
    errors: string[];
}

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

    constructor(dotYouClient: DotYouClient) {
        this.#folderProvider = new FolderDriveProvider(dotYouClient);
        this.#notesProvider = new NotesDriveProvider(dotYouClient);
        this.#inboxProcessor = new InboxProcessor(dotYouClient);
    }

    getStatus(): SyncStatus {
        return this.#status;
    }

    /**
     * Check if network is available.
     * Checks both navigator.onLine and internal state if managed.
     */
    isOnline(): boolean {
        if (typeof navigator === 'undefined') return true;
        return navigator.onLine;
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
            });
        } else {
            // Update existing - remote wins for folders (simple content)
            await createLocalFolder(uniqueId, folderName);
            await markSynced(uniqueId, remoteFile.fileId, remoteFile.fileMetadata.versionTag);
        }
    }

    /**
     * Handle a deleted folder from remote.
     */
    async handleDeletedFolder(deleted: DeletedHomebaseFile): Promise<void> {
        const uniqueId = deleted.fileMetadata.appData.uniqueId;
        if (!uniqueId || uniqueId === MAIN_FOLDER_ID) return; // Never delete Main folder

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

        // Parse the content - ensure title has a default value
        const content = remoteFile.fileMetadata.appData.content;
        const noteTitle = content?.title || 'Untitled';
        const existingRecord = await getSyncRecord(uniqueId);

        if (stringGuidsEqual(remoteFile.fileMetadata.versionTag, existingRecord?.versionTag)) {
            // No changes - skip processing
            return;
        }

        // Get remote Yjs blob
        const remoteBlob = await this.#notesProvider.getNotePayload(remoteFile.fileId);

        if (!existingRecord) {
            // New note from remote
            if (remoteBlob) {
                await saveDocumentUpdate(uniqueId, remoteBlob);
            }
            // Build local metadata from simplified content + groupId
            const folderId = remoteFile.fileMetadata.appData.groupId || MAIN_FOLDER_ID;
            const now = new Date().toISOString();

            // Extract plain text content from the Yjs blob for the note list display
            const plainTextContent = remoteBlob
                ? await extractPreviewTextFromYjs(uniqueId, remoteBlob)
                : '';

            await upsertSearchIndex({
                docId: uniqueId,
                title: noteTitle,
                plainTextContent,
                metadata: {
                    title: noteTitle,
                    folderId,
                    tags: content?.tags,
                    timestamps: { created: now, modified: now },
                    excludeFromAI: content?.excludeFromAI,
                },
            });
            await upsertSyncRecord({
                localId: uniqueId,
                entityType: 'note',
                remoteFileId: remoteFile.fileId,
                versionTag: remoteFile.fileMetadata.versionTag,
                lastSyncedAt: new Date().toISOString(),
                syncStatus: 'synced',
            });
        } else {
            // Existing note - merge Yjs documents (CRDT handles conflicts automatically)
            let plainTextContent = '';
            if (remoteBlob) {
                const mergedBlob = await this.mergeYjsDocuments(uniqueId, remoteBlob);
                // Clear old updates and save merged state
                await deleteDocumentUpdates(uniqueId);
                await saveDocumentUpdate(uniqueId, mergedBlob);
                // Extract plain text content from the merged Yjs blob for the note list display
                plainTextContent = await extractPreviewTextFromYjs(uniqueId, mergedBlob);
            }
            // Build local metadata from simplified content + groupId
            const folderId = remoteFile.fileMetadata.appData.groupId || MAIN_FOLDER_ID;
            const now = new Date().toISOString();

            await upsertSearchIndex({
                docId: uniqueId,
                title: noteTitle,
                plainTextContent,
                metadata: {
                    title: noteTitle,
                    folderId,
                    tags: content?.tags,
                    timestamps: { created: now, modified: now },
                    excludeFromAI: content?.excludeFromAI,
                },
            });
            await markSynced(uniqueId, remoteFile.fileId, remoteFile.fileMetadata.versionTag);
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

        // Create merged document
        const mergedDoc = new Y.Doc();

        // Apply local updates first
        for (const update of localUpdates) {
            Y.applyUpdate(mergedDoc, update);
        }

        // Apply remote update (Yjs handles CRDT merge automatically)
        Y.applyUpdate(mergedDoc, remoteBlob);

        // Export merged state as a single update
        return Y.encodeStateAsUpdate(mergedDoc);
    }

    /**
     * Push a local folder to remote.
     * Always verifies remote file existence before updating.
     */
    async pushFolder(record: SyncRecord): Promise<void> {
        const folders = await getAllFolders();
        const folder = folders.find(f => f.id === record.localId);

        if (!folder) {
            // Folder was deleted locally, clean up sync record
            await deleteSyncRecord(record.localId);
            return;
        }

        const folderFile: FolderFile = {
            name: folder.name,
            isCollaborative: false, // V2 placeholder
            needsPassword: false,   // V2 placeholder
        };

        // Always check if file exists remotely first (handles offline-created folders)
        const existingFile = await this.#folderProvider.getFolder(record.localId);

        if (existingFile) {
            // File exists remotely, update it
            try {
                const result = await this.#folderProvider.updateFolder(
                    existingFile.fileId,
                    existingFile.fileMetadata.versionTag,
                    folderFile
                );
                await markSynced(record.localId, existingFile.fileId, result.versionTag);
            } catch (error) {
                console.warn('[SyncService] Folder update failed, will retry on next sync:', error);
                throw error;
            }
        } else {
            // File doesn't exist remotely, create it
            const result = await this.#folderProvider.createFolder(record.localId, folderFile);
            await markSynced(record.localId, result.fileId, result.versionTag);
        }
    }

    /**
     * Push a local note to remote.
     * Always verifies remote file existence before updating.
     */
    async pushNote(record: SyncRecord): Promise<void> {
        const docs = await getAllDocuments();
        const doc = docs.find(d => d.docId === record.localId);

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
        if (!doc.plainTextContent || doc.plainTextContent.trim() === '') {
            const emptyDoc = new Y.Doc();
            yjsBlob = Y.encodeStateAsUpdate(emptyDoc);
        } else if (updates.length > 0) {
            const ydoc = new Y.Doc();
            for (const update of updates) {
                Y.applyUpdate(ydoc, update);
            }
            yjsBlob = Y.encodeStateAsUpdate(ydoc);
        }

        // Always check if file exists remotely first (handles offline-created notes)
        const existingFile = await this.#notesProvider.getNote(record.localId);

        // Compute content hash to check if upload is needed
        const currentHash = await computeContentHash(doc.metadata, yjsBlob);

        // If we have a stored hash and it matches current hash, AND the remote file exists, skip upload
        if (record.contentHash === currentHash && existingFile) {
            console.debug(`[SyncService] Skipping upload for note ${record.localId} - content unchanged (Hash: ${currentHash})`);

            // If it was marked pending but content is actually same as last sync (e.g. reverted change),
            // just mark it as synced to clear the pending state.
            if (record.syncStatus === 'pending' || record.syncStatus === 'error') {
                await markSynced(record.localId, existingFile.fileId, existingFile.fileMetadata.versionTag, currentHash);
            }
            return;
        }

        if (existingFile) {
            // File exists remotely - check version tag to determine if merge is needed
            const remoteVersionTag = existingFile.fileMetadata.versionTag;
            const localVersionTag = record.versionTag;

            // Check if remote has changed since our last sync
            const remoteHasChanged = !stringGuidsEqual(remoteVersionTag, localVersionTag);

            let blobToUpload = yjsBlob;

            if (remoteHasChanged) {
                // Version tags differ - remote has been updated, need to merge before pushing
                console.log(`[SyncService] Version tag mismatch for note ${record.localId}, merging with remote`);

                // Get remote Yjs blob for merging
                const remoteBlob = await this.#notesProvider.getNotePayload(existingFile.fileId);

                if (remoteBlob && yjsBlob) {
                    // Merge local and remote Yjs documents
                    const mergedBlob = await this.mergeYjsDocuments(record.localId, remoteBlob);
                    // The mergeYjsDocuments already applies local updates, so merge with our new blob
                    const mergedDoc = new Y.Doc();
                    Y.applyUpdate(mergedDoc, mergedBlob);
                    Y.applyUpdate(mergedDoc, yjsBlob);
                    blobToUpload = Y.encodeStateAsUpdate(mergedDoc);
                } else if (remoteBlob && !yjsBlob) {
                    // Local is empty, use remote
                    blobToUpload = remoteBlob;
                }
                // else: remote is empty or both empty, use local yjsBlob as-is
            } else {
                // Version tags match - no remote changes, just push our local changes
                console.debug(`[SyncService] Version tags match for note ${record.localId}, pushing local changes`);
            }

            try {
                const result = await this.#notesProvider.updateNote(
                    record.localId, // uniqueId
                    existingFile.fileId,
                    remoteVersionTag, // Use the current remote version tag
                    doc.metadata,
                    blobToUpload
                );
                // Update local Yjs state with merged blob if we merged
                if (remoteHasChanged && blobToUpload) {
                    await deleteDocumentUpdates(record.localId);
                    await saveDocumentUpdate(record.localId, blobToUpload);
                }
                await markSynced(record.localId, existingFile.fileId, result.versionTag, currentHash);
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
                yjsBlob
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

                // Get current note to find payload count
                const note = await this.#notesProvider.getNote(upload.noteDocId);
                const payloadCount = note?.fileMetadata.payloads?.filter(
                    (p: PayloadDescriptor) => p.key.startsWith('jrnl_img')
                ).length || 0;

                await updateImageUploadStatus(upload.id, 'uploading');

                const result = await this.#notesProvider.addImageToNote(
                    upload.noteDocId, // uniqueId - consistent with how notes are tracked
                    syncRecord.versionTag,
                    { file: new Blob([new Uint8Array(upload.blobData)], { type: upload.contentType }) },
                    payloadCount
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
                if (attrs['data-pending-id'] === pendingId) {
                    // Replace with permanent reference
                    node.setAttribute('src', `attachment://${fileId}/${payloadKey}`);
                    node.removeAttribute('data-pending-id');
                    found = true;
                    console.log(`[SyncService] Updated image reference: ${pendingId} -> attachment://${fileId}/${payloadKey}`);
                }
                // Recurse children
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
