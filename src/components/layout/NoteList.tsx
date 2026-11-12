import type { ReactNode } from "react";
import { useState, useMemo, useCallback, useRef, memo } from "react";
import {
  Plus,
  FileText,
  Trash2,
  Users,
  Globe,
  Pin,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  ChevronLeft,
  Bot,
} from "lucide-react";
import { useDotYouClientContext } from "@/components/auth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/modals";
import { ContextMenuWrapper, RowOptionsMenu } from "@/components/ui/context-menu-wrapper";
import { buildNoteMenuItems } from "@/helpers/noteMenuItems";
import { cn } from "@/lib/utils";
import { agentDisplayName } from "@/lib/agent/attribution";
import type { NoteListEntry } from "@/types";
import { formatRelativeTime } from "@/lib/utils";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { useSyncService } from "@/hooks/useSyncService";
import { useNotes } from "@/hooks/useNotes";
import { getNoteGroup } from "@/helpers/dateGrouping";
import { useIntersection } from "@/hooks/useIntersection";
import { haptic } from "@/lib/haptics";
import { useLargeTitle } from "@/hooks/useLargeTitle";
import { useSwipeRow } from "@/hooks/useSwipeRow";
import { useCanEdit } from "@/hooks/useCanEdit";
import { useStableHandlers } from "@/hooks/useStableHandlers";
import { BarTitle, LargeTitle } from "./LargeTitle";
import { FILL_EMPTY_VIEWPORT, largeTitleBarClass } from "./largeTitleClasses";

// Rows mounted per render step; the sentinel adds another page as it scrolls into view.
const PAGE = 100;

interface NoteListProps {
  notes: NoteListEntry[];
  selectedNoteId: string | null;
  onSelectNote: (docId: string) => void;
  onCreateNote: () => void;
  /** The header's New button; phones hide it for the New note button (#878). */
  showNewButton?: boolean;
  onDeleteNote: (docId: string) => void;
  onShareNote: (note: NoteListEntry) => void;
  onMoveToFolder?: (note: NoteListEntry) => void;
  /** A receiver drops a note shared with them from this device (#682). */
  onRemoveFromList?: (note: NoteListEntry) => void;
  onArchive?: (note: NoteListEntry) => void;
  isLoading?: boolean;
  className?: string;
  /** Identifies the current view (folder or tag); changing it resets the render budget. */
  viewKey?: string;
  /** Phone and tablet: the large title (#830), Back handler and trailing slot that replace the pane's own header. */
  title?: string;
  /** Phone and tablet: what an empty list shows instead of "No notes yet" (#830). */
  emptyState?: ReactNode;
  onBack?: () => void;
  /** Accessible name of the Back button (the tablet one opens the folders). */
  backLabel?: string;
  trailing?: ReactNode;
  /** Phone (#1162): the sync pill, in the bar's middle above the large title. */
  barStatus?: ReactNode;
}

export default function NoteList({
  notes,
  selectedNoteId,
  onSelectNote,
  onCreateNote,
  showNewButton = true,
  onDeleteNote,
  onShareNote,
  onMoveToFolder,
  onRemoveFromList,
  onArchive,
  isLoading = false,
  className = "",
  viewKey,
  title,
  emptyState,
  onBack,
  backLabel = "Back to notes",
  trailing,
  barStatus,
}: NoteListProps) {
  const largeTitle = useLargeTitle(!!title);
  // Read-only (#1176): no New, no row actions but export; rows still open.
  const canEdit = useCanEdit();
  const isEmpty = !isLoading && notes.length === 0;
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"modified" | "created" | "title">(
    "modified",
  );
  const { sync } = useSyncService();
  const { togglePin } = useNotes();
  // One swiped-open row at a time; it closes on scroll and on a tap outside it.
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );

  // Render budget: reset to one page when the sort or the view changes
  // (adjust-state-during-render, so collapsed groups are kept).
  const [limit, setLimit] = useState(PAGE);
  const limitKey = `${sortBy}::${viewKey ?? ""}`;
  const [renderedLimitKey, setRenderedLimitKey] = useState(limitKey);
  if (renderedLimitKey !== limitKey) {
    setRenderedLimitKey(limitKey);
    setLimit(PAGE);
  }
  const sentinelRef = useRef<HTMLDivElement>(null);
  useIntersection(sentinelRef, () => setLimit((l) => l + PAGE), true);

  const handleRefresh = async () => {
    // The note list is a live query — a sync pull surfaces new notes automatically.
    await sync();
  };

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const handleDeleteNote = useCallback((id: string) => setNoteToDelete(id), []);
  const handleSwipeChange = useCallback(
    (id: string, open: boolean) =>
      setOpenRowId((cur) => (open ? id : cur === id ? null : cur)),
    [],
  );
  // Rows are memoized, but the layout's handlers change on every list emission, which
  // re-rendered all of them several times per folder switch (#1219).
  const rowHandlers = useStableHandlers({
    onSelectNote,
    onShareNote,
    onMoveToFolder,
    onRemoveFromList,
    onArchive,
    onTogglePin: (id: string, isPinned: boolean) => togglePin.mutate({ docId: id, isPinned }),
  });

  const groupedNotes = useMemo(() => {
    const groups: { label: string; notes: NoteListEntry[] }[] = [];

    // Partition into pinned / unpinned in a single pass.
    const pinnedNotes: NoteListEntry[] = [];
    const unpinned: NoteListEntry[] = [];
    for (const n of notes) {
      (n.metadata.isPinned ? pinnedNotes : unpinned).push(n);
    }

    if (pinnedNotes.length > 0) {
      const sortedPinned = pinnedNotes.toSorted(
        (a: NoteListEntry, b: NoteListEntry) =>
          new Date(b.metadata.timestamps.modified).getTime() -
          new Date(a.metadata.timestamps.modified).getTime(),
      );
      groups.push({ label: "Pinned", notes: sortedPinned });
    }

    const unpinnedNotes = unpinned
      .toSorted((a: NoteListEntry, b: NoteListEntry) => {
        switch (sortBy) {
          case "created":
            return (
              new Date(b.metadata.timestamps.created).getTime() -
              new Date(a.metadata.timestamps.created).getTime()
            );
          case "title":
            return (a.title || "Untitled").localeCompare(b.title || "Untitled");
          default:
            return (
              new Date(b.metadata.timestamps.modified).getTime() -
              new Date(a.metadata.timestamps.modified).getTime()
            );
        }
      });

    if (sortBy === "title") {
      if (unpinnedNotes.length > 0) {
        groups.push({ label: "All Notes", notes: unpinnedNotes });
      }
    } else {
      const dateGroups: Record<string, NoteListEntry[]> = {};
      const groupOrder: string[] = [];

      unpinnedNotes.forEach((note) => {
        const groupTimestamp =
          sortBy === "created"
            ? note.metadata.timestamps.created
            : note.metadata.timestamps.modified;
        const groupLabel = getNoteGroup(groupTimestamp);
        if (!dateGroups[groupLabel]) {
          dateGroups[groupLabel] = [];
          groupOrder.push(groupLabel);
        }
        dateGroups[groupLabel].push(note);
      });

      groupOrder.forEach((label) => {
        groups.push({ label, notes: dateGroups[label] });
      });
    }

    return groups;
  }, [notes, sortBy]);

  // Spend the budget across groups in order (Pinned first); collapsed groups use none.
  let budget = limit;
  let hasMoreRows = false;
  const visibleGroups = groupedNotes.map((group) => {
    const collapsed = collapsedGroups.has(group.label);
    const shown = collapsed ? [] : group.notes.slice(0, budget);
    budget -= shown.length;
    if (!collapsed && shown.length < group.notes.length) hasMoreRows = true;
    return { ...group, collapsed, shown };
  });

  return (
    <div
      className={cn(
        "flex flex-col h-full w-full max-w-full bg-background border-r border-border overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "justify-between",
          title ? largeTitleBarClass(largeTitle.collapsed) : "flex items-center h-12 px-3 border-b border-border shrink-0",
        )}
      >
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={backLabel}
            className="h-8 w-8 shrink-0 pointer-coarse:size-11"
            onClick={onBack}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        {title ? (
          <>
            {barStatus}
            <BarTitle show={largeTitle.collapsed}>{title}</BarTitle>
          </>
        ) : (
          <span className="text-sm font-medium text-foreground">Notes</span>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Sort notes" className="h-7 w-7 pointer-coarse:size-11">
                <ArrowUpDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setSortBy("modified")}
                className={sortBy === "modified" ? "bg-accent" : ""}
              >
                Last modified
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSortBy("created")}
                className={sortBy === "created" ? "bg-accent" : ""}
              >
                Date created
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSortBy("title")}
                className={sortBy === "title" ? "bg-accent" : ""}
              >
                Title A-Z
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {showNewButton && canEdit && (
            <Button size="sm" onClick={onCreateNote} className="relative h-7 text-xs after:absolute after:inset-x-0 after:-inset-y-2">
              <Plus className="h-3.5 w-3.5 mr-1" />
              New
            </Button>
          )}
          {trailing}
        </div>
      </div>

      {/* Notes list */}
      <ScrollArea
        className={cn(
          "flex-1 min-h-0 w-full",
          isEmpty && emptyState && FILL_EMPTY_VIEWPORT,
        )}
        onScrollCapture={() => setOpenRowId(null)}
      >
        <PullToRefresh onRefresh={handleRefresh} className="w-full overflow-x-clip">
          <div className="flex h-full flex-col">
          {title && <LargeTitle titleRef={largeTitle.ref}>{title}</LargeTitle>}
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <span className="text-sm text-muted-foreground">Loading...</span>
            </div>
          ) : isEmpty ? (
            emptyState ?? <div className="flex flex-col items-center justify-center h-48 px-4 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/70 mb-3" />
              <p className="text-sm text-muted-foreground mb-2">No notes yet</p>
              {canEdit && (
                <Button variant="link" size="sm" onClick={onCreateNote}>
                  Create your first note
                </Button>
              )}
            </div>
          ) : (
            <div className="pt-2 pb-[calc(0.5rem+var(--fab-clearance,0px))] w-full space-y-4">
              {visibleGroups.map((group) => (
                <div key={group.label} className="w-full">
                  <button
                    onClick={() => toggleGroup(group.label)}
                    aria-expanded={!group.collapsed}
                    className="press-row sticky top-0 z-10 bg-background flex items-center w-full px-3 py-1 pointer-coarse:min-h-11 pointer-coarse:px-4 hover:bg-muted transition-colors duration-(--duration-fade) ease-(--ease-standard) group/header"
                  >
                    {group.collapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                    )}
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {group.label}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground/70 opacity-0 pointer-coarse:opacity-100 group-hover/header:opacity-100 transition-opacity">
                      {group.notes.length}
                    </span>
                  </button>

                  {!group.collapsed && group.shown.length > 0 && (
                    <div className="space-y-0.5 mt-1 pointer-coarse:space-y-0 pointer-coarse:mt-0">
                      {group.shown.map((note) => (
                        <NoteItem
                          key={note.docId}
                          note={note}
                          isSwiped={openRowId === note.docId}
                          onSwipeChange={handleSwipeChange}
                          isSelected={selectedNoteId === note.docId}
                          onSelectNote={rowHandlers.onSelectNote}
                          onDeleteNote={handleDeleteNote}
                          onShareNote={rowHandlers.onShareNote}
                          onMoveToFolder={rowHandlers.onMoveToFolder}
                          onTogglePin={rowHandlers.onTogglePin}
                          onRemoveFromList={rowHandlers.onRemoveFromList}
                          onArchive={rowHandlers.onArchive}
                          canEdit={canEdit}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {hasMoreRows && (
                <div ref={sentinelRef} aria-hidden className="h-8" />
              )}
            </div>
          )}
          </div>
        </PullToRefresh>
      </ScrollArea>

      <ConfirmDialog
        isOpen={!!noteToDelete}
        onClose={() => setNoteToDelete(null)}
        onConfirm={() => {
          if (noteToDelete) {
            onDeleteNote(noteToDelete);
          }
        }}
        title="Move to Trash?"
        description="This note will be moved to Trash. You can restore it from there."
        confirmText="Move to Trash"
      />
    </div>
  );
}

// Extracted NoteItem for cleaner swipe logic with enhanced touch implementation
const NoteItem = memo(function NoteItem({
  note,
  isSwiped,
  onSwipeChange,
  isSelected,
  onSelectNote,
  onDeleteNote,
  onShareNote,
  onMoveToFolder,
  onTogglePin,
  onRemoveFromList,
  onArchive,
  canEdit,
}: {
  note: NoteListEntry;
  isSwiped: boolean;
  onSwipeChange: (id: string, open: boolean) => void;
  isSelected: boolean;
  onSelectNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onShareNote: (note: NoteListEntry) => void;
  onMoveToFolder?: (note: NoteListEntry) => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
  onRemoveFromList?: (note: NoteListEntry) => void;
  onArchive?: (note: NoteListEntry) => void;
  canEdit: boolean;
}) {
  const dotYouClient = useDotYouClientContext();
  const { rowRef, contentRef, actionRef, touchHandlers } = useSwipeRow(note.docId, isSwiped, onSwipeChange);

  const agentName = agentDisplayName(note.metadata.lastEditedBy);
  const isPeerNote =
    !!note.metadata.authorOdinId &&
    note.metadata.authorOdinId !== dotYouClient.getHostIdentity();

  const handleGlobalClick = (e: React.MouseEvent) => {
    if (isSwiped) {
      e.stopPropagation();
      onSwipeChange(note.docId, false);
    }
  };

  const menuItems = buildNoteMenuItems(note, {
    isPeerNote,
    canEdit,
    dotYouRoot: dotYouClient.getRoot(),
    handlers: { onTogglePin, onShare: onShareNote, onMoveToFolder, onRemoveFromList, onArchive, onTrash: onDeleteNote, onOpen: onSelectNote },
  });

  return (
    <div
      ref={rowRef}
      data-testid="note-row"
      className="group/row relative overflow-hidden w-full select-none [-webkit-touch-callout:none]"
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 72px" }}
      onClick={isSwiped ? handleGlobalClick : undefined}
    >
      <ContextMenuWrapper items={menuItems}>
        <div className="relative w-full h-full">
          {/* Background Action (Delete) with glow effect */}
          <div
            ref={actionRef}
            className={cn(
              "absolute inset-y-0 right-0 w-20 bg-destructive flex items-center justify-center text-destructive-foreground",
              "transition-[transform,opacity,box-shadow] duration-(--duration-fade) ease-(--ease-standard)",
              isSwiped && "shadow-[-4px_0_16px_rgba(239,68,68,0.3)]",
            )}
            style={{ transform: "translateX(100%)", opacity: 0 }}
          >
            <button
              aria-label="Move to Trash"
              disabled={!canEdit}
              className="w-full h-full flex items-center justify-center active:scale-110 transition-transform duration-(--duration-press) ease-(--ease-standard)"
              onClick={(e) => {
                e.stopPropagation();
                haptic("medium");
                onDeleteNote(note.docId);
              }}
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>

          {/* Note Content */}
          <div
            ref={contentRef}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (!isSwiped) {
                onSelectNote(note.docId);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectNote(note.docId);
              }
            }}
            {...(canEdit ? touchHandlers : {})}
            className={cn(
              "press-row relative grid grid-cols-1 w-full px-4 py-3.5 text-left bg-background group cursor-pointer outline-none focus:bg-accent select-none",
              "hover:bg-accent",
              // Touch (#781): title, then the time and preview on one line, then tags, as iOS Notes
              // lays a row out; an inset hairline between rows, none under a group's last row.
              "pointer-coarse:grid-cols-[auto_minmax(0,1fr)] pointer-coarse:gap-x-2 pointer-coarse:py-3",
              "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:bottom-0 pointer-coarse:after:ml-4 pointer-coarse:after:h-px pointer-coarse:after:bg-border/60 group-last/row:after:hidden",
              "transition-[transform,background-color] duration-(--duration-fade) ease-(--ease-standard)",
              isSelected && "bg-accent",
            )}
            style={{ touchAction: "pan-y" }}
          >
            <RowOptionsMenu
              items={menuItems}
              label="Note options"
              className="absolute right-0 top-0"
            />
            <div className="flex items-start justify-between gap-2 w-full overflow-hidden pointer-coarse:items-center pointer-coarse:col-span-2 pointer-coarse:row-start-1 pointer-coarse:pr-9">
              <span
                className={cn(
                  "text-sm font-medium truncate flex-1 pointer-coarse:text-[15px] pointer-coarse:leading-5 pointer-coarse:font-semibold",
                  isSelected
                    ? "text-accent-foreground"
                    : "text-foreground",
                )}
              >
                {note.title || "Untitled"}
              </span>
              {note.metadata.isPinned && (
                <Pin className="h-3 w-3 text-muted-foreground/70 shrink-0" />
              )}
              {note.metadata.isPublic && (
                <Globe className="h-3 w-3 text-muted-foreground/70 shrink-0" />
              )}
              {note.metadata.isCollaborative && (
                <Users className="h-3 w-3 text-collaborative/70 shrink-0" />
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5 w-full pointer-coarse:col-start-2 pointer-coarse:row-start-2 pointer-coarse:text-[13px] pointer-coarse:leading-[18px]">
              {note.preview || "No content"}
            </p>
            {(note.metadata.tags ?? []).length > 0 && (
              <div className="flex items-center gap-1 mt-1 overflow-hidden pointer-coarse:col-span-2 pointer-coarse:row-start-3 pointer-coarse:mt-1.5">
                {(note.metadata.tags ?? []).slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className={cn(
                      "inline-flex items-center gap-0.5 px-1.5 py-0 rounded bg-muted text-xs text-muted-foreground shrink-0",
                      // Touch (#781): bg-muted matches the selected row's accent, so the chip takes the border tone there.
                      isSelected && "pointer-coarse:bg-border",
                    )}
                  >
                    #{"\u2009"}
                    {tag}
                  </span>
                ))}
                {(note.metadata.tags ?? []).length > 3 && (
                  <span className="text-xs text-muted-foreground/70">
                    +{(note.metadata.tags ?? []).length - 3}
                  </span>
                )}
              </div>
            )}
            <span className="text-xs text-muted-foreground/70 mt-1 tabular-nums pointer-coarse:col-start-1 pointer-coarse:row-start-2 pointer-coarse:mt-0.5 pointer-coarse:text-[13px] pointer-coarse:leading-[18px] pointer-coarse:font-medium pointer-coarse:text-foreground/70">
              {formatRelativeTime(note.metadata.timestamps.modified)}
              {agentName && (
                <>
                  {" · "}
                  <Bot className="inline size-3" aria-hidden />
                  {" Edited by " + agentName}
                </>
              )}
            </span>
          </div>
        </div>
      </ContextMenuWrapper>
    </div>
  );
});
