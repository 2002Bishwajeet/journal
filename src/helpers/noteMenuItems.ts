import {
  Archive,
  Download,
  ExternalLink,
  FolderInput,
  ListX,
  Pin,
  PinOff,
  Share2,
  Trash2,
} from "lucide-react";
import type { ContextMenuItemConfig } from "@/components/ui/context-menu-wrapper";
import { ownerConsoleNoteUrl } from "@/lib/homebase/config";
import type { NoteListEntry } from "@/types";

export interface NoteMenuHandlers {
  onTogglePin: (docId: string, isPinned: boolean) => void;
  onShare: (note: NoteListEntry) => void;
  onMoveToFolder?: (note: NoteListEntry) => void;
  onRemoveFromList?: (note: NoteListEntry) => void;
  onArchive?: (note: NoteListEntry) => void;
  onTrash: (docId: string) => void;
}

/**
 * The items of a note's menu, shared by the note list rows (context menu and options button)
 * and the note screen's More sheet so the two cannot drift. A note from someone else has no
 * Share or Move, and "Remove from my list" in their place. `extra` items (the note screen's
 * Find, Contents and Version history) go after Move to folder.
 */
export function buildNoteMenuItems(
  note: NoteListEntry,
  {
    isPeerNote,
    dotYouRoot,
    handlers,
    extra = [],
  }: {
    isPeerNote: boolean;
    dotYouRoot: string;
    handlers: NoteMenuHandlers;
    extra?: ContextMenuItemConfig[];
  },
): ContextMenuItemConfig[] {
  const { onTogglePin, onShare, onMoveToFolder, onRemoveFromList, onArchive, onTrash } = handlers;
  return [
    {
      label: note.metadata.isPinned ? "Unpin" : "Pin",
      icon: note.metadata.isPinned ? PinOff : Pin,
      action: () => onTogglePin(note.docId, !note.metadata.isPinned),
    },
    // One item for sharing with people and the public link (#682). Notes from other
    // people aren't ours to share or to file: they have neither.
    ...(isPeerNote ? [] : [{ label: "Share…", icon: Share2, action: () => onShare(note) }]),
    ...(isPeerNote || !onMoveToFolder
      ? []
      : [
          {
            label: "Move to folder…",
            icon: FolderInput,
            action: () => onMoveToFolder(note),
          },
        ]),
    ...extra,
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
        window.open(ownerConsoleNoteUrl(dotYouRoot, note.docId), "_blank", "noopener,noreferrer"),
    },
    // A note shared with you leaves this device only; the owner's share is unchanged
    ...(isPeerNote && onRemoveFromList
      ? [{ label: "Remove from my list", icon: ListX, action: () => onRemoveFromList(note) }]
      : []),
    {
      label: "Archive",
      icon: Archive,
      action: () => onArchive?.(note),
      disabled: !onArchive,
      separate: true,
    },
    {
      label: "Move to Trash",
      icon: Trash2,
      action: () => onTrash(note.docId),
      variant: "destructive",
      shortcut: "⌫",
    },
  ];
}
