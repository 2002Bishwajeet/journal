import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useNotes } from '@/hooks/useNotes';
import { resolveNoteFolderId } from '@/hooks/useFolders';
import { useDotYouClientContext } from '@/components/auth';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';
import type { NoteListEntry } from '@/types';

interface UseNoteActionsOptions {
    folderId: string | undefined;
    noteId: string | undefined;
    selectedTag: string | null;
    /** The note list currently shown — used to pick a deleted note's neighbour. */
    notes: NoteListEntry[];
    folders: ReadonlyArray<{ id: string }>;
    /** Closes a tab without navigating. */
    closeTab: (docId: string) => void;
    /** Closes a tab and leaves it if it's the open note. */
    handleTabClose: (docId: string) => void;
}

/**
 * Note actions for the layout's note list, Trash/Archive views and dialogs:
 * opening a note from the list (keeping a tag filter), trash/archive
 * transitions with user-visible error feedback, delete then open
 * the neighbour, create then open, and revoking collaboration.
 */
export function useNoteActions({
    folderId,
    noteId,
    selectedTag,
    notes,
    folders,
    closeTab,
    handleTabClose,
}: UseNoteActionsOptions) {
    const navigate = useNavigate();
    const dotYouClient = useDotYouClientContext();

    const {
        createNote: { mutateAsync: createNote },
        deleteNote: { mutateAsync: deleteNote },
        trashNote: { mutateAsync: trashNote },
        restoreNote: { mutateAsync: restoreNote },
        archiveNote: { mutateAsync: archiveNote },
        unarchiveNote: { mutateAsync: unarchiveNote },
        emptyTrash: { mutateAsync: emptyTrashMutation },
        updateNote: { mutateAsync: updateNoteMetadata },
    } = useNotes();

    // Trash / Archive actions — stable handlers with user-visible error feedback.
    const restoreFromTrash = useCallback(
        (id: string) => {
            restoreNote(id).catch(() => toast.error("Couldn't restore note"));
        },
        [restoreNote],
    );
    const deleteForever = useCallback(
        (id: string) => {
            // Close any open tab first so the editor can't resurrect the note via a debounced save.
            closeTab(id);
            deleteNote(id).catch(() => toast.error("Couldn't delete note"));
        },
        [deleteNote, closeTab],
    );
    const emptyTrash = useCallback(() => {
        emptyTrashMutation().catch(() => toast.error("Couldn't empty Trash"));
    }, [emptyTrashMutation]);
    const unarchive = useCallback(
        (id: string) => {
            unarchiveNote(id).catch(() => toast.error("Couldn't unarchive note"));
        },
        [unarchiveNote],
    );
    const moveArchivedToTrash = useCallback(
        (id: string) => {
            closeTab(id);
            trashNote(id).catch(() => toast.error("Couldn't move note to Trash"));
        },
        [trashNote, closeTab],
    );
    const archive = useCallback(
        (note: NoteListEntry) => {
            // Archived notes leave the active list, so an open tab would flip to
            // "Note not found" — close it (and leave it, if it's the open note).
            handleTabClose(note.docId);
            archiveNote(note.docId).catch(() => toast.error("Couldn't archive note"));
        },
        [archiveNote, handleTabClose],
    );

    const selectNote = (id: string) => {
        const note = notes.find((n) => n.docId === id);
        const targetFolder = note?.metadata.folderId || folderId;
        if (selectedTag) {
            navigate(
                `/${targetFolder}/${id}?tag=${encodeURIComponent(selectedTag)}`,
                { viewTransition: true },
            );
        } else {
            navigate(`/${folderId}/${id}`, { viewTransition: true });
        }
    };

    const deleteAndSelectNeighbour = async (id: string) => {
        // Find the next note to select
        const currentIndex = notes.findIndex((n) => n.docId === id);
        let nextNoteId: string | null = null;

        if (currentIndex !== -1 && notes.length > 1) {
            if (currentIndex < notes.length - 1) {
                // Select next note
                nextNoteId = notes[currentIndex + 1].docId;
            } else {
                // Select previous note if we are deleting the last one
                nextNoteId = notes[currentIndex - 1].docId;
            }
        }

        // Also close the tab if it's open
        closeTab(id);

        try {
            await trashNote(id);
        } catch {
            toast.error("Couldn't move note to Trash");
            return;
        }

        // If the deleted note is the one currently open, navigate to next note or folder
        if (noteId === id) {
            if (nextNoteId) {
                navigate(`/${folderId}/${nextNoteId}`, {
                    viewTransition: true,
                });
            } else {
                navigate(`/${folderId}`, { viewTransition: true });
            }
        }
    };

    const createAndOpen = async (targetFolderId: string | undefined) => {
        // Falls back to Main for pseudo-folder routes (Trash/Archive/Shared)
        // and unknown folder ids — see resolveNoteFolderId.
        const { docId, folderId: newFolderId } = await createNote(
            resolveNoteFolderId(targetFolderId, folders),
        );
        if (docId)
            navigate(`/${newFolderId}/${docId}`, { viewTransition: true });
    };

    const revokeCollaboration = async (note: NoteListEntry | null) => {
        if (!note || !dotYouClient) return;
        try {
            const provider = new NotesDriveProvider(dotYouClient);
            const editorOdinId = dotYouClient.getHostIdentity() || '';
            await provider.revokeNoteCollaboration(
                note.docId,
                editorOdinId,
            );
            await updateNoteMetadata({
                docId: note.docId,
                metadata: {
                    ...note.metadata,
                    folderId: MAIN_FOLDER_ID,
                    isCollaborative: false,
                    circleIds: undefined,
                    recipients: undefined,
                    lastEditedBy: editorOdinId,
                },
            });
            toast.success('Collaboration revoked');
        } catch (err) {
            console.error('Failed to revoke collaboration:', err);
            toast.error('Failed to revoke collaboration');
        }
    };

    return {
        selectNote,
        restoreFromTrash,
        deleteForever,
        emptyTrash,
        archive,
        unarchive,
        moveArchivedToTrash,
        deleteAndSelectNeighbour,
        createAndOpen,
        revokeCollaboration,
    };
}
