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
  /** Tablets show this pane beside the editor; Back opens the folders overlay (#832). */
  isTablet: boolean;
  onOpenSidebar: () => void;
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
  onRemoveFromList: (note: NoteListEntry) => void;
}

/** Middle pane: the note list, or the Trash/Archive management views. */
export function NoteListPane({
  isDesktop,
  isPhone,
  isTablet,
  onOpenSidebar,
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
  onRemoveFromList,
}: NoteListPaneProps) {
  const backTo = useBackTo();
  const goBack = () => backTo("/");
  const split = isDesktop || isTablet;
  const onBack = isDesktop ? undefined : isTablet ? onOpenSidebar : goBack;
  const backLabel = isTablet ? "Show folders" : undefined;

  return (
    <div
      data-pane="note-list"
      className={cn(
        "h-full border-r bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        // Desktop: Always visible, static positioning (part of flex flow).
        // Management views (Trash/Archive) span the full width instead of the
        // fixed 256px note-list column.
        split
          ? isManagementView
            ? "flex flex-1 static"
            : cn("flex static shrink-0", isTablet ? "w-80" : "w-64")
          : "hidden",
        // Mobile: Visible for a folder or tag with no note selected (Absolute covering screen)
        !split &&
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
            onBack={onBack}
            backLabel={backLabel}
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
            onBack={onBack}
            backLabel={backLabel}
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
          onRemoveFromList={onRemoveFromList}
          onArchive={noteActions.archive}
          isLoading={isListLoading}
          title={isDesktop ? undefined : viewLabel || "Notes"}
          onBack={onBack}
          backLabel={backLabel}
          trailing={split ? undefined : <SyncStatus />}
          className="flex-1 w-full border-r-0"
        />
        )}
      </div>
    </div>
  );
}
