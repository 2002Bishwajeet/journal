import { createContext, useContext } from 'react';
import type { Editor } from '@tiptap/react';
import type { NoteCover } from '@/lib/editor/cover';

export interface EditorContextValue {
  editor: Editor | null;
  isReady: boolean;
  isLoading: boolean;
  isAIReady: boolean;
  cover: NoteCover | null;
  /** Set the cover from an image file; queues the upload like an in-note image. */
  setCoverFromFile: (file: File) => Promise<void>;
  removeCover: () => Promise<void>;
  /** Vertical focal point, clamped to 0–100. */
  setCoverPosition: (y: number) => void;
  /** The saved state of the note's html and react blocks (#410), as JSON text per block id. */
  blockState: {
    get: (id: string) => string | undefined;
    set: (id: string, json: string) => void;
  };
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext() {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditorContext must be used within an EditorProvider');
  }
  return context;
}
