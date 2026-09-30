import type { HomebaseFile, DeletedHomebaseFile } from '@homebase-id/js-lib/core';
import {
    upsertFolder,
    deleteFolder as deleteLocalFolder,
    getSearchIndexEntry,
    getAllDocIdsByFolder,
    upsertSearchIndex,
    deleteSearchIndexEntry,
    saveDocumentUpdate,
    deleteDocumentUpdates,
    replaceDocumentUpdates,
    getSyncRecord,
    upsertSyncRecord,
    markSynced,
    deleteSyncRecord,
    getAppState,
    resolveSyncErrorsForEntity,
    getSyncErrorCount,
    getPullRetriesDue,
} from '@/lib/db';
import { computeContentHash } from '@/lib/utils/hash';
import { serializeKeyHeader } from '@/lib/utils';
import { extractPreviewTextFromYjs } from '@/lib/yjs-utils';
import { MAIN_FOLDER_ID, STORAGE_KEY_LAST_SYNC } from '../config';
import type { SyncProgress } from '@/types';
import { stringGuidsEqual } from '@homebase-id/js-lib/helpers';
import { documentBroadcast } from '@/lib/broadcast';
import { suspendLiveQueries } from '@/hooks/useLiveQuery';
import type { SyncService } from '../SyncService';
import type { SyncContext } from './context';
import { mergeYjsDocuments, resolveNoteFolderId } from './merge';

/** The part of a deleted file the handleDeleted* methods read; websocket headers satisfy it too. */
export type DeletedFileRef = { fileMetadata: { appData: { uniqueId?: string } } };

/** Handlers pullChanges calls on the SyncService instance, so spies and overrides on it still apply. */
type PullHandlers = Pick<SyncService,
    'handleRemoteFolder' | 'handleDeletedFolder' | 'handleRemoteNote' | 'handleDeletedNote' | 'handleInvitation' | 'handleDeletedInvitation'>;

// A pull at least this large suspends the live list queries until it finishes,
// so PGlite doesn't re-run each one after every pulled row (#153). Smaller
// (websocket-driven) pulls stay fully live.
const BULK_PULL_THRESHOLD = 20;

/**
 * Pull remote changes to local.
 */
export async function pullChanges(
    ctx: SyncContext,
    svc: PullHandlers,
    onProgress?: (progress: SyncProgress) => void,
): Promise<{ folders: number; notes: number }> {
    const lastSync = await getAppState<number>(STORAGE_KEY_LAST_SYNC);
    const { folders, notes, invitations } = await ctx.inboxProcessor.processChanges(lastSync || undefined);
    // One COUNT per pull instead of an UPDATE per handled entity when nothing is unresolved
    const hadErrors = (await getSyncErrorCount()) > 0;

    let folderCount = 0;
    let noteCount = 0;
    const total = folders.length + notes.length + invitations.length;
    let current = 0;

    if (onProgress && total > 0) {
        onProgress({ phase: 'pull', current: 0, total, message: 'Fetching changes...' });
    }

    const resume = total >= BULK_PULL_THRESHOLD ? suspendLiveQueries() : null;
    try {
        // Process folders first (notes depend on folders via folderId)
        for (const remoteFolderOrDeleted of folders) {
            try {
                if (remoteFolderOrDeleted.fileState === 'deleted') {
                    await svc.handleDeletedFolder(remoteFolderOrDeleted as DeletedHomebaseFile);
                } else {
                    await svc.handleRemoteFolder(remoteFolderOrDeleted);
                }
                folderCount++;
                current++;
                if (onProgress) onProgress({ phase: 'pull', current, total, message: `Processing folder ${folderCount}/${folders.length}` });
                // Resolve any previous errors for this entity
                const id = remoteFolderOrDeleted.fileMetadata?.appData?.uniqueId;
                if (hadErrors && id) await resolveSyncErrorsForEntity(id);
            } catch (error) {
                console.error('[SyncService] Error processing remote folder:', error);
                // Track error in database
                const id = remoteFolderOrDeleted.fileMetadata?.appData?.uniqueId ?? '';
                await ctx.logSyncError(id, 'folder', 'pull', error);
            }
        }

        // Process notes (parallel with concurrency limit, like pushChanges)
        const PULL_CONCURRENCY = 5;
        for (let i = 0; i < notes.length; i += PULL_CONCURRENCY) {
            const batch = notes.slice(i, i + PULL_CONCURRENCY);
            const results = await Promise.allSettled(batch.map(n => n.fileState === 'deleted'
                ? svc.handleDeletedNote(n as DeletedHomebaseFile)
                : svc.handleRemoteNote(n)));

            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                if (result.status === 'fulfilled') {
                    noteCount++;
                    current++;
                    if (onProgress) onProgress({ phase: 'pull', current, total, message: `Processing note ${noteCount}/${notes.length}` });
                    // Resolve any previous errors
                    const id = batch[j].fileMetadata?.appData?.uniqueId;
                    if (hadErrors && id) await resolveSyncErrorsForEntity(id);
                } else {
                    console.error('[SyncService] Error processing remote note:', result.reason);
                    const id = batch[j].fileMetadata?.appData?.uniqueId ?? '';
                    await ctx.logSyncError(id, 'note', 'pull', result.reason);
                }
            }
        }

        // Retry notes whose pull failed on an earlier sync; they won't be in `notes`
        // again unless modified remotely (#147). Ids handled above are skipped.
        const seen = new Set(notes.map(n => n.fileMetadata?.appData?.uniqueId).filter(Boolean));
        for (const id of await getPullRetriesDue()) {
            if (seen.has(id)) continue;
            try {
                const record = await getSyncRecord(id);
                const header = await ctx.notesProvider.getNote(id, record?.authorOdinId, { decrypt: false });
                if (!header) {
                    // Gone remotely; its deletion arrives through the normal pull
                    await resolveSyncErrorsForEntity(id);
                    continue;
                }
                await svc.handleRemoteNote(header);
                await resolveSyncErrorsForEntity(id);
                noteCount++;
            } catch (error) {
                console.error('[SyncService] Error retrying remote note pull:', error);
                await ctx.logSyncError(id, 'note', 'pull', error);
            }
        }

        // Process invitations (collaboration sharing)
        for (const invitationOrDeleted of invitations) {
            try {
                if (invitationOrDeleted.fileState === 'deleted') {
                    await svc.handleDeletedInvitation(invitationOrDeleted as DeletedHomebaseFile);
                } else {
                    await svc.handleInvitation(invitationOrDeleted);
                }
                current++;
                if (onProgress) onProgress({ phase: 'pull', current, total, message: `Processing invitation` });
            } catch (error) {
                console.error('[SyncService] Error processing invitation:', error);
            }
        }
    } finally {
        resume?.();
    }

    return { folders: folderCount, notes: noteCount };
}

/**
 * Handle a remote folder (create or update locally).
 */
export async function handleRemoteFolder(ctx: SyncContext, remoteFile: HomebaseFile<string>): Promise<void> {
    const uniqueId = remoteFile.fileMetadata.appData.uniqueId;

    const content = await ctx.folderProvider.dsrToFolderFileContent(remoteFile, true,);
    if (!content || !uniqueId) {
        console.error(`[SyncService] Failed to convert remote folder ${remoteFile.fileId} to folder file content`);
        return;
    }
    const folderName = content?.name || 'Untitled Folder';

    const existingRecord = await getSyncRecord(uniqueId);
    // Deleted here; the remote delete is still being retried (#258)
    if (existingRecord?.syncStatus === 'pending_delete') return;

    if (!existingRecord) {
        // New folder from remote
        await upsertFolder(uniqueId, folderName);
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
        await upsertFolder(uniqueId, folderName);
        await markSynced(uniqueId, remoteFile.fileId, remoteFile.fileMetadata.versionTag, undefined, serializeKeyHeader(remoteFile.sharedSecretEncryptedKeyHeader));
    }
}

/**
 * Handle a deleted folder from remote.
 * Also deletes all notes in that folder locally.
 */
export async function handleDeletedFolder(deleted: DeletedFileRef): Promise<void> {
    const uniqueId = deleted.fileMetadata.appData.uniqueId;
    if (!uniqueId || uniqueId === MAIN_FOLDER_ID) return; // Never delete Main folder

    // Delete all notes in this folder locally - use indexed query instead of fetching all
    const docIds = await getAllDocIdsByFolder(uniqueId);

    for (const docId of docIds) {
        try {
            await deleteSearchIndexEntry(docId);
            await deleteDocumentUpdates(docId);
            await deleteSyncRecord(docId);
        } catch (error) {
            console.warn(`[SyncService] Failed to delete local note ${docId} from deleted folder:`, error);
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
export async function handleRemoteNote(ctx: SyncContext, remoteFile: HomebaseFile<unknown>): Promise<void> {
    const uniqueId = remoteFile.fileMetadata.appData.uniqueId;
    if (!uniqueId) {
        console.error(`[SyncService] Failed to convert remote note ${remoteFile.fileId} to note file content`);
        return;
    }
    const existingRecord = await getSyncRecord(uniqueId);
    // Deleted here; the remote delete is still being retried (#265)
    if (existingRecord?.syncStatus === 'pending_delete') return;

    // Unchanged note: skip decryption and payload fetch entirely
    if (stringGuidsEqual(remoteFile.fileMetadata.versionTag, existingRecord?.versionTag)) {
        return;
    }

    const content = await ctx.notesProvider.dsrToContent(remoteFile, true,);
    if (!content) {
        // Throw so the pull loop records a sync error and retries this note (#147)
        throw new Error('Could not read remote note content');
    }
    const noteTitle = content?.title || 'Untitled';

    // Get remote Yjs blob — use senderOdinId for peer-based fetch when note is from another identity
    const lastModified = remoteFile.fileMetadata.updated;
    const authorOdinId = existingRecord?.authorOdinId
        || remoteFile.fileMetadata.senderOdinId
        || remoteFile.fileMetadata.originalAuthor;
    const remoteBlob = await ctx.notesProvider.getNotePayload(remoteFile.fileId, authorOdinId, lastModified);

    if (!existingRecord) {
        // New note from remote
        if (remoteBlob) {
            await saveDocumentUpdate(uniqueId, remoteBlob);
        }
        // Build local metadata from simplified content + groupId
        const folderId = await resolveNoteFolderId(remoteFile.fileMetadata.appData.groupId);
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
            shareDescription: content?.shareDescription,
            shareIndexable: content?.shareIndexable,
            isPublic: content?.isPublic,
            archivalStatus: remoteFile.fileMetadata.appData.archivalStatus ?? 0,
            isCollaborative: content?.isCollaborative,
            circleIds: content?.circleIds,
            recipients: content?.recipients,
            lastEditedBy: content?.lastEditedBy,
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
            authorOdinId: authorOdinId || undefined,
            globalTransitId: remoteFile.fileMetadata.globalTransitId || undefined,
        });
    } else {
        // Existing note - merge Yjs documents (CRDT handles conflicts automatically)
        let plainTextContent = '';
        let mergedBlob: Uint8Array | undefined;
        if (remoteBlob) {
            mergedBlob = await mergeYjsDocuments(uniqueId, remoteBlob);
            // Atomically swap old updates for the merged state
            await replaceDocumentUpdates(uniqueId, mergedBlob);
            // Extract plain text content from the merged Yjs blob for the note list display
            plainTextContent = await extractPreviewTextFromYjs(uniqueId, mergedBlob);

            // Notify the editor that the document was updated
            documentBroadcast.notifyDocumentUpdated(uniqueId);
        }
        // Build local metadata from simplified content + groupId
        const folderId = await resolveNoteFolderId(remoteFile.fileMetadata.appData.groupId);


        // Get existing document to preserve the created timestamp (if available)
        const existingDoc = await getSearchIndexEntry(uniqueId);
        const existingCreated = existingDoc?.metadata.timestamps?.created;
        // Fallback to remote userDate if no local created timestamp exists
        const remoteTimestamp = new Date(
            remoteFile.fileMetadata.appData.userDate || Date.now()
        ).toISOString();

        // Always use remote updated time for the modified timestamp to ensure proper date grouping
        const updatedAt = new Date(remoteFile.fileMetadata.updated).toISOString();

        const updatedMetadata = {
            title: noteTitle,
            folderId,
            tags: content?.tags,
            timestamps: { created: existingCreated ?? remoteTimestamp, modified: updatedAt },
            excludeFromAI: content?.excludeFromAI,
            isPinned: content?.isPinned,
            shareDescription: content?.shareDescription,
            shareIndexable: content?.shareIndexable,
            isPublic: content?.isPublic,
            archivalStatus: remoteFile.fileMetadata.appData.archivalStatus ?? 0,
            isCollaborative: content?.isCollaborative,
            circleIds: content?.circleIds,
            recipients: content?.recipients,
            lastEditedBy: content?.lastEditedBy,
        };

        const contentHash = mergedBlob ? await computeContentHash(updatedMetadata, mergedBlob) : undefined;

        await upsertSearchIndex({
            docId: uniqueId,
            title: noteTitle,
            plainTextContent,
            metadata: updatedMetadata
        });
        await markSynced(uniqueId, remoteFile.fileId, remoteFile.fileMetadata.versionTag, contentHash, serializeKeyHeader(remoteFile.sharedSecretEncryptedKeyHeader), authorOdinId, remoteFile.fileMetadata.globalTransitId);
    }
}

/**
 * Handle a deleted note from remote.
 */
export async function handleDeletedNote(deleted: DeletedFileRef): Promise<void> {
    const uniqueId = deleted.fileMetadata.appData.uniqueId;
    if (!uniqueId) return;

    await deleteSearchIndexEntry(uniqueId);
    await deleteDocumentUpdates(uniqueId);
    await deleteSyncRecord(uniqueId);
}
