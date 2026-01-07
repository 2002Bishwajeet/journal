import { useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  EditorToolbar,
  AIMenu,
  EditorProvider,
  useEditorContext,
  TipTapEditor,
} from "@/components/editor";
import { SyncStatus } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { useSyncService, useKeyboardShortcuts, useDeviceType } from "@/hooks";
import { useWebLLM } from "@/hooks/useWebLLM";
import { useNotes } from "@/hooks/useNotes";

function EditorLayout({
  noteId,
  onBack,
}: {
  noteId: string;
  onBack: () => void;
}) {
  const { editor, isLoading } = useEditorContext();
  const {
    get: { data: notes = [] },
    updateNote: { mutateAsync: updateNoteMetadata },
  } = useNotes();
  // const { notes, updateNoteMetadata } = useJournalState();
  const deviceType = useDeviceType();
  const isDesktop = deviceType === "desktop";

  // Find the selected note metadata from the notes list
  // We can trust specific noteId exists because parent checks it
  const selectedNote = notes.find((n) => n.docId === noteId);
  const selectedNoteMetadata = selectedNote?.metadata;

  if (!selectedNoteMetadata && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm font-medium mb-3">Note not found</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          Back to list
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-background relative">
      {/* Mobile Editor Header */}
      <div
        className={
          isDesktop
            ? "hidden"
            : "flex items-center h-12 px-3 bg-background border-b border-border w-full shrink-0"
        }
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 -ml-1"
          onClick={onBack}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium truncate flex-1 mx-2">
          {selectedNoteMetadata?.title || "Untitled"}
        </span>
        <SyncStatus showText={false} />
      </div>

      {/* Desktop Toolbar */}
      <div
        className={
          isDesktop
            ? "flex items-center border-b shrink-0 bg-background z-10 w-full"
            : "hidden"
        }
      >
        {editor && <EditorToolbar editor={editor} />}
        {editor && <AIMenu editor={editor} />}
      </div>

      <div className="flex-1 overflow-y-auto relative bg-background w-full">
        <TipTapEditor
          metadata={selectedNoteMetadata!} // We handled null above, but strictly we should check again or rely on loader
          onMetadataChange={(meta) =>
            updateNoteMetadata({
              docId: noteId,
              metadata: meta,
            })
          }
          hideToolbar={true} // We use the external toolbar
          className="min-h-full py-8 px-6 md:px-12 max-w-5xl mx-auto pb-24 md:pb-8"
        />
      </div>

      {/* Mobile Bottom Toolbar (Sticky) */}
      <div
        className={
          isDesktop
            ? "hidden"
            : "border-t bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 sticky bottom-0 z-50 w-full overflow-x-auto scrollbar-hide"
        }
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        }}
      >
        {editor && <EditorToolbar editor={editor} isMobile={true} />}
      </div>
    </div>
  );
}

export default function EditorPage() {
  const { noteId, folderId } = useParams();
  const navigate = useNavigate();
  const {
    get: { data: notes = [] },
    updateNote: { mutateAsync: updateNoteMetadata },
  } = useNotes();
  const { syncNote } = useSyncService();

  // WebLLM for AI-powered features
  const { isReady: isAIReady } = useWebLLM();

  // Find the selected note metadata from the notes list
  const selectedNote = notes.find((n) => n.docId === noteId);
  const selectedNoteMetadata = selectedNote?.metadata;

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onSave: () => {
      // We can't access editor instance here easily to force save,
      // but EditorProvider handles auto-save.
      console.log("[Shortcuts] Manual save triggered (Editor)");
    },
  });

  const handleSave = async () => {
    // The sync service will pick up pending changes on focus/visibility
    // For immediate sync, we can trigger syncNote
    if (noteId) {
      await syncNote(noteId);
    }
  };

  const handleBackToNotes = () => {
    if (folderId) {
      navigate(`/${folderId}`);
    } else {
      navigate("/");
    }
  };

  // AI callbacks
  const handleGetAutocompleteSuggestion = useCallback(
    async (text: string): Promise<string> => {
      if (!isAIReady) return "";
      try {
        const { getAutocompleteSuggestion } = await import("@/lib/webllm");
        return await getAutocompleteSuggestion(text);
      } catch (error) {
        console.error("[EditorPage] Autocomplete failed:", error);
        return "";
      }
    },
    [isAIReady]
  );

  const handleCheckGrammar = useCallback(
    async (text: string): Promise<string[]> => {
      if (!isAIReady) return [];
      try {
        const { checkGrammar } = await import("@/lib/webllm");
        return await checkGrammar(text);
      } catch (error) {
        console.error("[EditorPage] Grammar check failed:", error);
        return [];
      }
    },
    [isAIReady]
  );

  if (!noteId) {
    return null;
  }

  if (!selectedNoteMetadata) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm font-medium mb-3">Note not found</p>
        <Button variant="outline" size="sm" onClick={handleBackToNotes}>
          Back to list
        </Button>
      </div>
    );
  }

  return (
    <EditorProvider
      key={noteId} // Force re-mount provider when note changes
      docId={noteId}
      metadata={selectedNoteMetadata}
          onMetadataChange={async (meta) => {
            await updateNoteMetadata({
              docId: noteId,
              metadata: meta,
            });
            // Trigger immediate sync for title updates to ensure they are pushed to remote
            // The editor content sync is debounced separately, but title is critical metadata
            await syncNote(noteId);
          }}
      onSave={handleSave}
      isAIReady={isAIReady}
      onGetAutocompleteSuggestion={handleGetAutocompleteSuggestion}
      onCheckGrammar={handleCheckGrammar}
    >
      <EditorLayout noteId={noteId} onBack={handleBackToNotes} />
    </EditorProvider>
  );
}
