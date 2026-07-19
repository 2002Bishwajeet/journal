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
    getDocumentUpdates,
    getTrashedNotes,
    getSearchIndexEntry,
    setNoteArchivalStatusLocal,
    NOTE_LIST_SQL,
    NOTE_ROW_KEY,
    NOTE_COUNTS_SQL,
    toNoteListEntry,
    type NoteListRow,
    type NoteCountsRow,
} from '@/lib/db';
import * as Y from 'yjs';
import { getNewId } from '@/lib/utils';
import { extractPreviewTextFromYjs } from '@/lib/yjs-utils';
import type { NoteListEntry, SearchIndexEntry, DocumentMetadata } from '@/types';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { useSyncService } from '@/hooks/useSyncService';
import { formatGuidId } from '@homebase-id/js-lib/helpers';
import { useLiveQuery } from './useLiveQuery';

interface CreateNoteResult {
    docId: string;
    folderId: string;
}

interface CreateNoteWithContentParams {
    title: string;
    content: string; // markdown / plain text
    folderId: string;
}

/**
 * Build the new note's initial block structure from a content string. A
 * ProseMirror text node cannot hold newlines or render markdown syntax — a
 * single-paragraph dump shows "# Title\n\n" as literal text — so split into
 * one block per line, with `# `–`###### ` lines becoming headings. That is
 * the only markdown the in-app content strings use; everything else stays a
 * plain paragraph.
 */
function pushContentBlocks(fragment: Y.XmlFragment, content: string): void {
    const blocks: Y.XmlElement[] = [];
    for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        const heading = line.match(/^(#{1,6}) (.*)$/);
        const el = new Y.XmlElement(heading ? 'heading' : 'paragraph');
        // Level must be a number — TipTap's heading falls back to h1 otherwise
        if (heading) el.setAttribute('level', heading[1].length as unknown as string);
        const text = heading ? heading[2] : line;
        if (text) el.push([new Y.XmlText(text)]);
        blocks.push(el);
    }
    // The editor expects at least one block to place the cursor in, and a
    // trailing heading needs an empty paragraph after it so typing starts as
    // body text instead of extending the heading.
    if (blocks.length === 0 || blocks[blocks.length - 1].nodeName === 'heading') {
        blocks.push(new Y.XmlElement('paragraph'));
    }
    fragment.push(blocks);
}

/**
 * Shared persistence tail: save the Yjs blob, index it (plain text derived
 * from the blob itself so search/preview always match the rendered note),
 * queue it for sync.
 */
async function persistNewNote({
    title,
    folderId,
    updateBlob,
}: {
    title: string;
    folderId: string;
    updateBlob: Uint8Array;
}): Promise<CreateNoteResult> {
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

    const plainTextContent = await extractPreviewTextFromYjs(docId, updateBlob);

    await saveDocumentUpdate(docId, updateBlob);

    await upsertSearchIndex({
        docId,
        title: metadata.title,
        plainTextContent,
        metadata,
    });

    await upsertSyncRecord({
        localId: docId,
        entityType: 'note',
        syncStatus: 'pending',
    });

    return { docId, folderId: metadata.folderId };
}

/**
 * Create a note with initial markdown/plain-text content — the battle-tested
 * path shared by the PWA share target, daily notes, and templates. Extracted
 * from the mutation below so non-list hooks can reuse it directly without each
 * spinning up a redundant active-notes live subscription.
 */
export async function createNoteWithContentInDb({
    title,
    content,
    folderId,
}: CreateNoteWithContentParams): Promise<CreateNoteResult> {
    const ydoc = new Y.Doc();
    pushContentBlocks(ydoc.getXmlFragment('prosemirror'), content);
    const updateBlob = Y.encodeStateAsUpdate(ydoc);
    ydoc.destroy();
    return persistNewNote({ title, folderId, updateBlob });
}

// The single definition of the template placeholder token — body substitution
// here and title substitution in useTemplates both consume it.
export const DATE_TOKEN = '{{date}}';

/**
 * Replace {{date}} in one text run, preserving each run's marks. A token
 * split across two differently-formatted runs is left alone — the token is
 * always typed in one style.
 */
function replaceDateTokens(text: Y.XmlText, dateString: string): void {
    for (;;) {
        const delta = text.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>;
        let pos = 0;
        let found = -1;
        let attrs: Record<string, unknown> | undefined;
        for (const op of delta) {
            if (typeof op.insert !== 'string') {
                pos += 1; // embeds count as length 1
                continue;
            }
            const idx = op.insert.indexOf(DATE_TOKEN);
            if (idx !== -1) {
                found = pos + idx;
                attrs = op.attributes;
                break;
            }
            pos += op.insert.length;
        }
        if (found === -1) return;
        text.delete(found, DATE_TOKEN.length);
        text.insert(found, dateString, attrs);
    }
}

function substituteDateTokens(node: Y.XmlFragment, dateString: string): void {
    node.toArray().forEach((child) => {
        if (child instanceof Y.XmlText) replaceDateTokens(child, dateString);
        else if (child instanceof Y.XmlElement) substituteDateTokens(child, dateString);
    });
}

interface CreateNoteFromTemplateParams {
    templateDocId: string;
    title: string;
    folderId: string;
    dateString: string; // replaces {{date}} tokens (local YYYY-MM-DD)
}

/**
 * Spawn a note from a template note by copying its stored Yjs document —
 * headings, lists, marks and all — with {{date}} substituted inside text
 * runs. Copying the blob (not the search index's plain-text extract) is what
 * preserves the template's formatting. Falls back to plain-content creation
 * when the template has no local Yjs updates.
 */
export async function createNoteFromTemplateInDb({
    templateDocId,
    title,
    folderId,
    dateString,
}: CreateNoteFromTemplateParams): Promise<CreateNoteResult> {
    const updates = await getDocumentUpdates(templateDocId);
    if (updates.length === 0) {
        const entry = await getSearchIndexEntry(templateDocId);
        const content = (entry?.plainTextContent || '').split(DATE_TOKEN).join(dateString);
        return createNoteWithContentInDb({ title, content, folderId });
    }

    const ydoc = new Y.Doc();
    for (const update of updates) {
        Y.applyUpdate(ydoc, update);
    }
    substituteDateTokens(ydoc.getXmlFragment('prosemirror'), dateString);
    const updateBlob = Y.encodeStateAsUpdate(ydoc);
    ydoc.destroy();
    return persistNewNote({ title, folderId, updateBlob });
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
            // Only roll back if no concurrent transition has changed the status
            // since we wrote it — otherwise we'd clobber that transition's result
            // and leave local/remote divergent.
            const current = (await getSearchIndexEntry(docId))?.metadata.archivalStatus ?? 0;
            if (current === status) {
                await setNoteArchivalStatusLocal(docId, prev);
            }
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

    const createNoteWithContentMutation = useMutation<CreateNoteResult, Error, CreateNoteWithContentParams>({
        mutationFn: createNoteWithContentInDb,
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
 * Live counts for the sidebar badges (trash / archive / shared). A single
 * subscription instead of three full-list subscriptions at boot — the full lists
 * are only subscribed when their view is actually open (see the `enabled` params
 * on useTrashedNotes / useArchivedNotes / useCollaborativeNotes).
 */
export function useNoteCounts(): NoteCountsRow {
    const { data } = useLiveQuery<NoteCountsRow>(NOTE_COUNTS_SQL, [], 'note-counts');
    const row = data[0];
    return {
        trashed: row?.trashed ?? 0,
        archived: row?.archived ?? 0,
        collaborative: row?.collaborative ?? 0,
    };
}

/**
 * Query hook for the Trash view — notes with archivalStatus 2 (Removed).
 * Pass enabled=false to skip the subscription when the Trash view isn't open.
 */
export function useTrashedNotes(enabled: boolean = true) {
    return useLiveNoteList(NOTE_LIST_SQL.trashed, [], enabled);
}

/**
 * Query hook for the Archive view — notes with archivalStatus 1 (Archived).
 * Pass enabled=false to skip the subscription when the Archive view isn't open.
 */
export function useArchivedNotes(enabled: boolean = true) {
    return useLiveNoteList(NOTE_LIST_SQL.archived, [], enabled);
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

export function useCollaborativeNotes(enabled: boolean = true) {
    return useLiveNoteList(NOTE_LIST_SQL.collaborative, [], enabled);
}

/**
 * Backlinks for the "Linked mentions" panel — active notes whose
 * metadata.linkedNoteIds contains this note's id.
 */
export function useBacklinks(noteId: string | undefined) {
    return useLiveNoteList(NOTE_LIST_SQL.backlinks, [noteId ?? ''], !!noteId);
}
