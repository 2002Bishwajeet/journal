import { createContext, useContext } from 'react';
import type { Editor } from '@tiptap/react';

export interface EditorContextValue {
  editor: Editor | null;
  isReady: boolean;
  isLoading: boolean;
  isAIReady: boolean;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext() {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditorContext must be used within an EditorProvider');
  }
  return context;
}
