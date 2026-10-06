import {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { useAISettings } from "@/hooks/useAISettings";
import { useNavigate } from "react-router-dom";
import { useEditor, type Editor } from "@tiptap/react";
import * as Y from "yjs";
import { ySyncPluginKey } from "y-prosemirror";
import { PGliteProvider } from "@/lib/yjs";
import { flushPendingSaveOnTeardown } from "@/lib/yjs/flushPendingSave";
import { upsertSearchIndex, savePendingImageUpload, savePendingImageDeletion, updateSyncStatus } from "@/lib/db";
import { getNewId } from "@/lib/utils";
import { prepareImageForUpload, UnsupportedImageError } from "@/lib/images/imageIngest";
import { formatGuidId } from "@homebase-id/js-lib/helpers";
import {
  COVER_MAP,
  getCover,
  setCover,
  clearCover,
  setCoverPosition as setCoverPositionInDoc,
  coverPayloadKey,
  type NoteCover,
} from "@/lib/editor/cover";
import { getBlockState, setBlockState } from "@/lib/liveBlockState";
import { isAgentEditor } from "@/lib/agent/attribution";
import type { DocumentMetadata } from "@/types";
import { EditorContext } from "./EditorContext";
import { NoteLinkContext, type NoteLinkContextValue } from "./NoteLinkContext";
import { ImageOwnerContext } from "./nodes/imageOwnerContext";
import { useSyncService } from "@/hooks/useSyncService";
import { useNoteTitleMap } from "@/hooks/useNoteTitleMap";
import { createNoteWithContentInDb } from "@/lib/notes/createNote";
import { extractNoteLinkIds } from "@/lib/editor/extractNoteLinkIds";
import { useImageDeletionTracker } from "./hooks/useImageDeletionTracker";
import { useDocumentSubscription } from "@/hooks/useDocumentSubscription"; // Import the hook
import { createEditorExtensions } from "./editorExtensions";
import { NoteLinkExtension } from "./plugins/NoteLink";
import {
  createCollaborationExtension,
  CustomShortcuts,
  AutocompletePlugin,
  GrammarPlugin,
  FileHandler,
  SlashCommandsExtension,
} from "./plugins";

import "katex/dist/katex.min.css";

// Shared by in-note images and the cover
const MAX_IMAGE_SIZE_MB = 5;

interface EditorProviderProps {
  docId: string;
  metadata: DocumentMetadata;
  editorOdinId?: string;
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
  editorOdinId,
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
  // Declared here (not next to debouncedSave) so the provider-init cleanup below
  // can flush a still-pending save on unmount.
  const onSaveRef = useRef(onSave);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store AI ready state in ref for plugin access
  const isAIReadyRef = useRef(isAIReady);
  useEffect(() => {
    isAIReadyRef.current = isAIReady;
  }, [isAIReady]);

  // Store grammar enabled state in ref to avoid editor recreation on toggle
  const { settings: aiSettings } = useAISettings();
  const isGrammarEnabledRef = useRef(aiSettings.grammarEnabled);
  useEffect(() => {
    isGrammarEnabledRef.current = aiSettings.grammarEnabled;
  }, [aiSettings.grammarEnabled]);

  // Route the AI callbacks through refs too. Their identities change whenever
  // isAIReady flips (WebLLM finishes loading) or autocomplete is toggled; if they
  // were extension-memo deps the editor would be recreated, which discards the
  // y-prosemirror UndoManager and silently breaks undo/redo. Reading the latest
  // callback at call time keeps the editor — and its undo history — stable.
  const onGetAutocompleteSuggestionRef = useRef(onGetAutocompleteSuggestion);
  const onCheckGrammarRef = useRef(onCheckGrammar);
  useEffect(() => {
    onGetAutocompleteSuggestionRef.current = onGetAutocompleteSuggestion;
    onCheckGrammarRef.current = onCheckGrammar;
  }, [onGetAutocompleteSuggestion, onCheckGrammar]);

  // Get Yjs fragment for ProseMirror - memoized to avoid recreating on every render
  const yXmlFragment = useMemo(
    () => yDoc.getXmlFragment("prosemirror"),
    [yDoc],
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
      const provider = providerRef.current;
      providerRef.current = null;
      if (!provider) return;
      // A note switch unmounts this (it's keyed by noteId). If a debounced save
      // is still pending, flush it so the last edits — already in PGlite — also
      // reach the server instead of being dropped with the timer.
      const hasPendingSave = saveTimeoutRef.current !== null;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      flushPendingSaveOnTeardown(provider, hasPendingSave, onSaveRef.current);
    };
  }, [docId, yDoc]);

  // Cleanup Y.Doc on unmount to free memory
  useEffect(() => {
    return () => {
      yDoc.destroy();
    };
  }, [yDoc]);

  // A note shared with you: its images live on the author's drive and can't be
  // uploaded to yet.
  const isPeerNote = !!metadata.authorOdinId && metadata.authorOdinId !== editorOdinId;

  // Track image deletions with cancellable timeouts and sync trigger
  useImageDeletionTracker({ docId, yXmlFragment });

  // Get sync service to trigger upload after queuing
  const { sync } = useSyncService();

  // Handle image drop/paste - queue for upload and trigger sync
  const handleImageDrop = useCallback(
    async (file: File, pendingId: string) => {
      const arrayBuffer = await file.arrayBuffer();
      const blobData = new Uint8Array(arrayBuffer);

      await savePendingImageUpload({
        id: pendingId,
        noteDocId: docId,
        blobData,
        contentType: file.type,
        status: "pending",
        retryCount: 0,
        createdAt: new Date().toISOString(),
      });

      console.log(
        `[EditorProvider] Queued image ${pendingId} for upload, triggering sync...`,
      );

      // Trigger sync to upload the image immediately
      sync().catch((err) =>
        console.error("[EditorProvider] Sync after image drop failed:", err),
      );
    },
    [docId, sync],
  );
  // Ref so the file handler can reach the latest callback without the editor
  // being recreated when its identity changes (see undo/redo note above).
  const handleImageDropRef = useRef(handleImageDrop);
  useEffect(() => {
    handleImageDropRef.current = handleImageDrop;
  }, [handleImageDrop]);

  // --- Cover image (stored in the Yjs doc's journalMeta map) ---
  const [cover, setCoverState] = useState<NoteCover | null>(() => getCover(yDoc));
  useEffect(() => {
    const map = yDoc.getMap(COVER_MAP);
    const onChange = () => setCoverState(getCover(yDoc));
    map.observe(onChange);
    return () => map.unobserve(onChange);
  }, [yDoc]);

  const queueOldCoverDeletion = async () => {
    const old = getCover(yDoc);
    const oldKey = old && coverPayloadKey(old.src);
    if (oldKey) await savePendingImageDeletion(docId, oldKey);
  };

  const setCoverFromFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      throw new Error(`Unsupported file type: ${file.type}`);
    }
    // Covers are served anonymously on public notes: strip EXIF (GPS) before anything is queued.
    let processed: File;
    try {
      processed = await prepareImageForUpload(file, { forceReencode: true });
    } catch (error) {
      if (error instanceof UnsupportedImageError) {
        throw new Error("This browser can't read HEIC images — export the photo as JPEG", { cause: error });
      }
      console.error("[EditorProvider] Failed to process cover image:", error);
      throw new Error("Failed to process image", { cause: error });
    }
    if (processed.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      throw new Error(`File too large. Maximum size is ${MAX_IMAGE_SIZE_MB}MB`);
    }
    const pendingId = formatGuidId(getNewId());
    await queueOldCoverDeletion();
    setCover(yDoc, { src: URL.createObjectURL(processed), pendingId, positionY: 50 });
    await handleImageDrop(processed, pendingId);
  };

  // Cover edits aren't editor transactions, so mark the note pending here
  // (as a body edit does) or the change never reaches the server.
  const removeCover = async () => {
    await queueOldCoverDeletion();
    clearCover(yDoc);
    void updateSyncStatus(docId, "pending");
  };

  const setCoverPosition = (y: number) => {
    setCoverPositionInDoc(yDoc, y);
    void updateSyncStatus(docId, "pending");
  };

  // --- Saved state of html and react blocks (#410), in the Yjs doc like the cover ---
  // Not an editor transaction either, so it marks the note pending itself.
  const blockState = {
    get: (id: string) => getBlockState(yDoc, id),
    set: (id: string, json: string) => {
      setBlockState(yDoc, id, json);
      void updateSyncStatus(docId, "pending");
    },
  };

  // Handle document updates from broadcast (sync service)
  const handleDocumentUpdate = useCallback(async () => {
    console.log("[EditorProvider] Document updated remotely, reloading...");
    if (providerRef.current) {
      try {
        await providerRef.current.load();
      } catch (err) {
        console.error("[EditorProvider] Failed to reload document:", err);
      }
    }
  }, []);

  useDocumentSubscription(docId, handleDocumentUpdate);

  // --- Internal note links (`[[`) ---
  const navigate = useNavigate();
  const { map: noteTitleMap, isReady: titleMapReady } = useNoteTitleMap();

  // Handlers for the suggestion extension. EditorProvider remounts per note
  // (key={noteId}), so docId is stable for this instance — but folderId is NOT:
  // Mark/Revoke Collaborative mutates it on the open note without a remount, so
  // read it via a ref (same pattern as handleImageDropRef; the react-hooks
  // compiler lint forbids reusing metadataRef inside a useCallback) so
  // `[[new note]]` lands in the note's CURRENT folder.
  const noteFolderIdRef = useRef(metadata.folderId);
  useEffect(() => {
    noteFolderIdRef.current = metadata.folderId;
  }, [metadata.folderId]);
  const onCreateNoteLink = useCallback(async (title: string) => {
    const res = await createNoteWithContentInDb({
      title,
      content: "",
      folderId: noteFolderIdRef.current,
    });
    return res ? { docId: res.docId } : null;
  }, []);
  const getCurrentNoteId = useCallback(() => docId, [docId]);

  // Live title/navigation resolver for note-link chips + backlinks.
  const noteLinkValue = useMemo<NoteLinkContextValue>(
    () => ({
      resolve: (id) => noteTitleMap.get(id),
      isReady: titleMapReady,
      onNavigate: (id) => {
        const r = noteTitleMap.get(id);
        if (r) navigate(`/${r.folderId}/${id}`, { viewTransition: true });
      },
    }),
    [noteTitleMap, titleMapReady, navigate],
  );

  // Memoize extensions to avoid recreation on every render
  const extensions = useMemo(
    () => [
      ...createEditorExtensions(),
      createCollaborationExtension(yXmlFragment),
      CustomShortcuts.configure({
        // Custom shortcuts can trigger actions here if needed
      }),
      // File handler for image drag/drop/paste
      // eslint-disable-next-line react-hooks/refs -- ref read happens on drop, not during render
      FileHandler.configure({
        maxSizeMB: MAX_IMAGE_SIZE_MB,
        allowedTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"],
        onImageDrop: (file: File, pendingId: string) => handleImageDropRef.current(file, pendingId),
        // Stable for the provider's lifetime: it remounts per note.
        imagesReadOnly: isPeerNote,
      }),
      // AI-powered plugins (conditionally active). All inputs are read via refs
      // at call time so the editor (and its undo history) is never recreated when
      // AI readiness / settings change.
      // eslint-disable-next-line react-hooks/refs -- getters are called only within plugin execution, not during render
      AutocompletePlugin.configure({
        getSuggestion: (text: string) => onGetAutocompleteSuggestionRef.current?.(text) ?? Promise.resolve(""),
        getIsAIReady: () => isAIReadyRef.current,
        debounceMs: 500,
        minCharsBeforeTrigger: 5,
        debug: false,
      }),
      // Slash commands (triggered by typing /)
      SlashCommandsExtension,
      // Internal note links — `[[` suggestion (the noteLink node is in createBaseExtensions)
      // eslint-disable-next-line react-hooks/refs -- folderId ref is read when a note is created, not during render
      NoteLinkExtension.configure({
        onCreateNote: onCreateNoteLink,
        getCurrentNoteId,
      }),
      // Grammar plugin — always included, checks getIsGrammarEnabled() at runtime
      // eslint-disable-next-line react-hooks/refs -- getters are called only within plugin execution, not during render
      GrammarPlugin.configure({
        checkGrammar: (text: string) => onCheckGrammarRef.current?.(text) ?? Promise.resolve([]),
        getIsAIReady: () => isAIReadyRef.current,
        getIsGrammarEnabled: () => isGrammarEnabledRef.current,
        debounceMs: 3000,
        minCharsToCheck: 20,
        debug: false,
      }),
    ],
    // Only the Yjs fragment is a real input; everything else is read via refs
    // (or is stable for this note's lifetime — the provider remounts per note)
    // so the editor is created once per note and undo/redo history survives.
    // onCreateNoteLink / getCurrentNoteId are intentionally omitted: both have
    // stable identities ([] deps / keyed by noteId), and onCreateNoteLink reads
    // the mutable folderId through a ref rather than closing over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only yXmlFragment is a real input; everything else is read via refs so undo history survives (see comment above)
    [yXmlFragment],
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
      // Create the editor after mount, not during render. With
      // immediatelyRender: true, useEditor builds it in render and destroys it
      // on the next tick unless the component has mounted by then; a render
      // that yields before committing (slow CPU, a suspending sibling) commits
      // that destroyed editor, and children's effects crash on it. Nothing is
      // lost: the pane shows "Loading document..." until PGlite loads anyway.
      immediatelyRender: false,
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
    [extensions],
  );

  // Refs for current values - avoids stale closures in debounced functions
  const docIdRef = useRef(docId);
  const metadataRef = useRef(metadata);

  // Keep refs in sync with props
  useEffect(() => {
    docIdRef.current = docId;
    metadataRef.current = metadata;
    onSaveRef.current = onSave;
  }, [docId, metadata, onSave]);

  // Timeout refs for cleanup
  const searchIndexTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const updateSearchIndex = useCallback(
    (editorInstance: Editor, plainTextContent?: string) => {
      if (searchIndexTimeoutRef.current) {
        clearTimeout(searchIndexTimeoutRef.current);
      }

      searchIndexTimeoutRef.current = setTimeout(() => {
        const currentDocId = docIdRef.current;
        const currentMetadata = metadataRef.current;
        // Use passed plainText if available, otherwise fallback
        const plainText = plainTextContent ?? editorInstance.getText();
        // Recompute outgoing internal links — powers the backlinks live query.
        const linkedNoteIds = extractNoteLinkIds(editorInstance.getJSON());

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
            linkedNoteIds,
            lastEditedBy: currentMetadata.isCollaborative
              ? editorOdinId
              : isAgentEditor(currentMetadata.lastEditedBy)
                ? undefined
                : currentMetadata.lastEditedBy,
          },
        });

        // Mark the note pending (bumps dirty_generation) on a real content edit so
        // the periodic sync is a true safety net and a slow push can't clobber this
        // edit back to 'synced' (plan 004).
        void updateSyncStatus(currentDocId, "pending");
      }, 500);
    },
    [editorOdinId],
  );

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

  // Clean up all timeouts on unmount
  useEffect(() => {
    return () => {
      if (searchIndexTimeoutRef.current)
        clearTimeout(searchIndexTimeoutRef.current);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Handle editor content changes - only update when content actually changes
  useEffect(() => {
    if (!editor || !providerRef.current || isLoading) return;

    const handleUpdate = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      if (!transaction.docChanged) {
        return;
      }

      // Skip Yjs-originated transactions (initial content load + remote sync);
      // only genuine local user edits should trigger a save. y-prosemirror tags
      // its own doc→editor sync transactions with isChangeOrigin. The previous
      // one-shot "skip the first docChanged" dropped the user's FIRST edit — e.g.
      // pasting into a fresh note never saved — because the initial-load update
      // fires before this listener attaches (or not at all for an empty note).
      if (transaction.getMeta(ySyncPluginKey)?.isChangeOrigin) {
        return;
      }

      // upsertSearchIndex (above) writes to PGlite; the note list live query
      // picks up the title/preview change with no manual invalidation.
      // Plain text is computed lazily inside the 500 ms debounce (updateSearchIndex's
      // fallback) — at most once per window, instead of an O(document) getText() per
      // keystroke.
      updateSearchIndex(editor);

      if (providerRef.current) {
        debouncedSave(providerRef.current);
      }
    };

    editor.on("update", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
    };
  }, [editor, isLoading, updateSearchIndex, debouncedSave]);

  const value = {
    editor,
    isReady: !isLoading && !!editor,
    isLoading,
    isAIReady,
    cover,
    setCoverFromFile,
    removeCover,
    setCoverPosition,
    blockState,
  };

  return (
    <EditorContext.Provider value={value}>
      <NoteLinkContext.Provider value={noteLinkValue}>
        <ImageOwnerContext.Provider value={isPeerNote ? metadata.authorOdinId : undefined}>
          {children}
        </ImageOwnerContext.Provider>
      </NoteLinkContext.Provider>
    </EditorContext.Provider>
  );
}
