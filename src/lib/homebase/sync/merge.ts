import * as Y from 'yjs';
import { getFolderById, getDocumentUpdates, getEntityIdsWithUnresolvedError } from '@/lib/db';
import { MAIN_FOLDER_ID, COLLABORATIVE_FOLDER_ID } from '../config';

/**
 * Merge local and remote Yjs documents.
 * Yjs CRDTs handle conflict resolution automatically.
 */
export async function mergeYjsDocuments(docId: string, remoteBlob: Uint8Array): Promise<Uint8Array> {
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
 * Resolve a remote note's local folderId. Falls back to Main when groupId
 * points at neither Main/Collaborative nor an existing local folder row —
 * e.g. notes orphaned by the pre-#254 folder-delete bug (#259). Exception: a
 * folder with an unresolved pull error (this batch, or a still-failing earlier
 * one) isn't proven gone — keep the raw groupId rather than mis-file it to Main.
 */
export async function resolveNoteFolderId(groupId: string | undefined): Promise<string> {
    const folderId = groupId || MAIN_FOLDER_ID;
    if (folderId === MAIN_FOLDER_ID || folderId === COLLABORATIVE_FOLDER_ID) return folderId;
    if (await getFolderById(folderId)) return folderId;
    const failedFolderPulls = await getEntityIdsWithUnresolvedError('folder', 'pull');
    return failedFolderPulls.has(folderId) ? folderId : MAIN_FOLDER_ID;
}
