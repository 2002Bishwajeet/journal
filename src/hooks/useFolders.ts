import { useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
    createFolder,
    deleteFolder,
    getDocumentsByFolder,
    upsertSyncRecord,
    deleteSyncRecord,
    deleteSearchIndexEntry,
    deleteDocumentUpdates,
    FOLDERS_SQL,
    FOLDER_ROW_KEY,
    toFolder,
} from '@/lib/db';
import { getNewId } from '@/lib/utils';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { useSyncService } from '@/hooks/useSyncService';
import { formatGuidId } from '@homebase-id/js-lib/helpers';
import { useLiveQuery } from './useLiveQuery';

type FolderRow = { id: string; name: string; created_at: Date };

/**
 * Combined hook for managing folders.
 *
 * The folder list is a PGlite live query; mutations are local-first (write to
 * PGlite, which updates the UI via the live query, then reconcile remotely).
 */
export function useFolders() {
    const { deleteFolderRemote } = useSyncService();

    // --- Query (live) ---

    const { data: rows, isLoading } = useLiveQuery<FolderRow>(FOLDERS_SQL, [], FOLDER_ROW_KEY);
    const folders = useMemo(() => rows.map(toFolder), [rows]);
    const query = { data: folders, isLoading };

    // --- Mutations ---

    const createFolderMutation = useMutation<void, Error, string>({
        mutationFn: async (name: string) => {
            const folderId = formatGuidId(getNewId());
            await createFolder(folderId, name.trim());

            await upsertSyncRecord({
                localId: folderId,
                entityType: 'folder',
                syncStatus: 'pending',
            });
        },
    });

    // Remote-first: deleting locally before a confirmed remote delete would let
    // the orphaned remote folder/notes resurface on the next pull.
    const deleteFolderMutation = useMutation<void, Error, string>({
        mutationFn: async (folderId: string) => {
            if (folderId === MAIN_FOLDER_ID) {
                throw new Error('Cannot delete Main folder');
            }

            // First delete from remote
            await deleteFolderRemote(folderId);

            // Delete all notes in the folder locally (matching remote deletion via deleteFilesByGroupId)
            const notesInFolder = await getDocumentsByFolder(folderId);
            await Promise.all(
                notesInFolder.map((note) =>
                    Promise.all([
                        deleteSearchIndexEntry(note.docId),
                        deleteDocumentUpdates(note.docId),
                        deleteSyncRecord(note.docId),
                    ])
                )
            );

            // Delete the folder itself
            await deleteFolder(folderId);
            await deleteSyncRecord(folderId);
        },
    });

    return {
        get: query,
        createFolder: createFolderMutation,
        deleteFolder: deleteFolderMutation,
    };
}
