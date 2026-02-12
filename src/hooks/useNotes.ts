import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    getAllDocuments,
    getDocumentsByFolder,
    upsertSearchIndex,
    deleteSearchIndexEntry,
    deleteDocumentUpdates,
    upsertSyncRecord,
    deleteSyncRecord,
    updateSyncStatus,
    saveDocumentUpdate,
} from '@/lib/db';
import * as Y from 'yjs';
import { getNewId } from '@/lib/utils';
import type { SearchIndexEntry, DocumentMetadata } from '@/types';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { useSyncService } from '@/hooks/useSyncService';
import { formatGuidId } from '@homebase-id/js-lib/helpers';

export const notesQueryKey = ['notes'] as const;

interface CreateNoteResult {
    docId: string;
    folderId: string;
}

interface NoteMutationContext {
    previousNotes: SearchIndexEntry[] | undefined;
}

interface UpdateMetadataParams {
    docId: string;
    metadata: DocumentMetadata;
}

/**
 * Combined hook for managing notes.
 * Returns the query result and mutation hooks in a single object.
 */
export function useNotes() {
    const queryClient = useQueryClient();
    const { deleteNoteRemote } = useSyncService();

    // --- Queries ---

    const query = useQuery<SearchIndexEntry[]>({
        queryKey: notesQueryKey,
        queryFn: getAllDocuments,
    });

    // --- Mutations ---

    const createNoteMutation = useMutation<CreateNoteResult, Error, string | undefined, NoteMutationContext>({
        mutationFn: async (targetFolderId?: string) => {
            const docId = formatGuidId(getNewId());
            const now = new Date().toISOString();
            const metadata: DocumentMetadata = {
                title: 'Untitled',
                folderId: targetFolderId || MAIN_FOLDER_ID,
                tags: [],
                timestamps: { created: now, modified: now },
                excludeFromAI: false,
                isPinned: false,
            };

            const newNote: SearchIndexEntry = {
                docId,
                title: metadata.title,
                plainTextContent: '',
                metadata,
            };

            await upsertSearchIndex(newNote);
            //TODO: Should we create a sync record whne there is no content?
            // Create sync record for Homebase sync
            await upsertSyncRecord({
                localId: docId,
                entityType: 'note',
                syncStatus: 'pending',
            });

            return { docId, folderId: metadata.folderId };
        },

        onError: (_err, _vars, context) => {
            if (context?.previousNotes) {
                queryClient.setQueryData(notesQueryKey, context.previousNotes);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: notesQueryKey });
        },
    });

    const deleteNoteMutation = useMutation<void, Error, string, NoteMutationContext>({
        mutationFn: async (docId: string) => {
            // First delete from remote
            await deleteNoteRemote(docId);

            // Then delete locally
            await deleteSearchIndexEntry(docId);
            await deleteDocumentUpdates(docId);
            await deleteSyncRecord(docId);
        },
        onMutate: async (docId) => {
            await queryClient.cancelQueries({ queryKey: notesQueryKey });
            const previousNotes = queryClient.getQueryData<SearchIndexEntry[]>(notesQueryKey);

            queryClient.setQueryData<SearchIndexEntry[]>(notesQueryKey, (old) =>
                old?.filter((n) => n.docId !== docId) || []
            );

            return { previousNotes };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousNotes) {
                queryClient.setQueryData(notesQueryKey, context.previousNotes);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: notesQueryKey });
        },
    });

    const updateMetadataMutation = useMutation<void, Error, UpdateMetadataParams, NoteMutationContext>({
        mutationFn: async ({ docId, metadata }) => {
            const notes = queryClient.getQueryData<SearchIndexEntry[]>(notesQueryKey);
            const currentNote = notes?.find((n) => n.docId === docId);

            await upsertSearchIndex({
                docId,
                title: metadata.title,
                plainTextContent: currentNote?.plainTextContent || '',
                metadata,
            });

            await updateSyncStatus(docId, 'pending');
        },
        onMutate: async ({ docId, metadata }) => {
            await queryClient.cancelQueries({ queryKey: notesQueryKey });
            const previousNotes = queryClient.getQueryData<SearchIndexEntry[]>(notesQueryKey);

            queryClient.setQueryData<SearchIndexEntry[]>(notesQueryKey, (old) =>
                old?.map((n) =>
                    n.docId === docId
                        ? { ...n, title: metadata.title, metadata }
                        : n
                ) || []
            );

            return { previousNotes };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousNotes) {
                queryClient.setQueryData(notesQueryKey, context.previousNotes);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: notesQueryKey });
        },
    });

    const togglePinMutation = useMutation<void, Error, { docId: string; isPinned: boolean }, NoteMutationContext>({
        mutationFn: async ({ docId, isPinned }) => {
            const notes = queryClient.getQueryData<SearchIndexEntry[]>(notesQueryKey);
            const currentNote = notes?.find((n) => n.docId === docId);

            if (!currentNote) return;

            const updatedMetadata = { ...currentNote.metadata, isPinned };

            await upsertSearchIndex({
                ...currentNote,
                metadata: updatedMetadata,
            });

            await updateSyncStatus(docId, 'pending');
        },
        onMutate: async ({ docId, isPinned }) => {
            await queryClient.cancelQueries({ queryKey: notesQueryKey });
            const previousNotes = queryClient.getQueryData<SearchIndexEntry[]>(notesQueryKey);

            queryClient.setQueryData<SearchIndexEntry[]>(notesQueryKey, (old) =>
                old?.map((n) =>
                    n.docId === docId
                        ? { ...n, metadata: { ...n.metadata, isPinned } }
                        : n
                ) || []
            );

            return { previousNotes };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousNotes) {
                queryClient.setQueryData(notesQueryKey, context.previousNotes);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: notesQueryKey });
        },
    });

    const createNoteWithContentMutation = useMutation<CreateNoteResult, Error, { title: string; content: string; folderId: string }, NoteMutationContext>({
        mutationFn: async ({ title, content, folderId }) => {
            const docId = formatGuidId(getNewId());
            const now = new Date().toISOString();

            const metadata: DocumentMetadata = {
                title: title || 'Untitled',
                folderId: folderId || MAIN_FOLDER_ID,
                tags: [],
                timestamps: { created: now, modified: now },
                excludeFromAI: false,
                isPinned: false,
            };

            // 1. Create YJS Document with Content
            const ydoc = new Y.Doc();
            const fragment = ydoc.getXmlFragment('prosemirror');

            // Create Tiptap JSON structure equivalent for a paragraph
            // But YJS manipulation is lower level. 
            // We need to create XML elements.
            const paragraph = new Y.XmlElement('paragraph');
            if (content) {
                const text = new Y.XmlText(content);
                paragraph.push([text]);
            }
            fragment.push([paragraph]);

            const updateBlob = Y.encodeStateAsUpdate(ydoc);

            // 2. Save YJS Update
            await saveDocumentUpdate(docId, updateBlob);

            // 3. Save Search Index
            await upsertSearchIndex({
                docId,
                title: metadata.title,
                plainTextContent: content,
                metadata,
            });

            // 4. Create Sync Record
            await upsertSyncRecord({
                localId: docId,
                entityType: 'note',
                syncStatus: 'pending',
            });

            ydoc.destroy();

            return { docId, folderId: metadata.folderId };
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: notesQueryKey });
        },
    });

    return {
        get: query,
        createNote: createNoteMutation,
        createNoteWithContent: createNoteWithContentMutation,
        deleteNote: deleteNoteMutation,
        updateNote: updateMetadataMutation,
        togglePin: togglePinMutation,
    };
}

/**
 * Query hook to fetch notes for a specific folder.
 */
export function useNotesByFolder(folderId: string | undefined) {
    return useQuery<SearchIndexEntry[]>({
        queryKey: [...notesQueryKey, 'folder', folderId],
        queryFn: () => getDocumentsByFolder(folderId!),
        enabled: !!folderId,
    });
}
