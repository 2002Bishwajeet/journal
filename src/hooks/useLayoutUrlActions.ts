import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { resolveNoteFolderId } from '@/hooks/useFolders';
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
 * permission redirects).
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
    // ?action=collaborate waits for the notes: after the permission redirect the
    // app reloads, and they arrive from PGlite after the first run of the effect.
    const hasNotes = notes.length > 0;

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
        hasNotes,
    ]);
}
