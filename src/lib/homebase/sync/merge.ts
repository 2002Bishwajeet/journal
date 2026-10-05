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
 * True when `mergedBlob` holds an insert or a delete that `remoteBlob` lacks, i.e. a
 * pull merged in local edits the server doesn't have yet (#442). Compares snapshots
 * (state vector + normalized delete set): Y.diffUpdate always carries the full delete
 * set, so it can't tell an old delete from a new one.
 */
export function hasChangesMissingFrom(mergedBlob: Uint8Array, remoteBlob: Uint8Array): boolean {
    const merged = new Y.Doc();
    const remote = new Y.Doc();
    try {
        Y.applyUpdate(merged, mergedBlob);
        Y.applyUpdate(remote, remoteBlob);
        return !Y.equalSnapshots(Y.snapshot(merged), Y.snapshot(remote));
    } finally {
        merged.destroy();
        remote.destroy();
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
