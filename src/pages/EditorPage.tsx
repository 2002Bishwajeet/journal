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
import { ChevronLeft, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSyncService, useKeyboardShortcuts, useDeviceType } from "@/hooks";
import { useWebLLM } from "@/hooks/useWebLLM";
import { useNotes } from "@/hooks/useNotes";
import { useAISettings } from "@/hooks/useAISettings";

function EditorLayout({
  noteId,
  onBack,
  focusMode = false,
}: {
  noteId: string;
  onBack: () => void;
  focusMode?: boolean;
}) {
  const { editor, isLoading } = useEditorContext();
  const {
    get: { data: notes = [] },
    updateNote: { mutateAsync: updateNoteMetadata },
  } = useNotes();
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
        {selectedNoteMetadata?.isCollaborative && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 text-xs">
                  <Users className="h-3 w-3" />
                  <span className="hidden sm:inline">Collaborative</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">
                  {selectedNoteMetadata?.lastEditedBy 
                    ? `Last edited by ${selectedNoteMetadata.lastEditedBy}`
                    : 'Shared with your circles'}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <SyncStatus />
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
          noteId={noteId}
          metadata={selectedNoteMetadata!}
          onMetadataChange={(meta) =>
            updateNoteMetadata({
              docId: noteId,
              metadata: meta,
            })
          }
          hideToolbar={true}
          className={cn(
            "min-h-full py-8 px-6 mx-auto pb-24 md:pb-8",
            focusMode
              ? "max-w-2xl md:px-8 pt-12"
              : "max-w-5xl md:px-12"
          )}
        />
      </div>
    </div>
  );
}

export default function EditorPage({
  overrideNoteId,
  overrideFolderId,
  focusMode = false,
}: {
  overrideNoteId?: string;
  overrideFolderId?: string;
  focusMode?: boolean;
} = {}) {
  const params = useParams();
  const noteId = overrideNoteId || params.noteId;
  const folderId = overrideFolderId || params.folderId;
  
  const navigate = useNavigate();
  const {
    get: { data: notes = [] },
    updateNote: { mutateAsync: updateNoteMetadata },
  } = useNotes();
  const { syncNote } = useSyncService();

  // WebLLM for AI-powered features
  const { isReady: isAIReady } = useWebLLM();
  const { settings: aiSettings } = useAISettings();

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
      if (!aiSettings.autocompleteEnabled) return "";
      if (!isAIReady) return "";
      try {
        const { getAutocompleteSuggestion } = await import("@/lib/webllm");
        return await getAutocompleteSuggestion(text);
      } catch (error) {
        console.error("[EditorPage] Autocomplete failed:", error);
        return "";
      }
    },
    [isAIReady, aiSettings.autocompleteEnabled],
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
    [isAIReady],
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
      key={noteId}
      docId={noteId}
      metadata={selectedNoteMetadata}
      onMetadataChange={async (meta) => {
        await updateNoteMetadata({
          docId: noteId,
          metadata: meta,
        });
      }}
      onSave={handleSave}
      isAIReady={isAIReady}
      onGetAutocompleteSuggestion={handleGetAutocompleteSuggestion}
      onCheckGrammar={handleCheckGrammar}
    >
      <EditorLayout noteId={noteId} onBack={handleBackToNotes} focusMode={focusMode} />
    </EditorProvider>
  );
}
