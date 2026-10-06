import * as Y from 'yjs';
import {
    saveDocumentUpdate,
    getSyncRecord,
    updateSyncStatus,
    markSynced,
    updateImageUploadStatus,
    incrementImageRetryCount,
    getImageUploadsReadyForRetry,
    updateImageRetryAt,
    calculateNextRetryAt,
} from '@/lib/db';
import { loadLocalYDoc } from '@/lib/yjs/loadDoc';
import { stringGuidsEqual } from '@homebase-id/js-lib/helpers';
import { getCover, setCover } from '@/lib/editor/cover';
import { documentBroadcast } from '@/lib/broadcast';
import type { SyncContext } from './context';

// An uploaded image whose pending node never shows up is marked failed_permanent after this many tries
const MAX_IMAGE_PROMOTION_ATTEMPTS = 5;

/** SyncService's (private) updateImageReference, called on the instance as before the split. */
type ImageHandlers = { updateImageReference: typeof updateImageReference };

/**
 * Process pending image uploads with exponential backoff.
 * Returns how many images were promoted; their notes are pending again.
 */
export async function processPendingImageUploads(ctx: SyncContext, svc: ImageHandlers): Promise<number> {
    // Get uploads ready for retry (respects next_retry_at)
    const pendingUploads = await getImageUploadsReadyForRetry();
    let promotedCount = 0;

    for (const upload of pendingUploads) {
        try {
            const syncRecord = await getSyncRecord(upload.noteDocId);
            if (!syncRecord?.remoteFileId || !syncRecord.versionTag) {
                // Note hasn't been synced yet, skip for now
                continue;
            }

            // A note shared with you lives on the author's drive, which the own-drive
            // upload can never reach; retrying would loop forever
            if (syncRecord.authorOdinId && syncRecord.authorOdinId !== ctx.hostIdentity) {
                await updateImageUploadStatus(upload.id, 'failed_permanent');
                console.warn(`[SyncService] Image ${upload.id} is in a peer note; images can't be uploaded there`);
                continue;
            }

            // payloadKey set => the bytes reached the server on an earlier attempt;
            // only promotion is left, never upload twice.
            let payloadKey = upload.payloadKey;
            if (!payloadKey) {
                await updateImageUploadStatus(upload.id, 'uploading');

                const result = await ctx.notesProvider.addImageToNote(
                    upload.noteDocId, // uniqueId - consistent with how notes are tracked
                    syncRecord.versionTag,
                    { file: new Blob([new Uint8Array(upload.blobData)], { type: upload.contentType }) },
                );
                payloadKey = result.payloadKey;

                // Record the upload before promotion so a crash or failed promotion never re-uploads
                await updateImageUploadStatus(upload.id, 'uploading', payloadKey);
                // Generation guard: an edit made during the upload must stay pending
                await markSynced(upload.noteDocId, syncRecord.remoteFileId, result.versionTag, undefined, undefined, undefined, undefined, syncRecord.dirtyGeneration);
                console.log(`[SyncService] Image ${upload.id} uploaded as ${payloadKey}`);
            }

            // The editor inserts the node after queueing the row and persists it on
            // a write window; an already-running sync can get here first
            await documentBroadcast.requestFlushAndWait(upload.noteDocId);

            // Update the Yjs document to replace pending reference with permanent one
            const promoted = await svc.updateImageReference(
                upload.noteDocId,
                upload.id, // data-pending-id
                syncRecord.remoteFileId,
                payloadKey
            );

            if (promoted) {
                // The editor applies the promotion as a remote update and never saves it,
                // so mark the note pending or the new src never reaches the server
                await updateSyncStatus(upload.noteDocId, 'pending');
                // Keep the bytes so the image still renders offline (#179); the queue skips synced rows
                await updateImageUploadStatus(upload.id, 'synced', payloadKey);
                promotedCount++;
            } else if (upload.retryCount + 1 >= MAX_IMAGE_PROMOTION_ATTEMPTS) {
                // Give up retrying but keep the bytes (cleared at logout)
                await updateImageUploadStatus(upload.id, 'failed_permanent');
                console.warn(`[SyncService] Image ${upload.id} could not be promoted; giving up`);
            } else {
                throw new Error(`Pending image node ${upload.id} not found in note ${upload.noteDocId}`);
            }
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
    return promotedCount;
}

/**
 * Update the Yjs document to replace pending image reference with permanent payloadKey.
 * The new src format is: attachment://fileId/payloadKey
 */
export async function updateImageReference(
    docId: string,
    pendingId: string,
    fileId: string,
    payloadKey: string
): Promise<boolean> {
    const ydoc = await loadLocalYDoc(docId);
    if (!ydoc) return false;
    const before = Y.encodeStateVector(ydoc);

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

    ydoc.transact(() => {
        replaceInFragment(fragment);

        // The cover lives outside the fragment, in the journalMeta map
        const cover = getCover(ydoc);
        if (cover?.pendingId && stringGuidsEqual(cover.pendingId, pendingId)) {
            setCover(ydoc, { src: `attachment://${fileId}/${payloadKey}`, positionY: cover.positionY });
            found = true;
        }
    });

    if (found) {
        // Append only the delta so rows the editor saved concurrently are never deleted
        await saveDocumentUpdate(docId, Y.encodeStateAsUpdate(ydoc, before));

        // Notify the editor that the document was updated
        documentBroadcast.notifyDocumentUpdated(docId);

        console.debug(`[SyncService] Updated Yjs doc for ${docId}`);
    }

    ydoc.destroy();
    return found;
}
