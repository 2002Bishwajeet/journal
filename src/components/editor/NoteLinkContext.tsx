import { createContext, useContext } from "react";

export interface NoteLinkResolution {
  title: string;
  folderId: string;
  status: number; // Homebase archivalStatus: 0 active, 1 archived, 2 trashed
}

export interface NoteLinkContextValue {
  /** Resolve a target note's current title/folder/status, or undefined if it doesn't exist locally. */
  resolve: (noteId: string) => NoteLinkResolution | undefined;
  /** Navigate to a linked note. */
  onNavigate: (noteId: string) => void;
}

/**
 * Supplies note-link node views with live title resolution + navigation. Lives
 * above the editor so every `noteLink` chip reflects the target's current title
 * (renames propagate) and can navigate on click.
 */
export const NoteLinkContext = createContext<NoteLinkContextValue | null>(null);

export function useNoteLinkContext(): NoteLinkContextValue | null {
  return useContext(NoteLinkContext);
}
