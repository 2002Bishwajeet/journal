import type { ReactNode } from "react";
import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import {
  Plus,
  FileText,
  Trash2,
  Share2,
  Download,
  Users,
  Archive,
  FolderInput,
  Globe,
  Pin,
  PinOff,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  ChevronLeft,
  ExternalLink,
  Bot,
} from "lucide-react";
import { useDotYouClientContext } from "@/components/auth";
import { ownerConsoleNoteUrl } from "@/lib/homebase";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/modals";
import { ContextMenuWrapper, RowOptionsMenu, type ContextMenuItemConfig } from "@/components/ui/context-menu-wrapper";
import { cn } from "@/lib/utils";
import { agentDisplayName } from "@/lib/agent/attribution";
import type { NoteListEntry } from "@/types";
import { formatRelativeTime } from "@/lib/utils";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { useSyncService } from "@/hooks/useSyncService";
import { useNotes } from "@/hooks/useNotes";
import { getNoteGroup } from "@/helpers/dateGrouping";
import { useIntersection } from "@/hooks/useIntersection";
import { swipeAxis } from "@/helpers/swipeAxis";
import { haptic } from "@/lib/haptics";

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
  onMarkCollaborative?: (note: NoteListEntry) => void;
  onEditSharing?: (note: NoteListEntry) => void;
  onArchive?: (note: NoteListEntry) => void;
  isLoading?: boolean;
  className?: string;
  /** Identifies the current view (folder or tag); changing it resets the render budget. */
  viewKey?: string;
  /** Phone only: the heading, Back handler and trailing slot that replace the pane's own header. */
  title?: string;
  onBack?: () => void;
  /** Accessible name of the Back button (the tablet one opens the folders). */
  backLabel?: string;
  trailing?: ReactNode;
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
  onMarkCollaborative,
  onEditSharing,
  onArchive,
  isLoading = false,
  className = "",
  viewKey,
  title,
  onBack,
  backLabel = "Back to notes",
  trailing,
}: NoteListProps) {
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
  const handleTogglePin = useCallback(
    (id: string, isPinned: boolean) => togglePin.mutate({ docId: id, isPinned }),
    [togglePin],
  );

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
      <div className="flex items-center justify-between h-12 px-3 border-b border-border shrink-0">
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
          <h2 className="text-sm font-medium text-foreground truncate flex-1 leading-none">{title}</h2>
        ) : (
          <span className="text-sm font-medium text-foreground">Notes</span>
        )}
        <div className="flex items-center gap-1 shrink-0">
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
          {showNewButton && (
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
        className="flex-1 min-h-0 w-full"
        onScrollCapture={() => setOpenRowId(null)}
      >
        <PullToRefresh onRefresh={handleRefresh} className="w-full overflow-x-clip">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <span className="text-sm text-muted-foreground">Loading...</span>
            </div>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 px-4 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/70 mb-3" />
              <p className="text-sm text-muted-foreground mb-2">No notes yet</p>
              <Button variant="link" size="sm" onClick={onCreateNote}>
                Create your first note
              </Button>
            </div>
          ) : (
            <div className="pt-2 pb-[calc(0.5rem+var(--fab-clearance,0px))] w-full space-y-4">
              {visibleGroups.map((group) => (
                <div key={group.label} className="w-full">
                  <button
                    onClick={() => toggleGroup(group.label)}
                    aria-expanded={!group.collapsed}
                    className="sticky top-0 z-10 bg-background flex items-center w-full px-3 py-1 pointer-coarse:min-h-11 hover:bg-muted transition-colors group/header"
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
                    <div className="space-y-0.5 mt-1">
                      {group.shown.map((note) => (
                        <NoteItem
                          key={note.docId}
                          note={note}
                          isSwiped={openRowId === note.docId}
                          onSwipeChange={handleSwipeChange}
                          selectedNoteId={selectedNoteId}
                          onSelectNote={onSelectNote}
                          onDeleteNote={handleDeleteNote}
                          onShareNote={onShareNote}
                          onMoveToFolder={onMoveToFolder}
                          onTogglePin={handleTogglePin}
                          onMarkCollaborative={onMarkCollaborative}
                          onEditSharing={onEditSharing}
                          onArchive={onArchive}
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

const minSwipeDistance = 50;
const maxSwipeDistance = 80;

// Moves a swiped row to `offset` px. While dragging, the CSS transition is off so
// the row follows the finger; on release it is back on for the snap.
function moveRow(
  content: HTMLElement | null,
  action: HTMLElement | null,
  offset: number,
  dragging: boolean,
) {
  if (!content || !action) return;
  const transition = dragging ? "none" : "";
  content.style.transition = transition;
  action.style.transition = transition;
  content.style.transform = `translateX(-${offset}px)`;
  action.style.transform = `translateX(${100 - (offset / maxSwipeDistance) * 100}%)`;
  action.style.opacity = String(Math.min(offset / minSwipeDistance, 1));
}

// Extracted NoteItem for cleaner swipe logic with enhanced touch implementation
const NoteItem = memo(function NoteItem({
  note,
  isSwiped,
  onSwipeChange,
  selectedNoteId,
  onSelectNote,
  onDeleteNote,
  onShareNote,
  onMoveToFolder,
  onTogglePin,
  onMarkCollaborative,
  onEditSharing,
  onArchive,
}: {
  note: NoteListEntry;
  isSwiped: boolean;
  onSwipeChange: (id: string, open: boolean) => void;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onShareNote: (note: NoteListEntry) => void;
  onMoveToFolder?: (note: NoteListEntry) => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
  onMarkCollaborative?: (note: NoteListEntry) => void;
  onEditSharing?: (note: NoteListEntry) => void;
  onArchive?: (note: NoteListEntry) => void;
}) {
  const dotYouClient = useDotYouClientContext();
  const rowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  // The gesture lives in a ref: the drag writes the transform to the DOM, so a
  // touchmove does not re-render the row.
  const gesture = useRef<{
    x: number;
    y: number;
    axis: "x" | "y" | null;
    offset: number;
  } | null>(null);

  const agentName = agentDisplayName(note.metadata.lastEditedBy);
  const isPeerNote =
    !!note.metadata.authorOdinId &&
    note.metadata.authorOdinId !== dotYouClient.getHostIdentity();

  // Sync the row to the open state, so a close from outside animates too.
  useEffect(() => {
    moveRow(contentRef.current, actionRef.current, isSwiped ? maxSwipeDistance : 0, false);
  }, [isSwiped]);

  // A tap anywhere outside an open row closes it.
  useEffect(() => {
    if (!isSwiped) return;
    const closeOnOutsidePress = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) {
        onSwipeChange(note.docId, false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [isSwiped, note.docId, onSwipeChange]);

  const onTouchStart = (e: React.TouchEvent) => {
    gesture.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      axis: null,
      offset: isSwiped ? maxSwipeDistance : 0,
    };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (!g || g.axis === "y") return;
    const dx = e.touches[0].clientX - g.x;
    const dy = e.touches[0].clientY - g.y;
    g.axis ??= swipeAxis(dx, dy);
    // Undecided yet, or a vertical scroll: leave the row alone until touchend.
    if (g.axis !== "x") return;

    const base = isSwiped ? maxSwipeDistance : 0;
    const raw = base - dx;
    const offset =
      raw > maxSwipeDistance
        ? Math.min(maxSwipeDistance + (raw - maxSwipeDistance) * 0.2, 100)
        : Math.max(raw, 0);
    g.offset = offset;
    moveRow(contentRef.current, actionRef.current, offset, true);
  };

  const onTouchEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.axis !== "x") return;

    const open = isSwiped
      ? g.offset > maxSwipeDistance - minSwipeDistance
      : g.offset > minSwipeDistance;
    moveRow(contentRef.current, actionRef.current, open ? maxSwipeDistance : 0, false);
    if (open !== isSwiped) {
      onSwipeChange(note.docId, open);
      haptic(open ? "medium" : "light");
    }
  };

  const handleGlobalClick = (e: React.MouseEvent) => {
    if (isSwiped) {
      e.stopPropagation();
      onSwipeChange(note.docId, false);
    }
  };

  const menuItems: ContextMenuItemConfig[] = [
    {
      label: note.metadata.isPinned ? "Unpin" : "Pin",
      icon: note.metadata.isPinned ? PinOff : Pin,
      action: () => onTogglePin(note.docId, !note.metadata.isPinned),
    },
    {
      label: "Share",
      icon: Share2,
      action: () => onShareNote(note),
    },
    // Collaborative notes live in the shared folder and notes from other people
    // aren't ours to file: neither has a Move item.
    ...(note.metadata.isCollaborative || isPeerNote || !onMoveToFolder
      ? []
      : [
          {
            label: "Move to folder…",
            icon: FolderInput,
            action: () => onMoveToFolder(note),
          },
        ]),
    {
      label: "Export to Markdown",
      icon: Download,
      action: () =>
        void import("@/lib/importexport/exportNoteMarkdown").then((m) =>
          m.exportNoteAsMarkdown(note.docId, note.title || "Untitled"),
        ),
    },
    {
      label: "Open in Owner Console",
      icon: ExternalLink,
      action: () =>
        window.open(
          ownerConsoleNoteUrl(dotYouClient.getRoot(), note.docId),
          "_blank",
          "noopener,noreferrer",
        ),
    },
    {
      label: note.metadata.isCollaborative
        ? "Revoke Collaboration"
        : "Mark as Collaborative",
      icon: Users,
      action: () => onMarkCollaborative?.(note),
      disabled: !onMarkCollaborative,
    },
    // Change who your shared note is shared with (#897)
    ...(note.metadata.isCollaborative && !isPeerNote && onEditSharing
      ? [{ label: "Edit Sharing", icon: Users, action: () => onEditSharing(note) }]
      : []),
    {
      label: "Archive",
      icon: Archive,
      action: () => onArchive?.(note),
      disabled: !onArchive,
    },
    {
      label: "Move to Trash",
      icon: Trash2,
      action: () => onDeleteNote(note.docId),
      variant: "destructive",
      shortcut: "⌫",
    },
  ];

  return (
    <div
      ref={rowRef}
      data-testid="note-row"
      className="relative overflow-hidden w-full select-none [-webkit-touch-callout:none]"
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
              "transition-all duration-300 ease-out",
              isSwiped && "shadow-[-4px_0_16px_rgba(239,68,68,0.3)]",
            )}
            style={{ transform: "translateX(100%)", opacity: 0 }}
          >
            <button
              aria-label="Move to Trash"
              className="w-full h-full flex items-center justify-center active:scale-110 transition-transform"
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
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
            className={cn(
              "relative grid grid-cols-1 w-full px-4 py-3.5 text-left bg-background group cursor-pointer outline-none focus:bg-accent select-none",
              "hover:bg-accent",
              "transition-[transform,background-color] duration-200 ease-out",
              selectedNoteId === note.docId && "bg-accent",
            )}
            style={{ touchAction: "pan-y" }}
          >
            <RowOptionsMenu
              items={menuItems}
              label="Note options"
              className="absolute right-0 top-0"
            />
            <div className="flex items-start justify-between gap-2 w-full overflow-hidden pointer-coarse:pr-9">
              <span
                className={cn(
                  "text-sm font-medium truncate flex-1",
                  selectedNoteId === note.docId
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
            <p className="text-xs text-muted-foreground truncate mt-0.5 w-full">
              {note.preview || "No content"}
            </p>
            {(note.metadata.tags ?? []).length > 0 && (
              <div className="flex items-center gap-1 mt-1 overflow-hidden">
                {(note.metadata.tags ?? []).slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded bg-muted text-xs text-muted-foreground shrink-0"
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
            <span className="text-xs text-muted-foreground/70 mt-1">
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
