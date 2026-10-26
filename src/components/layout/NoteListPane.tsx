import { useBackTo } from "@/hooks/useBackTo";
import { ArchiveRestore, Trash2, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { PSEUDO_FOLDERS } from "@/lib/homebase/config";
import type { NoteListEntry } from "@/types";
import type { useNoteActions } from "@/hooks";
import NoteList from "./NoteList";
import { SyncStatus } from "./SyncStatus";
import { HiddenNotesView } from "./HiddenNotesView";

interface NoteListPaneProps {
  isDesktop: boolean;
  /** Phones create notes with the New note button (#878), so the list header has no New. */
  isPhone: boolean;
  isManagementView: boolean;
  isListVisibleOnMobile: boolean;
  inFocusMode: boolean;
  folderId?: string;
  noteId?: string;
  selectedTag: string | null;
  viewLabel?: string;
  listNotes: NoteListEntry[];
  isListLoading: boolean;
  noteActions: ReturnType<typeof useNoteActions>;
  onShareNote: (note: NoteListEntry) => void;
  onMoveToFolder: (note: NoteListEntry) => void;
  onMarkCollaborative: (note: NoteListEntry) => void;
}

/** Middle pane: the note list, or the Trash/Archive management views. */
export function NoteListPane({
  isDesktop,
  isPhone,
  isManagementView,
  isListVisibleOnMobile,
  inFocusMode,
  folderId,
  noteId,
  selectedTag,
  viewLabel,
  listNotes,
  isListLoading,
  noteActions,
  onShareNote,
  onMoveToFolder,
  onMarkCollaborative,
}: NoteListPaneProps) {
  const backTo = useBackTo();
  const goBack = () => backTo("/");

  return (
    <div
      data-pane="note-list"
      className={cn(
        "h-full border-r bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        // Desktop: Always visible, static positioning (part of flex flow).
        // Management views (Trash/Archive) span the full width instead of the
        // fixed 256px note-list column.
        isDesktop
          ? isManagementView
            ? "flex flex-1 static"
            : "flex w-64 static shrink-0"
          : "hidden",
        // Mobile: Visible for a folder or tag with no note selected (Absolute covering screen)
        !isDesktop &&
          isListVisibleOnMobile &&
          "flex absolute inset-0 z-20 w-full",
        inFocusMode && "hidden!",
      )}
    >
      <div className="flex flex-col h-full w-full max-w-full min-w-0 overflow-hidden">
        {folderId === PSEUDO_FOLDERS.trash ? (
          <HiddenNotesView
            title="Trash"
            notes={listNotes}
            isLoading={isListLoading}
            emptyIcon={Trash2}
            emptyLabel="Trash is empty"
            rowActions={[
              { icon: ArchiveRestore, label: "Restore note", onClick: noteActions.restoreFromTrash },
              { icon: Trash2, label: "Delete forever", onClick: noteActions.deleteForever, destructive: true },
            ]}
            headerAction={{ label: "Empty Trash", onClick: noteActions.emptyTrash }}
            onBack={isDesktop ? undefined : goBack}
            className="flex-1"
          />
        ) : folderId === PSEUDO_FOLDERS.archive ? (
          <HiddenNotesView
            title="Archive"
            notes={listNotes}
            isLoading={isListLoading}
            emptyIcon={Archive}
            emptyLabel="No archived notes"
            rowActions={[
              { icon: ArchiveRestore, label: "Unarchive note", onClick: noteActions.unarchive },
              { icon: Trash2, label: "Move to Trash", onClick: noteActions.moveArchivedToTrash, destructive: true },
            ]}
            onBack={isDesktop ? undefined : goBack}
            className="flex-1"
          />
        ) : (
        <NoteList
          notes={listNotes}
          viewKey={selectedTag ? `tag:${selectedTag}` : folderId}
          selectedNoteId={noteId || null}
          onSelectNote={noteActions.selectNote}
          onCreateNote={() => noteActions.createAndOpen(folderId)}
          showNewButton={!isPhone}
          onDeleteNote={noteActions.deleteAndSelectNeighbour}
          onShareNote={onShareNote}
          onMoveToFolder={onMoveToFolder}
          onMarkCollaborative={onMarkCollaborative}
          onArchive={noteActions.archive}
          isLoading={isListLoading}
          title={isDesktop ? undefined : viewLabel || "Notes"}
          onBack={isDesktop ? undefined : goBack}
          trailing={isDesktop ? undefined : <SyncStatus />}
          className="flex-1 w-full border-r-0"
        />
        )}
      </div>
    </div>
  );
}
