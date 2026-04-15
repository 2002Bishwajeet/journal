import { useState, useMemo, useRef, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus, FileText, Trash2, Share2, Users, Pin, PinOff, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/modals';
import { ContextMenuWrapper } from '@/components/ui/context-menu-wrapper';
import { cn } from '@/lib/utils';
import type { NoteListEntry } from '@/types';
import { formatRelativeTime } from '@/lib/utils/index';
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { useSyncService } from "@/hooks/useSyncService";
import { useQueryClient } from "@tanstack/react-query";
import { notesQueryKey, useNotes } from "@/hooks/useNotes"; // Import useNotes
import { getNoteGroup } from "@/helpers/dateGrouping"; // Import helper

interface NoteListProps {
  notes: NoteListEntry[];
  selectedNoteId: string | null;
  onSelectNote: (docId: string) => void;
  onCreateNote: () => void;
  onDeleteNote: (docId: string) => void;
  onShareNote: (note: NoteListEntry) => void;
  isLoading?: boolean;
  className?: string;
}


export default function NoteList({
  notes,
  selectedNoteId,
  onSelectNote,
  onCreateNote,
  onDeleteNote,
  onShareNote,
  isLoading = false,
  className = '',
}: NoteListProps) {
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const { sync } = useSyncService();
  const queryClient = useQueryClient();
  const { togglePin } = useNotes();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const handleRefresh = async () => {
    await sync();
    await queryClient.invalidateQueries({ queryKey: notesQueryKey });
  };

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => {
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

  // Grouping Logic
  const groupedNotes = useMemo(() => {
    const groups: { label: string; notes: NoteListEntry[] }[] = [];
    
    // 1. Pinned Notes
    const pinnedNotes = notes.filter(n => n.metadata.isPinned);
    if (pinnedNotes.length > 0) {
        // Sort pinned notes by modified date (newest first)
        pinnedNotes.sort((a, b) => 
            new Date(b.metadata.timestamps.modified).getTime() - new Date(a.metadata.timestamps.modified).getTime()
        );
        groups.push({ label: 'Pinned', notes: pinnedNotes });
    }

    // 2. Unpinned Notes
    const unpinnedNotes = notes.filter(n => !n.metadata.isPinned);
    
    // Sort unpinned by date first
    unpinnedNotes.sort((a, b) => 
        new Date(b.metadata.timestamps.modified).getTime() - new Date(a.metadata.timestamps.modified).getTime()
    );

    // Bucket them
    const dateGroups: Record<string, NoteListEntry[]> = {};
    const groupOrder: string[] = []; // To preserve order of appearance

    unpinnedNotes.forEach(note => {
        const groupLabel = getNoteGroup(note.metadata.timestamps.modified);
        if (!dateGroups[groupLabel]) {
            dateGroups[groupLabel] = [];
            groupOrder.push(groupLabel);
        }
        dateGroups[groupLabel].push(note);
    });

    groupOrder.forEach(label => {
        groups.push({ label, notes: dateGroups[label] });
    });

    return groups;
  }, [notes]);

  const flatRows = useMemo(() => {
    const rows: Array<
      | { type: 'header'; label: string; count: number; collapsed: boolean }
      | { type: 'note'; note: NoteListEntry }
    > = [];

    for (const group of groupedNotes) {
      const collapsed = collapsedGroups.has(group.label);
      rows.push({ type: 'header', label: group.label, count: group.notes.length, collapsed });
      if (!collapsed) {
        for (const note of group.notes) {
          rows.push({ type: 'note', note });
        }
      }
    }
    return rows;
  }, [groupedNotes, collapsedGroups]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => flatRows[index].type === 'header' ? 32 : 74,
    overscan: 10,
    paddingStart: 8,
    paddingEnd: 8,
  });

  return (
    <div
      className={cn(
        'flex flex-col h-full w-full max-w-full bg-background border-r border-border overflow-hidden', 
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-3 border-b border-border shrink-0">
        <span className="text-sm font-medium text-foreground">Notes</span>
        <Button size="sm" onClick={onCreateNote} className="h-7 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" />
          New
        </Button>
      </div>

      {/* Notes list */}
      <div ref={scrollRef} className="flex-1 min-h-0 w-full overflow-y-auto">
        <PullToRefresh onRefresh={handleRefresh} className="w-full">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 px-4 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-2">No notes yet</p>
            <Button variant="link" size="sm" onClick={onCreateNote}>
              Create your first note
            </Button>
          </div>
        ) : (
          <div
            className="w-full relative"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row.type === 'header' ? (
                    <button
                      onClick={() => toggleGroup(row.label)}
                      className="flex items-center w-full px-3 py-1 hover:bg-muted/50 transition-colors group/header"
                    >
                      {row.collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                      )}
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {row.label}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground/50 opacity-0 group-hover/header:opacity-100 transition-opacity">
                        {row.count}
                      </span>
                    </button>
                  ) : (
                    <div className="pb-0.5">
                      <NoteItem
                        note={row.note}
                        selectedNoteId={selectedNoteId}
                        onSelectNote={onSelectNote}
                        onDeleteNote={handleDeleteNote}
                        onShareNote={() => onShareNote(row.note)}
                        onTogglePin={(id, isPinned) => togglePin.mutate({ docId: id, isPinned })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </PullToRefresh>
      </div>

      <ConfirmDialog
        isOpen={!!noteToDelete}
        onClose={() => setNoteToDelete(null)}
        onConfirm={() => {
          if (noteToDelete) {
            onDeleteNote(noteToDelete);
          }
        }}
        title="Delete Note?"
        description="Are you sure you want to delete this note? This action cannot be undone."
        confirmText="Delete"
      />
    </div>
  );
}

// Extracted NoteItem for cleaner swipe logic with enhanced touch implementation
const NoteItem = memo(function NoteItem({
  note,
  selectedNoteId,
  onSelectNote,
  onDeleteNote,
  onShareNote,
  onTogglePin,
}: {
  note: NoteListEntry;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onShareNote: () => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
}) {
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [isSwiped, setIsSwiped] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);

  const minSwipeDistance = 50;
  const maxSwipeDistance = 80;

  // Haptic feedback helper
  const triggerHaptic = (duration = 10) => {
    if ('vibrate' in navigator) {
      navigator.vibrate(duration);
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
    setSwipeOffset(0);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const currentX = e.targetTouches[0].clientX;
    setTouchEnd(currentX);
    
    if (touchStart !== null) {
      const diff = touchStart - currentX;
      // Only allow left swipe with elastic resistance
      if (diff > 0) {
        // Apply elastic resistance after maxSwipeDistance
        const offset = diff > maxSwipeDistance 
          ? maxSwipeDistance + (diff - maxSwipeDistance) * 0.2 
          : diff;
        setSwipeOffset(Math.min(offset, 100));
      } else if (isSwiped) {
        // Allow right swipe to reset
        setSwipeOffset(Math.max(maxSwipeDistance + diff, 0));
      }
    }
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) {
      // Reset if no valid touch
      if (!isSwiped) setSwipeOffset(0);
      return;
    }
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && !isSwiped) {
      setIsSwiped(true);
      setSwipeOffset(maxSwipeDistance);
      triggerHaptic(15);
    } else if (isRightSwipe && isSwiped) {
      setIsSwiped(false);
      setSwipeOffset(0);
      triggerHaptic(10);
    } else {
      // Snap back or maintain position
      setSwipeOffset(isSwiped ? maxSwipeDistance : 0);
    }
    
    setTouchStart(null);
    setTouchEnd(null);
  };

  // Auto-reset when clicking elsewhere (global handler)
  const handleGlobalClick = (e: React.MouseEvent) => {
    if (isSwiped) {
      e.stopPropagation();
      setIsSwiped(false);
      setSwipeOffset(0);
    }
  };

  return (
    <div 
      className="relative overflow-hidden w-full select-none"
      onClick={isSwiped ? handleGlobalClick : undefined}
    >
      <ContextMenuWrapper
        items={[
             { 
                 label: note.metadata.isPinned ? 'Unpin' : 'Pin',
                 icon: note.metadata.isPinned ? PinOff : Pin,
                 action: () => onTogglePin(note.docId, !note.metadata.isPinned),
             },
             { 
                 label: 'Share', 
                 icon: Share2, 
                 action: onShareNote,
             },
             { 
                 label: 'Mark collaborative', 
                 icon: Users, 
                 action: () => {},
                 disabled: true,
             },
             { 
                 label: 'Delete', 
                 icon: Trash2, 
                 action: () => onDeleteNote(note.docId), 
                 variant: 'destructive',
                 shortcut: '⌫' 
             }
        ]}
      >
      <div className="relative w-full h-full"> 
      {/* Background Action (Delete) with glow effect */}
      <div 
        className={cn(
          "absolute inset-y-0 right-0 w-20 bg-destructive flex items-center justify-center text-destructive-foreground",
          "transition-all duration-300 ease-out",
          isSwiped && "shadow-[-4px_0_16px_rgba(239,68,68,0.3)]"
        )}
        style={{
          transform: `translateX(${100 - (swipeOffset / maxSwipeDistance) * 100}%)`,
          opacity: Math.min(swipeOffset / minSwipeDistance, 1),
        }}
      >
        <button 
          className="w-full h-full flex items-center justify-center active:scale-110 transition-transform"
          onClick={(e) => {
            e.stopPropagation();
            triggerHaptic(20);
            onDeleteNote(note.docId);
          }}
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      {/* Note Content */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!isSwiped) {
            onSelectNote(note.docId);
          }
        }}
        onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectNote(note.docId);
            }
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={cn(
          'relative grid grid-cols-1 w-full px-4 py-3.5 text-left bg-background group cursor-pointer outline-none focus:bg-accent select-none',
          'hover:bg-accent',
          'transition-[transform,background-color] duration-200 ease-out',
          selectedNoteId === note.docId && 'bg-accent',
        )}
        style={{
          transform: `translateX(-${swipeOffset}px)`,
        }}
      >
        <div className="flex items-start justify-between gap-2 w-full overflow-hidden">
          <span
            className={cn(
              'text-sm font-medium truncate flex-1',
              selectedNoteId === note.docId
                ? 'text-accent-foreground'
                : 'text-foreground'
            )}
          >
            {note.title || 'Untitled'}
          </span>
          {note.metadata.isPinned && (
              <Pin className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5 w-full">
          {note.preview || 'No content'}
        </p>
        <span className="text-xs text-muted-foreground/70 mt-1">
          {formatRelativeTime(note.metadata.timestamps.modified)}
        </span>
      </div>
      </div>
      </ContextMenuWrapper>
    </div>
  );
});
