import { useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
    upsertSearchIndex,
    updateSearchIndexMetadata,
    deleteSearchIndexEntry,
    deleteDocumentUpdates,
    upsertSyncRecord,
    deleteSyncRecord,
    updateSyncStatus,
    saveDocumentUpdate,
    getTrashedNotes,
    getSearchIndexEntry,
    setNoteArchivalStatusLocal,
    NOTE_LIST_SQL,
    NOTE_ROW_KEY,
    toNoteListEntry,
    type NoteListRow,
} from '@/lib/db';
import * as Y from 'yjs';
import { getNewId } from '@/lib/utils';
import type { NoteListEntry, SearchIndexEntry, DocumentMetadata } from '@/types';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { useSyncService } from '@/hooks/useSyncService';
import { formatGuidId } from '@homebase-id/js-lib/helpers';
import { useLiveQuery } from './useLiveQuery';

interface CreateNoteResult {
    docId: string;
    folderId: string;
}

interface UpdateMetadataParams {
    docId: string;
    metadata: DocumentMetadata;
}

/**
 * Subscribe to a note-list query as a PGlite live query. PGlite is the reactive
 * source — any local or sync write re-emits results, so the list updates
 * progressively with no manual invalidation.
 */
export function useLiveNoteList(
    sql: string,
    params: ReadonlyArray<unknown>,
    enabled: boolean = true,
): { data: NoteListEntry[]; isLoading: boolean } {
    const { data: rows, isLoading } = useLiveQuery<NoteListRow>(sql, params, NOTE_ROW_KEY, enabled);
    const data = useMemo(() => rows.map(toNoteListEntry), [rows]);
    return { data, isLoading };
}

/**
 * Combined hook for managing notes.
 * Returns the live note list and mutation hooks in a single object.
 *
 * Reads are PGlite live queries (the DB is the reactive source). Mutations are
 * local-first: they write to PGlite (which updates the UI via the live query)
 * and then reconcile remotely. Soft-delete transitions (trash/archive) roll the
 * local status back if the remote push fails, since a half-applied status would
 * resurface on the next pull.
 */
export function useNotes() {
    const { deleteNoteRemote, setNoteArchivalStatusRemote } = useSyncService();

    // --- Queries (live) ---

    const query = useLiveNoteList(NOTE_LIST_SQL.active, []);

    // Local-first archival-status change with remote reconciliation + rollback.
    const applyArchivalStatus = async (docId: string, status: number) => {
        const prev = (await getSearchIndexEntry(docId))?.metadata.archivalStatus ?? 0;
        await setNoteArchivalStatusLocal(docId, status);
        try {
            await setNoteArchivalStatusRemote(docId, status);
        } catch (err) {
            await setNoteArchivalStatusLocal(docId, prev);
            throw err;
        }
    };

    // --- Mutations ---

    const createNoteMutation = useMutation<CreateNoteResult, Error, string | undefined>({
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
    });

    // Permanent delete (used from the Trash view and for emptying trash).
    // Remote-first: deleting locally before a confirmed remote delete would let
    // the orphaned remote file resurface on the next pull.
    const deleteNoteMutation = useMutation<void, Error, string>({
        mutationFn: async (docId: string) => {
            await deleteNoteRemote(docId);

            await Promise.all([
                deleteSearchIndexEntry(docId),
                deleteDocumentUpdates(docId),
                deleteSyncRecord(docId),
            ]);
        },
    });

    // Permanently delete every trashed note.
    const emptyTrashMutation = useMutation<void, Error, void>({
        mutationFn: async () => {
            const trashed = await getTrashedNotes();
            // Delete all in parallel; one failure must not abort the rest.
            await Promise.allSettled(
                trashed.map(async (note) => {
                    await deleteNoteRemote(note.docId);
                    await Promise.all([
                        deleteSearchIndexEntry(note.docId),
                        deleteDocumentUpdates(note.docId),
                        deleteSyncRecord(note.docId),
                    ]);
                })
            );
        },
    });

    const updateMetadataMutation = useMutation<void, Error, UpdateMetadataParams>({
        mutationFn: async ({ docId, metadata }) => {
            await updateSearchIndexMetadata(docId, metadata.title, metadata);
            await updateSyncStatus(docId, 'pending');
        },
    });

    const togglePinMutation = useMutation<void, Error, { docId: string; isPinned: boolean }>({
        mutationFn: async ({ docId, isPinned }) => {
            const current = await getSearchIndexEntry(docId);
            if (!current) return;

            const updatedMetadata = { ...current.metadata, isPinned };
            await updateSearchIndexMetadata(docId, current.title, updatedMetadata);
            await updateSyncStatus(docId, 'pending');
        },
    });

    // Reflect public-share status locally for the list badge. The flag is already
    // persisted remotely by makeNotePublic/makeNotePrivate, so this is a LOCAL-only
    // update — we intentionally do NOT mark the note 'pending' (a normal sync push
    // could disturb the Anonymous ACL).
    const setNotePublicMutation = useMutation<void, Error, { docId: string; isPublic: boolean }>({
        mutationFn: async ({ docId, isPublic }) => {
            const current = await getSearchIndexEntry(docId);
            if (!current) return;

            const updatedMetadata = { ...current.metadata, isPublic };
            await updateSearchIndexMetadata(docId, current.title, updatedMetadata);
        },
    });

    const createNoteWithContentMutation = useMutation<CreateNoteResult, Error, { title: string; content: string; folderId: string }>({
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
    });

    // Soft delete — move a note to Trash (Homebase archivalStatus 2).
    const trashNoteMutation = useMutation<void, Error, string>({
        mutationFn: (docId: string) => applyArchivalStatus(docId, 2),
    });

    // Restore a note from Trash (archivalStatus 0).
    const restoreNoteMutation = useMutation<void, Error, string>({
        mutationFn: (docId: string) => applyArchivalStatus(docId, 0),
    });

    // Archive — move a note to the Archive (Homebase archivalStatus 1).
    const archiveNoteMutation = useMutation<void, Error, string>({
        mutationFn: (docId: string) => applyArchivalStatus(docId, 1),
    });

    // Unarchive — move a note from the Archive back to active (archivalStatus 0).
    const unarchiveNoteMutation = useMutation<void, Error, string>({
        mutationFn: (docId: string) => applyArchivalStatus(docId, 0),
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
        archiveNote: archiveNoteMutation,
        unarchiveNote: unarchiveNoteMutation,
        emptyTrash: emptyTrashMutation,
    };
}

/**
 * Query hook for the Trash view — notes with archivalStatus 2 (Removed).
 */
export function useTrashedNotes() {
    return useLiveNoteList(NOTE_LIST_SQL.trashed, []);
}

/**
 * Query hook for the Archive view — notes with archivalStatus 1 (Archived).
 */
export function useArchivedNotes() {
    return useLiveNoteList(NOTE_LIST_SQL.archived, []);
}

/**
 * Query hook to fetch notes for a specific folder.
 * Returns lightweight NoteListEntry objects (no full content).
 */
export function useNotesByFolder(folderId: string | undefined) {
    // 'trash', 'shared' and 'archive' are pseudo-folders with their own views — skip the query.
    const enabled = !!folderId && folderId !== 'trash' && folderId !== 'shared' && folderId !== 'archive';
    return useLiveNoteList(NOTE_LIST_SQL.byFolder, [folderId ?? ''], enabled);
}

export function useCollaborativeNotes() {
    return useLiveNoteList(NOTE_LIST_SQL.collaborative, []);
}
