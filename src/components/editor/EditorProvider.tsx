import { useEffect, useState, useRef, useMemo, useCallback, type ReactNode } from "react";
import { useEditor, type Editor } from "@tiptap/react";
import * as Y from "yjs";
import { useQueryClient } from "@tanstack/react-query";
import { PGliteProvider } from "@/lib/yjs";
import { upsertSearchIndex, savePendingImageUpload } from "@/lib/db";
import { notesQueryKey } from "@/hooks/useNotes";
import type { DocumentMetadata } from "@/types";
import { EditorContext } from "./EditorContext";
import { useSyncService } from "@/hooks/useSyncService";
import {
  createBaseExtensions,
  createCollaborationExtension,
  CustomShortcuts,
  AutocompletePlugin,
  FileHandler,
  SlashCommandsExtension,
} from "./plugins";

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
  // onCheckGrammar, // Currently disabled - GrammarPlugin is commented out
  children,
}: EditorProviderProps) {
  const [yDoc] = useState(() => new Y.Doc());
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();
  
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

  // Get sync service to trigger upload after queuing
  const { sync } = useSyncService();

  // Handle image drop/paste - queue for upload and trigger sync
  const handleImageDrop = useCallback(async (file: File, pendingId: string) => {
    const arrayBuffer = await file.arrayBuffer();
    const blobData = new Uint8Array(arrayBuffer);

    await savePendingImageUpload({
      id: pendingId,
      noteDocId: docId,
      blobData,
      contentType: file.type,
      status: 'pending',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    });

    console.log(`[EditorProvider] Queued image ${pendingId} for upload, triggering sync...`);
    
    // Trigger sync to upload the image immediately
    sync().catch(err => console.error('[EditorProvider] Sync after image drop failed:', err));
  }, [docId, sync]);

  // Memoize extensions to avoid recreation on every render
  const extensions = useMemo(
    () => [
      ...createBaseExtensions(),
      createCollaborationExtension(yXmlFragment),
      CustomShortcuts.configure({
        // Custom shortcuts can trigger actions here if needed
      }),
      // File handler for image drag/drop/paste
      FileHandler.configure({
        maxSizeMB: 5,
        allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        onImageDrop: handleImageDrop,
      }),
      // AI-powered plugins (conditionally active)
      // eslint-disable-next-line react-hooks/refs -- getIsAIReady is a getter called only within plugin execution, not during render
      AutocompletePlugin.configure({
        getSuggestion: onGetAutocompleteSuggestion || (async () => ''),
        getIsAIReady: () => isAIReadyRef.current, // Use getter function to defer ref read
        debounceMs: 500,
        minCharsBeforeTrigger: 5,
        debug: false,
      }),
      // Slash commands (triggered by typing /)
      SlashCommandsExtension,
      // GrammarPlugin.configure({
      //   checkGrammar: onCheckGrammar || (async () => []),
      //   getIsAIReady: () => isAIReadyRef.current,
      //   debounceMs: 2000,
      //   minCharsToCheck: 5,
      //   debug: true,
      // }),
    ],
    [yXmlFragment, onGetAutocompleteSuggestion, handleImageDrop]
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

  // Debounced query invalidation for NoteList updates (separate, longer debounce)
  const invalidateNotesRef = useRef(
    debounce(() => {
      queryClient.invalidateQueries({ queryKey: notesQueryKey });
    }, 1000) // Slightly longer than search index update to batch
  );

  // Handle editor content changes
  useEffect(() => {
    if (!editor || !providerRef.current) return;

    const handleUpdate = () => {
      // Note: We use metadata.title here. If title changes happen outside, 
      // they should propagate via metadata prop. 
      // If we implement local title state in context, we would use that.
      updateSearchIndexRef.current(editor, metadata.title, metadata);
      
      // Invalidate React Query cache so NoteList updates
      invalidateNotesRef.current();

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
