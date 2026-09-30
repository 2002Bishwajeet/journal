import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { resolveNoteFolderId } from '@/hooks/useFolders';
import { PENDING_COLLAB_NOTE_KEY, readString, removeKey } from '@/lib/storage';
import type { NoteListEntry } from '@/types';

interface UseLayoutUrlActionsOptions {
    folders: ReadonlyArray<{ id: string }>;
    isFolderLoading: boolean;
    folderId: string | undefined;
    notes: NoteListEntry[];
    createNote: (folderId: string) => Promise<{ docId: string; folderId: string }>;
    openSearch: (open: boolean) => void;
    openCollaborate: (note: NoteListEntry) => void;
}

/**
 * URL action params (`?action=search|new|collaborate`, from PWA shortcuts and
 * permission redirects) and the pending collaborative note stored before a
 * permission redirect.
 */
export function useLayoutUrlActions({
    folders,
    isFolderLoading,
    folderId,
    notes,
    createNote,
    openSearch,
    openCollaborate,
}: UseLayoutUrlActionsOptions): void {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const action = searchParams.get('action');

    const notesRef = useRef(notes);
    useEffect(() => {
        notesRef.current = notes;
    }, [notes]);

    // Handle pending collaborative note from localStorage (after permission redirect)
    useEffect(() => {
        if (notes.length === 0) return;
        const pendingNoteId = readString(PENDING_COLLAB_NOTE_KEY);
        if (!pendingNoteId) return;
        const note = notes.find((n) => n.docId === pendingNoteId);
        if (!note) return;
        removeKey(PENDING_COLLAB_NOTE_KEY);
        queueMicrotask(() => openCollaborate(note));
    }, [notes, openCollaborate]);

    // One note per ?action=new: the effect re-runs mid-await (folders/searchParams
    // change, StrictMode). Reset once `action` clears.
    const handledNewNoteRef = useRef(false);

    // Handle URL action params (PWA shortcuts, permission redirects)
    useEffect(() => {
        if (!action) {
            handledNewNoteRef.current = false;
            return;
        }

        const handleAction = async () => {
            if (action === 'search') {
                openSearch(true);
            } else if (action === 'new') {
                // Cold start: wait for folders, or resolveNoteFolderId falls back to Main.
                if (isFolderLoading || handledNewNoteRef.current) return;
                handledNewNoteRef.current = true;

                const targetFolderId = resolveNoteFolderId(folderId, folders);
                const { docId, folderId: newFolderId } = await createNote(targetFolderId);
                // The new URL has no ?action, so skip the setSearchParams cleanup
                // below: it would resolve against the stale pathname and overwrite
                // this entry, bouncing back to "/".
                navigate(`/${newFolderId}/${docId}`, {
                    replace: true,
                    viewTransition: true,
                });
                return;
            } else if (action === 'collaborate') {
                const collaborateNoteId = searchParams.get('noteId');
                if (collaborateNoteId) {
                    const currentNotes = notesRef.current;
                    if (currentNotes.length === 0) return;
                    const note = currentNotes.find((n) => n.docId === collaborateNoteId);
                    if (note) {
                        openCollaborate(note);
                    }
                }
            }

            setSearchParams(
                (params: URLSearchParams) => {
                    params.delete('action');
                    params.delete('noteId');
                    return params;
                },
                { replace: true },
            );
        };

        handleAction();
    }, [
        action,
        folders,
        isFolderLoading,
        folderId,
        createNote,
        navigate,
        setSearchParams,
        searchParams,
        openSearch,
        openCollaborate,
    ]);
}
