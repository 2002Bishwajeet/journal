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
import { useImageDeletionTracker } from "./hooks/useImageDeletionTracker";
import { useDocumentSubscription } from "@/hooks/useDocumentSubscription"; // Import the hook
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

  // Track image deletions with cancellable timeouts and sync trigger
  useImageDeletionTracker({ docId, yXmlFragment });

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

  // Handle document updates from broadcast (sync service)
  const handleDocumentUpdate = useCallback(async () => {
    console.log('[EditorProvider] Document updated remotely, reloading...');
    if (providerRef.current) {
      try {
        await providerRef.current.load();
      } catch (err) {
        console.error('[EditorProvider] Failed to reload document:', err);
      }
    }
  }, []);

  useDocumentSubscription(docId, handleDocumentUpdate);

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

  // Refs for current values - avoids stale closures in debounced functions
  const docIdRef = useRef(docId);
  const metadataRef = useRef(metadata);
  const onSaveRef = useRef(onSave);
  
  // Keep refs in sync with props
  useEffect(() => {
    docIdRef.current = docId;
    metadataRef.current = metadata;
    onSaveRef.current = onSave;
  }, [docId, metadata, onSave]);

  // Timeout refs for cleanup
  const searchIndexTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search index update - reads current values from refs
  const updateSearchIndex = useCallback((editorInstance: Editor) => {
    if (searchIndexTimeoutRef.current) {
      clearTimeout(searchIndexTimeoutRef.current);
    }
    
    searchIndexTimeoutRef.current = setTimeout(() => {
      const currentDocId = docIdRef.current;
      const currentMetadata = metadataRef.current;
      const plainText = editorInstance.getText();
      
      upsertSearchIndex({
        docId: currentDocId,
        title: currentMetadata.title,
        plainTextContent: plainText,
        metadata: {
          ...currentMetadata,
          title: currentMetadata.title,
          timestamps: {
            ...currentMetadata.timestamps,
            modified: new Date().toISOString(),
          },
        },
      });
    }, 500);
  }, []);

  // Debounced save - reads current values from refs
  const debouncedSave = useCallback((provider: PGliteProvider) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      const saveFn = onSaveRef.current;
      if (saveFn) {
        const fullState = provider.getFullState();
        saveFn(fullState);
      }
    }, 2000);
  }, []);

  // Debounced query invalidation for NoteList updates
  const invalidateNotes = useCallback(() => {
    if (invalidateTimeoutRef.current) {
      clearTimeout(invalidateTimeoutRef.current);
    }
    
    invalidateTimeoutRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: notesQueryKey });
    }, 1000);
  }, [queryClient]);

  // Clean up all timeouts on unmount
  useEffect(() => {
    return () => {
      if (searchIndexTimeoutRef.current) clearTimeout(searchIndexTimeoutRef.current);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (invalidateTimeoutRef.current) clearTimeout(invalidateTimeoutRef.current);
    };
  }, []);

  // Track the last known content to detect actual changes
  const lastContentRef = useRef<string | null>(null);

  // Handle editor content changes - only update when content actually changes
  useEffect(() => {
    if (!editor || !providerRef.current) return;

    const handleUpdate = () => {
      const currentContent = editor.getText();
      
      // Skip if content hasn't actually changed (e.g., Yjs sync on load)
      if (lastContentRef.current === currentContent) {
        return;
      }
      
      // First time we see content (initial load) - just store it, don't trigger update
      if (lastContentRef.current === null) {
        lastContentRef.current = currentContent;
        return;
      }
      
      // Content has genuinely changed - update everything
      lastContentRef.current = currentContent;

      updateSearchIndex(editor);
      invalidateNotes();

      if (providerRef.current) {
        debouncedSave(providerRef.current);
      }
    };

    editor.on("update", handleUpdate);
    return () => {
      lastContentRef.current = null;
      editor.off("update", handleUpdate);
    };
  }, [editor, updateSearchIndex, invalidateNotes, debouncedSave]);


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

