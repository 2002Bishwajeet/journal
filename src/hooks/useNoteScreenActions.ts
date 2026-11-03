import { useOutletContext } from "react-router-dom";
import type { NoteListEntry } from "@/types";

/** What the layout, which owns the dialogs and the navigation, gives the note screen on touch layouts (#825). */
export interface NoteScreenActions {
  /** Where Back goes: the folder, "#tag" or view the note was opened from. */
  backLabel: string;
  onShare: (note: NoteListEntry) => void;
  onMoveToFolder: (note: NoteListEntry) => void;
  onArchive: (note: NoteListEntry) => void;
  onTrash: (docId: string) => void;
  onRemoveFromList: (note: NoteListEntry) => void;
}

/** The layout's actions, or undefined where the editor does not render in the layout's outlet (desktop tabs). */
export function useNoteScreenActions() {
  return useOutletContext<NoteScreenActions | undefined>();
}
