import { useEffect, useState, useRef, useMemo, type ReactNode } from "react";
import { useEditor, type Editor } from "@tiptap/react";
import * as Y from "yjs";
import { PGliteProvider } from "@/lib/yjs";
import { upsertSearchIndex } from "@/lib/db";
import type { DocumentMetadata } from "@/types";
import { EditorContext } from "./EditorContext";

// Import modular plugins
import {
  createBaseExtensions,
  createCollaborationExtension,
  CustomShortcuts,
  AutocompletePlugin,
} from "./plugins";

// Import KaTeX styles for math rendering
import "katex/dist/katex.min.css";

interface EditorProviderProps {
  docId: string;
  metadata: DocumentMetadata;
  onMetadataChange?: (metadata: DocumentMetadata) => void;
  onSave?: (yjsBlob: Uint8Array) => void;
  onEditorReady?: (editor: Editor) => void;
  // AI integration
  isAIReady?: boolean;
  onGetAutocompleteSuggestion?: (text: string) => Promise<string>;
  onCheckGrammar?: (text: string) => Promise<string[]>;
  children: ReactNode;
}

// Simple debounce function
function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function EditorProvider({
  docId,
  metadata,
  // onMetadataChange, // Not used in provider currently
  onSave,
  onEditorReady,
  isAIReady = false,
  onGetAutocompleteSuggestion,
  onCheckGrammar,
  children,
}: EditorProviderProps) {
  const [yDoc] = useState(() => new Y.Doc());
  const [isLoading, setIsLoading] = useState(true);
  
  // Use refs for cleanup to avoid stale closure issues
  const providerRef = useRef<PGliteProvider | null>(null);
  const editorRef = useRef<Editor | null>(null);

  // Store AI ready state in ref for plugin access
  const isAIReadyRef = useRef(isAIReady);
  useEffect(() => {
    isAIReadyRef.current = isAIReady;
  }, [isAIReady]);

  // Get Yjs fragment for ProseMirror - memoized to avoid recreating on every render
  const yXmlFragment = useMemo(
    () => yDoc.getXmlFragment("prosemirror"),
    [yDoc]
  );

  // Initialize PGlite provider with proper cleanup
  useEffect(() => {
    let mounted = true;

    const initProvider = async () => {
      const pgProvider = new PGliteProvider(docId, yDoc);
      providerRef.current = pgProvider;

      try {
        await pgProvider.load();
        if (mounted) {
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Failed to load document:", error);
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initProvider();

    return () => {
      mounted = false;
      providerRef.current?.destroy();
      providerRef.current = null;
    };
  }, [docId, yDoc]);

  // Cleanup Y.Doc on unmount to free memory
  useEffect(() => {
    return () => {
      yDoc.destroy();
    };
  }, [yDoc]);

  // Memoize extensions to avoid recreation on every render
  const extensions = useMemo(
    () => [
      ...createBaseExtensions(),
      createCollaborationExtension(yXmlFragment),
      CustomShortcuts.configure({
        // Custom shortcuts can trigger actions here if needed
      }),
      // AI-powered plugins (conditionally active)
      AutocompletePlugin.configure({
        getSuggestion: onGetAutocompleteSuggestion || (async () => ''),
        isAIReadyRef, // Pass ref directly to avoid React warning about accessing refs during render
        debounceMs: 500,
        minCharsBeforeTrigger: 5,
        debug: true,
      }),
      // GrammarPlugin.configure({
      //   checkGrammar: onCheckGrammar || (async () => []),
      //   isAIReadyRef, // Pass ref directly to avoid React warning about accessing refs during render
      //   debounceMs: 2000,
      //   minCharsToCheck: 5,
      //   debug: true,
      // }),
    ],
    [yXmlFragment, onGetAutocompleteSuggestion, onCheckGrammar]
  );

  // Create TipTap editor with performance optimizations
  const editor = useEditor(
    {
      extensions,
      editorProps: {
        attributes: {
          class:
            "prose prose-slate dark:prose-invert max-w-none focus:outline-none min-h-[calc(100vh-200px)] px-4 py-4 md:px-8",
        },
      },
      // Performance optimization: render immediately
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      onCreate: ({ editor: ed }) => {
        editorRef.current = ed;
        // Don't focus automatically on load, let user interact
        // ed.commands.focus("end"); 
        
        if (onEditorReady) {
          // Defer state update to avoid "update during render" error
          setTimeout(() => {
            onEditorReady(ed);
          }, 0);
        }
      },
      onDestroy: () => {
        editorRef.current = null;
      },
    },
    [extensions]
  );

  // Debounced search index update (stable ref to avoid recreation)
  const updateSearchIndexRef = useRef(
    debounce(
      (
        editorInstance: Editor,
        currentTitle: string,
        meta: DocumentMetadata
      ) => {
        const plainText = editorInstance.getText();
        upsertSearchIndex({
          docId,
          title: currentTitle,
          plainTextContent: plainText,
          metadata: {
            ...meta,
            title: currentTitle,
            timestamps: {
              ...meta.timestamps,
              modified: new Date().toISOString(),
            },
          },
        });
      },
      500
    )
  );

  // Debounced save to avoid calling getFullState() on every keystroke
  const debouncedSaveRef = useRef(
    debounce((provider: PGliteProvider, saveFn: (blob: Uint8Array) => void) => {
      const fullState = provider.getFullState();
      saveFn(fullState);
    }, 2000)
  );

  // Handle editor content changes
  useEffect(() => {
    if (!editor || !providerRef.current) return;

    const handleUpdate = () => {
      // Note: We use metadata.title here. If title changes happen outside, 
      // they should propagate via metadata prop. 
      // If we implement local title state in context, we would use that.
      updateSearchIndexRef.current(editor, metadata.title, metadata);

      if (onSave && providerRef.current) {
        debouncedSaveRef.current(providerRef.current, onSave);
      }
    };

    editor.on("update", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
    };
  }, [editor, metadata, onSave]);

  const value = {
    editor,
    isReady: !isLoading && !!editor,
    isLoading,
    isAIReady,
  };

  return (
    <EditorContext.Provider value={value}>
        {children}
    </EditorContext.Provider>
  );
}
