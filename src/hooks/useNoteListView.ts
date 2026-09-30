import { PSEUDO_FOLDERS } from '@/lib/homebase/config';
import {
    useNotesByFolder,
    useNoteCounts,
    useCollaborativeNotes,
    useTrashedNotes,
    useArchivedNotes,
} from '@/hooks/useNotes';
import { useNotesByTag } from '@/hooks/useTags';

interface UseNoteListViewOptions {
    folderId: string | undefined;
    selectedTag: string | null;
}

/**
 * The note list for the current route: a tag filter, Shared, Trash, Archive or
 * a folder, with its loading flag and the sidebar badge counts.
 */
export function useNoteListView({ folderId, selectedTag }: UseNoteListViewOptions) {
    // Trash/Archive are read-only management lists — their notes can't be opened
    // in the editor, so on desktop the list takes the full width and the editor
    // panel is hidden (otherwise the list is crammed into the 256px note column
    // with a dead editor beside it).
    const isManagementView = folderId === PSEUDO_FOLDERS.trash || folderId === PSEUDO_FOLDERS.archive;

    const { data: filteredNotes = [], isLoading: isFilteredNotesLoading } =
        useNotesByFolder(folderId);
    // Sidebar badge counts come from one lightweight live query. The full
    // trash/archive/shared lists are only subscribed when their view is open, so
    // they don't each spin up a live subscription at boot.
    const counts = useNoteCounts();
    const { data: collaborativeNotes = [], isLoading: isCollaborativeLoading } =
        useCollaborativeNotes(folderId === PSEUDO_FOLDERS.shared);
    const { data: trashedNotes = [], isLoading: isTrashLoading } =
        useTrashedNotes(folderId === PSEUDO_FOLDERS.trash);
    const { data: archivedNotes = [], isLoading: isArchivedLoading } =
        useArchivedNotes(folderId === PSEUDO_FOLDERS.archive);
    const { data: tagFilteredNotes } = useNotesByTag(selectedTag);

    if (folderId === PSEUDO_FOLDERS.trash) {
        return { notes: trashedNotes, isLoading: isTrashLoading, isManagementView, counts };
    }
    if (folderId === PSEUDO_FOLDERS.archive) {
        return { notes: archivedNotes, isLoading: isArchivedLoading, isManagementView, counts };
    }

    const notesToShow = selectedTag
        ? (tagFilteredNotes ?? [])
        : folderId === PSEUDO_FOLDERS.shared
          ? collaborativeNotes
          : filteredNotes;
    const isNotesToShowLoading =
        folderId === PSEUDO_FOLDERS.shared ? isCollaborativeLoading : isFilteredNotesLoading;

    return { notes: notesToShow, isLoading: isNotesToShowLoading, isManagementView, counts };
}
