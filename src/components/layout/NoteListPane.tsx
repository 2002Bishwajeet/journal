import { useBackTo } from "@/hooks/useBackTo";
import { ArchiveRestore, Trash2, Archive, RefreshCw, FileText, Hash, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PSEUDO_FOLDERS } from "@/lib/homebase/config";
import type { NoteListEntry } from "@/types";
import type { useNoteActions } from "@/hooks";
import type { useSharedPull } from "@/hooks/useSharedPull";
import NoteList from "./NoteList";
import { SyncStatus } from "./SyncStatus";
import { HiddenNotesView } from "./HiddenNotesView";
import { EmptyState } from "./LargeTitle";

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
  /** Phones have no Shared row in the sidebar, so the Shared list carries Refresh. */
  sharedPull?: ReturnType<typeof useSharedPull>;
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
  sharedPull,
}: NoteListPaneProps) {
  const backTo = useBackTo();
  const goBack = () => backTo("/");
  const split = isDesktop || isTablet;
  const onBack = isDesktop ? undefined : isTablet ? onOpenSidebar : goBack;
  const backLabel = isTablet ? "Show folders" : undefined;
  const createNote = () => noteActions.createAndOpen(folderId);
  // Phone and tablet (#830): each list says what it holds. Only a folder offers New note.
  const emptyState = isDesktop ? undefined : selectedTag ? (
    <EmptyState icon={Hash} title={`No notes tagged ${viewLabel}`} description={`Add ${viewLabel} to a note to see it here.`} />
  ) : folderId === PSEUDO_FOLDERS.shared ? (
    <EmptyState icon={Users} title="Nothing shared yet" description="Notes others share with you appear here." />
  ) : (
    <EmptyState icon={FileText} title={`No notes in ${viewLabel ?? "this folder"}`} description="Notes you write here appear in this list.">
      {/* Named apart from the New note button (#878), which is on screen too. */}
      <Button onClick={createNote} aria-label={`New note in ${viewLabel ?? "this folder"}`} className="h-11 rounded-full px-5 text-[15px]">
        <Plus className="size-5" aria-hidden />
        New note
      </Button>
    </EmptyState>
  );

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
            emptyDescription="Deleted notes stay here until you empty Trash."
            rowActions={[
              { icon: ArchiveRestore, label: "Restore note", onClick: noteActions.restoreFromTrash },
              { icon: Trash2, label: "Delete forever", onClick: noteActions.deleteForever, destructive: true },
            ]}
            headerAction={{
              label: "Empty Trash",
              onClick: noteActions.emptyTrash,
              confirm: {
                title: "Empty Trash?",
                description: "This deletes every note in Trash for good. You can't undo this.",
              },
            }}
            compact={!isDesktop}
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
            emptyDescription="Notes you archive leave your lists and stay here until you restore them."
            rowActions={[
              { icon: ArchiveRestore, label: "Unarchive note", onClick: noteActions.unarchive },
              { icon: Trash2, label: "Move to Trash", onClick: noteActions.moveArchivedToTrash, destructive: true },
            ]}
            compact={!isDesktop}
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
          onCreateNote={createNote}
          emptyState={emptyState}
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
          trailing={
            split ? undefined : (
              <>
                {isPhone && folderId === PSEUDO_FOLDERS.shared && sharedPull?.canPull && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Refresh shared notes"
                    aria-busy={sharedPull.isRefreshing}
                    className="size-11 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={sharedPull.refresh}
                  >
                    <RefreshCw className={cn("h-4 w-4", sharedPull.isRefreshing && "animate-spin")} />
                  </Button>
                )}
                <SyncStatus />
              </>
            )
          }
          className="flex-1 w-full border-r-0"
        />
        )}
      </div>
    </div>
  );
}
