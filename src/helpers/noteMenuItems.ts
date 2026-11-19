import {
  Archive,
  Download,
  ExternalLink,
  FileText,
  FolderInput,
  ListX,
  Lock,
  LockOpen,
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
  /** Shows the note, for an action that needs it on screen (Export to PDF from a list row). */
  onOpen?: (docId: string) => void;
  /** Lock note / Remove lock (#1427). Given only where the owner can be confirmed. */
  onToggleLock?: (note: NoteListEntry) => void;
}

/**
 * The items of a note's menu, shared by the note list rows (context menu and options button)
 * and the note screen's More sheet so the two cannot drift. A note from someone else has no
 * Share or Move, and "Remove from my list" in their place. `extra` items (the note screen's
 * Find, Contents and Version history) go after Move to folder. Without `canEdit` (the native
 * trial ended, #1176) only reading and export are left: the extras, both exports and Owner Console.
 * A locked note (#1427) has no Share and no exports.
 */
export function buildNoteMenuItems(
  note: NoteListEntry,
  {
    isPeerNote,
    dotYouRoot,
    handlers,
    extra = [],
    canEdit = true,
  }: {
    isPeerNote: boolean;
    dotYouRoot: string;
    handlers: NoteMenuHandlers;
    extra?: ContextMenuItemConfig[];
    canEdit?: boolean;
  },
): ContextMenuItemConfig[] {
  const { onTogglePin, onShare, onMoveToFolder, onRemoveFromList, onArchive, onTrash, onOpen, onToggleLock } = handlers;
  const locked = note.locked === true;
  const exports: ContextMenuItemConfig[] = locked
    ? []
    : [
        {
          label: "Export to Markdown",
          icon: Download,
          action: () =>
            void import("@/lib/importexport/exportNoteMarkdown").then((m) =>
              m.exportNoteAsMarkdown(note.docId, note.title || "Untitled"),
            ),
        },
        // The print dialog saves the note as it is drawn, so it has to be open (#520)
        {
          label: "Export to PDF",
          icon: FileText,
          action: () =>
            void import("@/lib/importexport/printNote").then((m) =>
              m.printNote(note.docId, note.title, onOpen),
            ),
        },
      ];
  const items: (ContextMenuItemConfig & { write?: true })[] = [
    {
      label: note.metadata.isPinned ? "Unpin" : "Pin",
      icon: note.metadata.isPinned ? PinOff : Pin,
      action: () => onTogglePin(note.docId, !note.metadata.isPinned),
      write: true,
    },
    // One item for sharing with people and the public link (#682). Notes from other
    // people aren't ours to share or to file: they have neither.
    ...(isPeerNote || locked ? [] : [{ label: "Share…", icon: Share2, action: () => onShare(note), write: true as const }]),
    ...(isPeerNote || !onMoveToFolder
      ? []
      : [
          {
            label: "Move to folder…",
            icon: FolderInput,
            action: () => onMoveToFolder(note),
            write: true as const,
          },
        ]),
    ...(isPeerNote || !onToggleLock
      ? []
      : [
          {
            label: note.metadata.locked ? "Remove lock" : "Lock note",
            icon: note.metadata.locked ? LockOpen : Lock,
            action: () => onToggleLock(note),
            write: true as const,
          },
        ]),
    ...extra,
    ...exports,
    {
      label: "Open in Owner Console",
      icon: ExternalLink,
      action: () =>
        window.open(ownerConsoleNoteUrl(dotYouRoot, note.docId), "_blank", "noopener,noreferrer"),
    },
    // A note shared with you leaves this device only; the owner's share is unchanged
    ...(isPeerNote && onRemoveFromList
      ? [{ label: "Remove from my list", icon: ListX, action: () => onRemoveFromList(note), write: true as const }]
      : []),
    {
      label: "Archive",
      icon: Archive,
      action: () => onArchive?.(note),
      disabled: !onArchive,
      separate: true,
      write: true,
    },
    {
      label: "Move to Trash",
      icon: Trash2,
      action: () => onTrash(note.docId),
      variant: "destructive",
      shortcut: "⌫",
      write: true,
    },
  ];
  return items.filter((item) => canEdit || !item.write).map(({ write, ...item }) => item);
}
