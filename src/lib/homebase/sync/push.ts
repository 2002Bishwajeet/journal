import * as Y from 'yjs';
import type { EncryptedKeyHeader } from '@homebase-id/js-lib/core';
import {
    getFolderById,
    getFolderNotesToShare,
    getSearchIndexEntry,
    getDocumentUpdates,
    replaceDocumentUpdates,
    markSynced,
    clearCachedKeyHeader,
    deleteSyncRecord,
    getPendingSyncRecords,
    getSyncRecord,
    resolveSyncErrorsForEntity,
    getEntityIdsInBackoff,
    getPendingImageDeletions,
    getPendingImageUploads,
    clearPendingImageDeletions,
    deleteLocalImagesByKeys,
    removePendingImageDeletion,
    setNoteFolderLocal,
} from '@/lib/db';
import { computeContentHash } from '@/lib/utils/hash';
import { serializeKeyHeader, tryJsonParse, validateKeyHeader } from '@/lib/utils';
import { collectImageRefs } from '@/lib/yjs/imageRefs';
import { ydocFromUpdates } from '@/lib/yjs/loadDoc';
import type { FolderFile, SyncRecord, SyncProgress } from '@/types';
import type { SyncService } from '../SyncService';
import type { SyncContext } from './context';
import { mergeYjsDocuments, resolveNoteFolderId } from './merge';
import { isViewOnly } from '../shareTargets';

// When this tab last sent the owner an edit push, per note. In memory only: a reload may push once more (#746).
const EDIT_PUSH_WINDOW_MS = 15 * 60 * 1000;
const lastEditPushAt = new Map<string, number>();

/** Methods pushChanges calls on the SyncService instance, so spies and overrides on it still apply. */
type PushHandlers = Pick<SyncService, 'pushFolder' | 'pushNote' | 'deleteFolderRemote' | 'deleteNoteRemote'>;

/** Internal type for tracking conflict resolution state in pushNote */
type ConflictResolutionResult = {
    result: { versionTag: string; encryptedKeyHeader?: EncryptedKeyHeader };
    mergedBlob?: Uint8Array;
    mergedHash: string;
};

/**
 * Push local changes to remote with parallel processing for notes.
 */
export async function pushChanges(
    ctx: SyncContext,
    svc: PushHandlers,
    onProgress?: (progress: SyncProgress) => void,
): Promise<{ folders: number; notes: number }> {
    let folderCount = 0;
    let noteCount = 0;

    // Skip records currently backing off from a recent failure (#146). These three
    // reads are independent, so fetch them concurrently instead of sequentially.
    const [inBackoff, allPendingFolders, allPendingNotes, folderDeletes, noteDeletes] = await Promise.all([
        getEntityIdsInBackoff('push'),
        getPendingSyncRecords('folder'),
        getPendingSyncRecords('note'),
        getPendingSyncRecords('folder', 'pending_delete'),
        getPendingSyncRecords('note', 'pending_delete'),
    ]);

    // Retry remote folder and note deletes that failed earlier (#258, #265)
    for (const record of folderDeletes) {
        if (!inBackoff.has(record.localId)) await svc.deleteFolderRemote(record.localId);
    }
    for (const record of noteDeletes) {
        if (!inBackoff.has(record.localId)) await svc.deleteNoteRemote(record.localId);
    }

    // Push pending folders first (sequential - usually few folders)
    const pendingFolders = allPendingFolders.filter(r => !inBackoff.has(r.localId));
    const pendingNotes = allPendingNotes.filter(r => !inBackoff.has(r.localId));
    const total = pendingFolders.length + pendingNotes.length;
    let current = 0;

    if (onProgress && total > 0) {
        onProgress({ phase: 'push', current: 0, total, message: 'Pushing changes...' });
    }
    for (const record of pendingFolders) {
        try {
            await svc.pushFolder(record);
            folderCount++;
            current++;
            if (onProgress) onProgress({ phase: 'push', current, total, message: `Pushing folder ${folderCount}/${pendingFolders.length}` });
            await resolveSyncErrorsForEntity(record.localId);
        } catch (error) {
            console.error('[SyncService] Error pushing folder:', error);
            await ctx.logSyncError(record.localId, 'folder', 'push', error);
        }
    }

    // Push pending notes (parallel with concurrency limit)
    // pendingNotes array is already fetched above
    const CONCURRENCY = 5;

    for (let i = 0; i < pendingNotes.length; i += CONCURRENCY) {
        const batch = pendingNotes.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map(r => svc.pushNote(r)));

        for (let j = 0; j < results.length; j++) {
            if (results[j].status === 'fulfilled') {
                noteCount++;
                current++;
                if (onProgress) onProgress({ phase: 'push', current, total, message: `Pushing note ${noteCount}/${pendingNotes.length}` });
                await resolveSyncErrorsForEntity(batch[j].localId);
            } else {
                console.error('[SyncService] Error pushing note:', (results[j] as PromiseRejectedResult).reason);
                await ctx.logSyncError(batch[j].localId, 'note', 'push', (results[j] as PromiseRejectedResult).reason);
            }
        }
    }

    return { folders: folderCount, notes: noteCount };
}

/**
 * Push a local folder to remote.
 * Always verifies remote file existence before updating.
 */
export async function pushFolder(ctx: SyncContext, record: SyncRecord): Promise<void> {
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
        isPublic: folder.isPublic,
    };

    // A shared folder's link card (#644), redrawn when its name or public-note count changed
    // since it was drawn. The card the remote file names is what it was last drawn from.
    let remoteCard: FolderFile['card'];
    if (folder.isPublic && record.remoteFileId) {
        const existing = await ctx.folderProvider.getFolder(record.localId).catch(() => null);
        const raw: unknown = existing?.fileMetadata.appData.content;
        remoteCard = (typeof raw === 'string' ? tryJsonParse<FolderFile>(raw) : (raw as FolderFile | undefined))?.card;
    }
    const cardUpload = folder.isPublic
        ? await ctx.folderProvider.drawCardIfStale(folderFile, (await getFolderNotesToShare(record.localId, false)).length, remoteCard)
        : null;
    if (cardUpload) folderFile.card = cardUpload.card;

    // Updates the folder on Homebase over its latest version.
    const updateExisting = async () => {
        const existingFile = await ctx.folderProvider.getFolder(record.localId);
        if (!existingFile) throw new Error('Remote folder not found during conflict resolution');
        // Keep fields this device doesn't track (colour, ...): only the name comes from local
        const remote: unknown = existingFile.fileMetadata.appData.content;
        const remoteContent = (typeof remote === 'string' ? tryJsonParse<FolderFile>(remote) : remote) ?? {};
        const updated = await ctx.folderProvider.updateFolder(
            existingFile.fileId,
            existingFile.fileMetadata.versionTag,
            { ...remoteContent, ...folderFile },
            cardUpload?.image
        );
        return { fileId: existingFile.fileId, ...updated };
    };
    const onVersionConflict = async () => {
        console.warn(`[SyncService] Version conflict detected for folder ${record.localId}, will update`);
        return updateExisting();
    };

    // An already-pushed folder is updated: a create with its uniqueId is rejected
    // (existingFileWithUniqueId), so sharing or renaming it would never reach Homebase.
    // ponytail: one header fetch per folder push, so remote-only fields (colour) survive.
    const result = record.remoteFileId
        ? await updateExisting()
        : await ctx.folderProvider.createFolder(record.localId, folderFile, { onVersionConflict, cardImage: cardUpload?.image });
    await markSynced(record.localId, result.fileId, result.versionTag);

}

/** Per note, the push in flight (or queued last): a second push waits for it (#760). */
const noteQueues = new Map<string, Promise<void>>();

/**
 * Push a local note to remote, one push per note at a time. The sync engine's push and
 * a publish's forced push of the same unsynced note would otherwise both create the file
 * (existingFileWithUniqueId) or upload over the same version tag (versionTagMismatch).
 * A push that had to wait re-reads its sync record, which the push before it updated.
 */
export async function pushNote(ctx: SyncContext, record: SyncRecord): Promise<void> {
    const id = record.localId;
    const previous = noteQueues.get(id);
    const run = (async () => {
        if (previous) {
            await previous;
            const fresh = await getSyncRecord(id);
            if (!fresh) return; // note and record were removed while waiting
            record = fresh;
        }
        await pushNoteNow(ctx, record);
    })();
    const tail = run.catch(() => undefined);
    noteQueues.set(id, tail);
    void tail.then(() => {
        if (noteQueues.get(id) === tail) noteQueues.delete(id);
    });
    return run;
}

/**
 * Push a local note to remote.
 * Always verifies remote file existence before updating.
 */
async function pushNoteNow(ctx: SyncContext, record: SyncRecord): Promise<void> {
    const doc = await getSearchIndexEntry(record.localId);

    if (!doc) {
        // Note was deleted locally, clean up sync record
        await deleteSyncRecord(record.localId);
        return;
    }

    // A note the host can only view never sends a peer update (#897): the editor is read-only
    // too, so anything here came from the owner. Mark it synced so it doesn't stay pending.
    if (isViewOnly({ ...doc.metadata, authorOdinId: doc.metadata.authorOdinId ?? record.authorOdinId }, ctx.hostIdentity)) {
        if (record.remoteFileId && record.syncStatus !== 'synced') {
            await markSynced(record.localId, record.remoteFileId, record.versionTag || '', record.contentHash, undefined, undefined, undefined, record.dirtyGeneration);
        }
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

    // Decide emptiness from the update log, not the plain-text preview: an image-only
    // note has an empty preview (preview extraction ignores embeds) but real content in
    // document_updates. Pushing a fresh empty doc over it would wipe the remote payload
    // and the stored hash would prevent correction (BUG-01).
    if (updates.length === 0) {
        // Nothing locally — push a clean empty doc (preserves the original intent of
        // avoiding stale/invalid remote state for truly empty notes).
        const emptyDoc = new Y.Doc();
        yjsBlob = Y.encodeStateAsUpdate(emptyDoc);
        emptyDoc.destroy();
    } else {
        // Use try-finally to ensure Y.Doc cleanup even on exception
        const ydoc = ydocFromUpdates(updates);
        try {
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
                await markSynced(record.localId, record.remoteFileId, record.versionTag || '', currentHash, undefined, undefined, undefined, record.dirtyGeneration);
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
                cachedKeyHeader = (await ctx.notesProvider.getNote(record.localId, record.authorOdinId))?.sharedSecretEncryptedKeyHeader;
            }

            // Get pending image deletions for this note, minus any payload the doc still
            // shows on this note's file (e.g. undone after the tracker's 2s timer, #174)
            const pendingDeletions: string[] = [];
            // Hold them while one of this note's images is still to upload: its key is
            // the next index after the max existing one, so deleting first would hand it
            // the deleted key (a changed cover always would) and a stale cached image.
            const uploadsWaiting = (await getPendingImageUploads(record.localId)).some(u => !u.payloadKey);
            const queuedDeletions = uploadsWaiting ? [] : await getPendingImageDeletions(record.localId);
            const referencedKeys = new Set<string>();
            if (queuedDeletions.length > 0) {
                const referencedDoc = ydocFromUpdates([yjsBlob]);
                try {
                    for (const ref of collectImageRefs(referencedDoc.getXmlFragment('prosemirror'))) {
                        if (ref.fileId === record.remoteFileId) referencedKeys.add(ref.payloadKey);
                    }
                } finally {
                    referencedDoc.destroy();
                }
            }
            for (const payloadKey of queuedDeletions) {
                if (referencedKeys.has(payloadKey)) {
                    await removePendingImageDeletion(record.localId, payloadKey);
                } else {
                    pendingDeletions.push(payloadKey);
                }
            }
            const toDeletePayloads = pendingDeletions.length > 0
                ? pendingDeletions.map(key => ({ key }))
                : undefined;

            if (toDeletePayloads) {
                console.log(`[SyncService] Deleting payloads for note ${record.localId}:`, pendingDeletions);
            }

            let conflictResult: ConflictResolutionResult | undefined;

            const onVersionConflict = async () => {
                console.log(`[SyncService] Version conflict for note ${record.localId}`);
                const freshFile = await ctx.notesProvider.getNote(record.localId, record.authorOdinId, { decrypt: false });
                if (!freshFile) throw new Error('Remote note not found during conflict resolution');
                cachedKeyHeader = freshFile.sharedSecretEncryptedKeyHeader;

                const lastModified = freshFile.fileMetadata.updated;
                const remoteBlob = await ctx.notesProvider.getNotePayload(freshFile.fileId, record.authorOdinId, lastModified);
                let mergedBlob: Uint8Array | undefined = yjsBlob;

                if (remoteBlob && yjsBlob) {
                    mergedBlob = await mergeYjsDocuments(record.localId, remoteBlob);
                } else if (remoteBlob && !yjsBlob) {
                    console.warn(`[SyncService] Local content empty, preserving remote for ${record.localId}`);
                    mergedBlob = remoteBlob;
                }

                if (mergedBlob) {
                    await replaceDocumentUpdates(record.localId, mergedBlob);
                }
                // Merge only the content: keep the server's folder (#257), unless that
                // folder no longer exists locally (#259, same orphan check as handleRemoteNote).
                const serverFolderId = await resolveNoteFolderId(freshFile.fileMetadata.appData?.groupId);
                const mergedMetadata = { ...doc.metadata, folderId: serverFolderId };
                const result = await ctx.notesProvider.updateNote(
                    record.localId,
                    freshFile.fileId,
                    freshFile.fileMetadata.versionTag,
                    mergedMetadata,
                    record.authorOdinId,
                    freshFile.fileMetadata.globalTransitId,
                    mergedBlob,
                    cachedKeyHeader,
                    { toDeletePayloads }
                );

                // Mirror the server's folder locally so the next push doesn't revert it
                if (serverFolderId !== doc.metadata.folderId) {
                    await setNoteFolderLocal(record.localId, serverFolderId, doc.metadata.folderId);
                }

                // Compute hash for the merged blob
                const mergedHash = mergedBlob
                    ? await computeContentHash(mergedMetadata, mergedBlob)
                    : currentHash;

                // Store result for use after the call returns
                conflictResult = { result, mergedBlob, mergedHash };

                return result;
            };

            // A collaborator's edit pushes the owner, at most once per note per window (#746)
            const isCollaboratorEdit = !!record.authorOdinId && record.authorOdinId !== ctx.hostIdentity;
            const notifyOwner = isCollaboratorEdit
                && Date.now() - (lastEditPushAt.get(record.localId) ?? -Infinity) >= EDIT_PUSH_WINDOW_MS;

            const result = await ctx.notesProvider.updateNote(
                record.localId,
                record.remoteFileId,
                record.versionTag || '',
                doc.metadata,
                record.authorOdinId,
                record.globalTransitId,
                yjsBlob,
                cachedKeyHeader,
                { onVersionConflict, toDeletePayloads, notifyOwner }
            );
            if (notifyOwner) lastEditPushAt.set(record.localId, Date.now());

            // Determine final values based on whether conflict resolution occurred
            const finalHash = conflictResult?.mergedHash || currentHash;
            const finalVersionTag = conflictResult?.result.versionTag || result.versionTag;
            const finalKeyHeader = conflictResult?.result.encryptedKeyHeader || result.encryptedKeyHeader;

            // Serialize key header for caching
            const keyHeaderToCache = finalKeyHeader
                ? serializeKeyHeader(finalKeyHeader)
                : undefined;

            await markSynced(record.localId, record.remoteFileId, finalVersionTag, finalHash, keyHeaderToCache, undefined, undefined, record.dirtyGeneration);

            // Clear pending image deletions after successful sync
            if (pendingDeletions.length > 0) {
                await clearPendingImageDeletions(record.localId, pendingDeletions);
                await deleteLocalImagesByKeys(record.localId, pendingDeletions);
            }
        } catch (error) {
            // WebCrypto throws OperationError when the cached key header can't be
            // decrypted with this session's shared secret. validateKeyHeader only checks
            // shape, so such a header is re-used on every retry and the note never syncs
            // again. Drop it so the next push re-fetches a fresh one from the server.
            // (Duck-typed rather than `instanceof Error`: the real error is a
            // DOMException, and this must not silently stop firing.)
            if ((error as { name?: string } | undefined)?.name === 'OperationError') {
                await clearCachedKeyHeader(record.localId);
            }
            // If update fails (e.g., version conflict), try to re-fetch and retry
            console.warn('[SyncService] Update failed, will retry on next sync:', error);
            throw error;
        }
    } else {
        // File doesn't exist remotely, create it
        const result = await ctx.notesProvider.createNote(
            record.localId,
            doc.metadata,
            yjsBlob, undefined, {
            encrypt: true,
        }
        );
        await markSynced(record.localId, result.fileId, result.versionTag, currentHash, undefined, undefined, undefined, record.dirtyGeneration);
    }
}
