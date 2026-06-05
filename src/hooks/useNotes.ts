import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    getNotesForList,
    getNotesForListByFolder,
    getCollaborativeNotesForList,
    upsertSearchIndex,
    updateSearchIndexMetadata,
    deleteSearchIndexEntry,
    deleteDocumentUpdates,
    upsertSyncRecord,
    deleteSyncRecord,
    updateSyncStatus,
    saveDocumentUpdate,
    getTrashedNotes,
    setNoteArchivalStatusLocal,
} from '@/lib/db';
import * as Y from 'yjs';
import { getNewId } from '@/lib/utils';
import type { NoteListEntry, SearchIndexEntry, DocumentMetadata } from '@/types';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { useSyncService } from '@/hooks/useSyncService';
import { formatGuidId } from '@homebase-id/js-lib/helpers';

export const notesQueryKey = ['notes'] as const;
export const trashedNotesQueryKey = ['trashed-notes'] as const;

interface CreateNoteResult {
    docId: string;
    folderId: string;
}

interface NoteMutationContext {
    previousNotes: NoteListEntry[] | undefined;
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
    const { deleteNoteRemote, setNoteArchivalStatusRemote } = useSyncService();

    // --- Queries ---

    const query = useQuery<NoteListEntry[]>({
        queryKey: notesQueryKey,
        queryFn: getNotesForList,
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

            await Promise.all([
                upsertSearchIndex(newNote),
                //TODO: Should we create a sync record whne there is no content?
                // Create sync record for Homebase sync
                upsertSyncRecord({
                    localId: docId,
                    entityType: 'note',
                    syncStatus: 'pending',
                }),
            ]);

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

    // Permanent delete (used from the Trash view and for emptying trash).
    const deleteNoteMutation = useMutation<void, Error, string, NoteMutationContext>({
        mutationFn: async (docId: string) => {
            // First delete from remote
            await deleteNoteRemote(docId);

            // Then delete locally
            await Promise.all([
                deleteSearchIndexEntry(docId),
                deleteDocumentUpdates(docId),
                deleteSyncRecord(docId),
            ]);
        },
        onMutate: async (docId) => {
            await queryClient.cancelQueries({ queryKey: notesQueryKey });
            const previousNotes = queryClient.getQueryData<NoteListEntry[]>(notesQueryKey);

            queryClient.setQueryData<NoteListEntry[]>(notesQueryKey, (old) =>
                old?.filter((n) => n.docId !== docId) || []
            );
            queryClient.setQueryData<NoteListEntry[]>(trashedNotesQueryKey, (old) =>
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
            queryClient.invalidateQueries({ queryKey: trashedNotesQueryKey });
        },
    });

    // Permanently delete every trashed note.
    const emptyTrashMutation = useMutation<void, Error, void, { previousTrash: NoteListEntry[] | undefined }>({
        mutationFn: async () => {
            const trashed = await getTrashedNotes();
            for (const note of trashed) {
                await deleteNoteRemote(note.docId);
                await Promise.all([
                    deleteSearchIndexEntry(note.docId),
                    deleteDocumentUpdates(note.docId),
                    deleteSyncRecord(note.docId),
                ]);
            }
        },
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: trashedNotesQueryKey });
            const previousTrash = queryClient.getQueryData<NoteListEntry[]>(trashedNotesQueryKey);
            queryClient.setQueryData<NoteListEntry[]>(trashedNotesQueryKey, []);
            return { previousTrash };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousTrash) {
                queryClient.setQueryData(trashedNotesQueryKey, context.previousTrash);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: trashedNotesQueryKey });
        },
    });

    const updateMetadataMutation = useMutation<void, Error, UpdateMetadataParams, NoteMutationContext>({
        mutationFn: async ({ docId, metadata }) => {
            await updateSearchIndexMetadata(docId, metadata.title, metadata);

            await updateSyncStatus(docId, 'pending');
        },
        onMutate: async ({ docId, metadata }) => {
            await queryClient.cancelQueries({ queryKey: notesQueryKey });
            const previousNotes = queryClient.getQueryData<NoteListEntry[]>(notesQueryKey);

            queryClient.setQueryData<NoteListEntry[]>(notesQueryKey, (old) =>
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
            const notes = queryClient.getQueryData<NoteListEntry[]>(notesQueryKey);
            const currentNote = notes?.find((n) => n.docId === docId);

            if (!currentNote) return;

            const updatedMetadata = { ...currentNote.metadata, isPinned };

            await updateSearchIndexMetadata(docId, currentNote.title, updatedMetadata);

            await updateSyncStatus(docId, 'pending');
        },
        onMutate: async ({ docId, isPinned }) => {
            await queryClient.cancelQueries({ queryKey: notesQueryKey });
            const previousNotes = queryClient.getQueryData<NoteListEntry[]>(notesQueryKey);

            queryClient.setQueryData<NoteListEntry[]>(notesQueryKey, (old) =>
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

    // Reflect public-share status locally for the list badge. The flag is already
    // persisted remotely by makeNotePublic/makeNotePrivate, so this is a LOCAL-only
    // update — we intentionally do NOT mark the note 'pending' (a normal sync push
    // could disturb the Anonymous ACL).
    const setNotePublicMutation = useMutation<void, Error, { docId: string; isPublic: boolean }, NoteMutationContext>({
        mutationFn: async ({ docId, isPublic }) => {
            const notes = queryClient.getQueryData<NoteListEntry[]>(notesQueryKey);
            const currentNote = notes?.find((n) => n.docId === docId);
            if (!currentNote) return;

            const updatedMetadata = { ...currentNote.metadata, isPublic };
            await updateSearchIndexMetadata(docId, currentNote.title, updatedMetadata);
        },
        onMutate: async ({ docId, isPublic }) => {
            await queryClient.cancelQueries({ queryKey: notesQueryKey });
            const previousNotes = queryClient.getQueryData<NoteListEntry[]>(notesQueryKey);

            queryClient.setQueryData<NoteListEntry[]>(notesQueryKey, (old) =>
                old?.map((n) =>
                    n.docId === docId
                        ? { ...n, metadata: { ...n.metadata, isPublic } }
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

    // Soft delete — move a note to Trash (Homebase archivalStatus 2).
    const trashNoteMutation = useMutation<void, Error, string, NoteMutationContext>({
        mutationFn: async (docId: string) => {
            await setNoteArchivalStatusRemote(docId, 2);
            await setNoteArchivalStatusLocal(docId, 2);
        },
        onMutate: async (docId) => {
            await queryClient.cancelQueries({ queryKey: notesQueryKey });
            const previousNotes = queryClient.getQueryData<NoteListEntry[]>(notesQueryKey);
            queryClient.setQueryData<NoteListEntry[]>(notesQueryKey, (old) =>
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
            queryClient.invalidateQueries({ queryKey: trashedNotesQueryKey });
        },
    });

    // Restore a note from Trash (archivalStatus 0).
    const restoreNoteMutation = useMutation<
        void,
        Error,
        string,
        { previousTrash: NoteListEntry[] | undefined }
    >({
        mutationFn: async (docId: string) => {
            await setNoteArchivalStatusRemote(docId, 0);
            await setNoteArchivalStatusLocal(docId, 0);
        },
        onMutate: async (docId) => {
            await queryClient.cancelQueries({ queryKey: trashedNotesQueryKey });
            const previousTrash = queryClient.getQueryData<NoteListEntry[]>(trashedNotesQueryKey);
            queryClient.setQueryData<NoteListEntry[]>(trashedNotesQueryKey, (old) =>
                old?.filter((n) => n.docId !== docId) || []
            );
            return { previousTrash };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousTrash) {
                queryClient.setQueryData(trashedNotesQueryKey, context.previousTrash);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: notesQueryKey });
            queryClient.invalidateQueries({ queryKey: trashedNotesQueryKey });
        },
    });

    return {
        get: query,
        createNote: createNoteMutation,
        createNoteWithContent: createNoteWithContentMutation,
        deleteNote: deleteNoteMutation,
        updateNote: updateMetadataMutation,
        togglePin: togglePinMutation,
        setNotePublic: setNotePublicMutation,
        trashNote: trashNoteMutation,
        restoreNote: restoreNoteMutation,
        emptyTrash: emptyTrashMutation,
    };
}

/**
 * Query hook for the Trash view — notes with archivalStatus 2 (Removed).
 */
export function useTrashedNotes() {
    return useQuery<NoteListEntry[]>({
        queryKey: trashedNotesQueryKey,
        queryFn: getTrashedNotes,
    });
}

/**
 * Query hook to fetch notes for a specific folder.
 * Returns lightweight NoteListEntry objects (no full content).
 */
export function useNotesByFolder(folderId: string | undefined) {
    return useQuery<NoteListEntry[]>({
        queryKey: [...notesQueryKey, 'folder', folderId],
        queryFn: () => getNotesForListByFolder(folderId!),
        enabled: !!folderId,
    });
}

export function useCollaborativeNotes() {
    return useQuery<NoteListEntry[]>({
        queryKey: [...notesQueryKey, 'collaborative'],
        queryFn: getCollaborativeNotesForList,
    });
}
