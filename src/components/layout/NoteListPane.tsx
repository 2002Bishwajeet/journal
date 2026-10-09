import { useNavigate } from "react-router-dom";
import { ChevronLeft, ArchiveRestore, Trash2, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PSEUDO_FOLDERS } from "@/lib/homebase/config";
import type { NoteListEntry } from "@/types";
import type { useNoteActions } from "@/hooks";
import NoteList from "./NoteList";
import { SyncStatus } from "./SyncStatus";
import { HiddenNotesView } from "./HiddenNotesView";

interface NoteListPaneProps {
  isDesktop: boolean;
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
  onMarkCollaborative: (note: NoteListEntry) => void;
}

/** Middle pane: the note list, or the Trash/Archive management views. */
export function NoteListPane({
  isDesktop,
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
  onMarkCollaborative,
}: NoteListPaneProps) {
  const navigate = useNavigate();

  return (
    <div
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
        {/* Mobile Header for NoteList — management views (Trash/Archive) carry
            their own header with a back button, so skip this one for them. */}
        <div
          className={cn(
            "flex items-center h-12 px-3 border-b border-border gap-2 shrink-0",
            (isDesktop || isManagementView) && "hidden",
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to notes"
            className="h-8 w-8"
            onClick={() => navigate("/")}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-sm font-medium truncate flex-1 leading-none">
            {viewLabel || "Notes"}
          </h2>
          <SyncStatus />
        </div>

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
            onBack={isDesktop ? undefined : () => navigate("/")}
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
            onBack={isDesktop ? undefined : () => navigate("/")}
            className="flex-1"
          />
        ) : (
        <NoteList
          notes={listNotes}
          viewKey={selectedTag ? `tag:${selectedTag}` : folderId}
          selectedNoteId={noteId || null}
          onSelectNote={noteActions.selectNote}
          onCreateNote={() => noteActions.createAndOpen(folderId)}
          onDeleteNote={noteActions.deleteAndSelectNeighbour}
          onShareNote={onShareNote}
          onMarkCollaborative={onMarkCollaborative}
          onArchive={noteActions.archive}
          isLoading={isListLoading}
          className="flex-1 w-full border-r-0"
        />
        )}
      </div>
    </div>
  );
}
