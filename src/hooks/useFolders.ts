import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    getAllFolders,
    createFolder,
    deleteFolder,
    upsertSearchIndex,
    upsertSyncRecord,
    deleteSyncRecord,
    updateSyncStatus,
} from '@/lib/db';
import { getNewId } from '@/lib/utils';
import type { Folder, SearchIndexEntry } from '@/types';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { notesQueryKey } from './useNotes';
import { useSyncService } from '@/hooks/useSyncService';
import { formatGuidId } from '@homebase-id/js-lib/helpers';

export const foldersQueryKey = ['folders'] as const;

interface CreateFolderContext {
    previousFolders: Folder[] | undefined;
}

interface DeleteFolderContext {
    previousFolders: Folder[] | undefined;
    previousNotes: SearchIndexEntry[] | undefined;
}

/**
 * Combined hook for managing folders.
 */
export function useFolders() {
    const queryClient = useQueryClient();
    const { deleteFolderRemote } = useSyncService();

    // --- Queries ---

    const query = useQuery<Folder[]>({
        queryKey: foldersQueryKey,
        queryFn: getAllFolders,
    });

    // --- Mutations ---

    const createFolderMutation = useMutation<void, Error, string, CreateFolderContext>({
        mutationFn: async (name: string) => {
            const folderId = formatGuidId(getNewId());
            await createFolder(folderId, name.trim());

            await upsertSyncRecord({
                localId: folderId,
                entityType: 'folder',
                syncStatus: 'pending',
            });
        },

        onError: (_err, _vars, context) => {
            if (context?.previousFolders) {
                queryClient.setQueryData(foldersQueryKey, context.previousFolders);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: foldersQueryKey });
        },
    });

    const deleteFolderMutation = useMutation<void, Error, string, DeleteFolderContext>({
        mutationFn: async (folderId: string) => {
            if (folderId === MAIN_FOLDER_ID) {
                throw new Error('Cannot delete Main folder');
            }

            // First delete from remote
            await deleteFolderRemote(folderId);

            // Move notes to Main folder
            const notes = queryClient.getQueryData<SearchIndexEntry[]>(notesQueryKey);
            const notesInFolder = notes?.filter((n) => n.metadata.folderId === folderId) || [];

            await Promise.all(
                notesInFolder.map((note) =>
                    upsertSearchIndex({
                        ...note,
                        metadata: {
                            ...note.metadata,
                            folderId: MAIN_FOLDER_ID,
                        },
                    })
                )
            );

            await deleteFolder(folderId);
            await deleteSyncRecord(folderId);

            // Also mark moved notes as pending sync
            await Promise.all(
                notesInFolder.map((note) =>
                    updateSyncStatus(note.docId, 'pending')
                )
            );
        },
        onMutate: async (folderId) => {
            await queryClient.cancelQueries({ queryKey: foldersQueryKey });
            await queryClient.cancelQueries({ queryKey: notesQueryKey });

            const previousFolders = queryClient.getQueryData<Folder[]>(foldersQueryKey);
            const previousNotes = queryClient.getQueryData<SearchIndexEntry[]>(notesQueryKey);

            // Optimistically remove folder
            queryClient.setQueryData<Folder[]>(foldersQueryKey, (old) =>
                old?.filter((f) => f.id !== folderId) || []
            );

            // Optimistically move notes to Main
            queryClient.setQueryData<SearchIndexEntry[]>(notesQueryKey, (old) =>
                old?.map((n) =>
                    n.metadata.folderId === folderId
                        ? { ...n, metadata: { ...n.metadata, folderId: MAIN_FOLDER_ID } }
                        : n
                ) || []
            );

            return { previousFolders, previousNotes };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousFolders) {
                queryClient.setQueryData(foldersQueryKey, context.previousFolders);
            }
            if (context?.previousNotes) {
                queryClient.setQueryData(notesQueryKey, context.previousNotes);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: foldersQueryKey });
            queryClient.invalidateQueries({ queryKey: notesQueryKey });
        },
    });

    return {
        get: query,
        createFolder: createFolderMutation,
        deleteFolder: deleteFolderMutation,
    };
}
