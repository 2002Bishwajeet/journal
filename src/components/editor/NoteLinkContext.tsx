import { createContext, useContext } from "react";

export interface NoteLinkResolution {
  title: string;
  folderId: string;
}

export interface NoteLinkContextValue {
  /** Resolve a target note's current title/folder, or undefined if not an active note. */
  resolve: (noteId: string) => NoteLinkResolution | undefined;
  /** True once the title map's first emission has arrived (distinguishes loading from missing). */
  isReady: boolean;
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
