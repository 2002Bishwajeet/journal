import { useState, useMemo } from 'react';
import { Plus, FileText, Trash2, Share2, Users, Pin, PinOff, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/modals';
import { ContextMenuWrapper } from '@/components/ui/context-menu-wrapper';
import { cn } from '@/lib/utils';
import type { SearchIndexEntry } from '@/types';
import { formatRelativeTime } from '@/lib/utils/index';
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { useSyncService } from "@/hooks/useSyncService";
import { useQueryClient } from "@tanstack/react-query";
import { notesQueryKey, useNotes } from "@/hooks/useNotes"; // Import useNotes
import { getNoteGroup } from "@/helpers/dateGrouping"; // Import helper

interface NoteListProps {
  notes: SearchIndexEntry[];
  selectedNoteId: string | null;
  onSelectNote: (docId: string) => void;
  onCreateNote: () => void;
  onDeleteNote: (docId: string) => void;
  onShareNote: (note: SearchIndexEntry) => void;
  onMarkCollaborative?: (note: SearchIndexEntry) => void;
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
  onMarkCollaborative,
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

  // Grouping Logic
  const groupedNotes = useMemo(() => {
    const groups: { label: string; notes: SearchIndexEntry[] }[] = [];
    
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
    const dateGroups: Record<string, SearchIndexEntry[]> = {};
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
      <ScrollArea className="flex-1 min-h-0 w-full">
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
          <div className="py-2 w-full space-y-4">
            {groupedNotes.map((group) => (
                <div key={group.label} className="w-full">
                    <button 
                        onClick={() => toggleGroup(group.label)}
                        className="flex items-center w-full px-3 py-1 hover:bg-muted/50 transition-colors group/header"
                    >
                        {collapsedGroups.has(group.label) ? 
                            <ChevronRight className="h-3.5 w-3.5 mr-2 text-muted-foreground" /> : 
                            <ChevronDown className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                        }
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            {group.label}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground/50 opacity-0 group-hover/header:opacity-100 transition-opacity">
                            {group.notes.length}
                        </span>
                    </button>
                    
                    {!collapsedGroups.has(group.label) && (
                        <div className="space-y-0.5 mt-1">
                            {group.notes.map((note) => (
                            <NoteItem 
                                    key={note.docId} 
                                    note={note} 
                                    selectedNoteId={selectedNoteId} 
                                    onSelectNote={onSelectNote} 
                                    onDeleteNote={(id) => setNoteToDelete(id)}
                                    onShareNote={() => onShareNote(note)}
                                    onTogglePin={(id, isPinned) => togglePin.mutate({ docId: id, isPinned })}
                                    onMarkCollaborative={() => onMarkCollaborative?.(note)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            ))}
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
        title="Delete Note?"
        description="Are you sure you want to delete this note? This action cannot be undone."
        confirmText="Delete"
      />
    </div>
  );
}

// Extracted NoteItem for cleaner swipe logic with enhanced touch implementation
function NoteItem({ 
  note, 
  selectedNoteId, 
  onSelectNote, 
  onDeleteNote,
  onShareNote,
  onTogglePin,
  onMarkCollaborative,
}: { 
  note: SearchIndexEntry; 
  selectedNoteId: string | null; 
  onSelectNote: (id: string) => void; 
  onDeleteNote: (id: string) => void;
  onShareNote: () => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
  onMarkCollaborative?: () => void;
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
                 label: note.metadata.isCollaborative ? 'Revoke collaboration' : 'Mark collaborative', 
                 icon: Users, 
                 action: () => onMarkCollaborative?.(),
                 disabled: !onMarkCollaborative,
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
          {note.metadata.isCollaborative && (
              <Users className="h-3 w-3 text-blue-500/70 shrink-0" />
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5 w-full">
          {note.plainTextContent || 'No content'}
        </p>
        <span className="text-xs text-muted-foreground/70 mt-1">
          {formatRelativeTime(note.metadata.timestamps.modified)}
        </span>
      </div>
      </div>
      </ContextMenuWrapper>
    </div>
  );
}
