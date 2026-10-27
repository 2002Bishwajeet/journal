import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import {
  EditorToolbar,
  AIMenu,
  EditorProvider,
  useEditorContext,
  TipTapEditor,
} from "@/components/editor";
import { TocPanel } from "@/components/editor/TocPanel";
import { FindReplaceBar } from "@/components/editor/FindReplaceBar";
import { SyncStatus } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { ChevronLeft, History, MoreHorizontal, Minimize2 } from "lucide-react";
import { CollaborativePopover } from '@/components/editor/CollaborativePopover';
import { LinkedMentions } from "@/components/editor/LinkedMentions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import HistoryModal from "@/components/modals/HistoryModal";
import { cn } from "@/lib/utils";
import { useSyncService, useKeyboardShortcuts, useDeviceType } from "@/hooks";
import { usePeerNoteWebsocket } from "@/hooks/usePeerNoteWebsocket";
import { usePeerNoteContent } from "@/hooks/usePeerNoteContent";
import { useShareLinkPull } from "@/hooks/useSharePush";
import { toast } from "sonner";
import { PeerNoteLoading, PeerNoteError } from "@/components/editor/PeerNoteFallback";
import {
  isPeerContentFailure,
  isPeerContentReady,
} from "@/components/editor/peerNoteStatus";
import { useDotYouClientContext } from "@/components/auth";
import { useWebLLM } from "@/hooks/useWebLLM";
import { useNotes } from "@/hooks/useNotes";
import { useAISettings } from "@/hooks/useAISettings";
import { useRegisterActiveEditor } from "@/hooks/useRegisterActiveEditor";
import { useBackTo } from "@/hooks/useBackTo";
import { isViewOnly } from "@/lib/homebase/shareTargets";

// EditorProvider auto-saves, so Cmd+S only needs swallowing. A module constant
// keeps the handler's identity stable: every mounted tab rebinds the window
// listener when it changes.
const swallowSave = () => {
  console.log("[Shortcuts] Manual save triggered (Editor)");
};

function EditorLayout({
  noteId,
  onBack,
  focusMode = false,
  onExitFocusMode,
  isActive,
  isPeerNote,
}: {
  noteId: string;
  onBack: () => void;
  focusMode?: boolean;
  onExitFocusMode?: () => void;
  isActive: boolean;
  isPeerNote: boolean;
}) {
  const { editor, isLoading, readOnly } = useEditorContext();
  const {
    get: { data: notes = [] },
    updateNote: { mutateAsync: updateNoteMetadata },
  } = useNotes();
  const deviceType = useDeviceType();
  const isDesktop = deviceType === "desktop";
  const [tocOpen, setTocOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Find the selected note metadata from the notes list
  // We can trust specific noteId exists because parent checks it
  const selectedNote = notes.find((n) => n.docId === noteId);
  const selectedNoteMetadata = selectedNote?.metadata;
  useRegisterActiveEditor(editor, {
    docId: noteId,
    isActive,
    editable: !!editor?.isEditable && selectedNoteMetadata?.archivalStatus !== 2,
    excludeFromAI: selectedNoteMetadata?.excludeFromAI === true,
  });

  const collaborativePopover = selectedNoteMetadata?.isCollaborative ? (
    <CollaborativePopover
      circleIds={selectedNoteMetadata.circleIds}
      recipients={selectedNoteMetadata.recipients}
      lastEditedBy={selectedNoteMetadata.lastEditedBy}
      lastEditedAt={selectedNoteMetadata.timestamps?.modified}
    />
  ) : null;
  // A note shared with the host as a viewer (#897)
  const viewOnlyBadge = readOnly ? (
    <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      View only
    </span>
  ) : null;

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
          aria-label="Back"
          className={cn("h-8 w-8 -ml-1", deviceType === "tablet" && "hidden")}
          onClick={onBack}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium truncate flex-1 mx-2">
          {selectedNoteMetadata?.title || "Untitled"}
        </span>
        {viewOnlyBadge}
        {collaborativePopover}
        <SyncStatus />
        {!isPeerNote && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More" className="h-11 w-11 -mr-2 shrink-0">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="min-h-11" onSelect={() => setHistoryOpen(true)}>
                <History className="h-4 w-4" />
                Version history
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Desktop Toolbar */}
      <div
        className={
          isDesktop
            ? "flex items-center border-b shrink-0 bg-background z-10 w-full"
            : "hidden"
        }
      >
        {editor && !readOnly && (
          <EditorToolbar
            editor={editor}
            tocOpen={tocOpen}
            onToggleToc={() => setTocOpen((prev) => !prev)}
            // Version history is for your own notes: a restore on a peer note
            // would push a whole-document replacement into someone else's note.
            onOpenHistory={isPeerNote ? undefined : () => setHistoryOpen(true)}
          />
        )}
        {editor && !readOnly && <AIMenu editor={editor} />}
        {(viewOnlyBadge || collaborativePopover) && (
          <div className="ml-auto flex items-center gap-2 px-3">
            {viewOnlyBadge}
            {collaborativePopover}
          </div>
        )}
        {focusMode && onExitFocusMode && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onExitFocusMode}
            title="Exit Focus (Esc or Cmd+Shift+F)"
            className={cn("mr-3 shrink-0 gap-1.5 text-xs text-muted-foreground", !collaborativePopover && "ml-auto")}
          >
            <Minimize2 className="h-3.5 w-3.5" />
            Exit Focus
          </Button>
        )}
      </div>

      <div className="flex-1 flex min-h-0 w-full overflow-hidden">
        {/* The container a `wide` live block takes its width from (src/index.css, "Live blocks"). */}
        <div className="@container/live-blocks flex-1 overflow-y-auto relative bg-background w-full">
          <FindReplaceBar />
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
            className="min-h-full py-8 px-6 mx-auto pb-24 md:pb-8 editor-column max-w-5xl md:px-12"
          />
          <div className="mx-auto px-6 pb-24 md:pb-8 editor-column max-w-5xl md:px-12">
            <LinkedMentions noteId={noteId} isActive={isActive} />
          </div>
        </div>
        {isDesktop && tocOpen && editor && (
          <TocPanel editor={editor} onClose={() => setTocOpen(false)} />
        )}
      </div>

      {editor && !isPeerNote && (
        <HistoryModal
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          editor={editor}
          docId={noteId}
        />
      )}
    </div>
  );
}

export default function EditorPage({
  overrideNoteId,
  overrideFolderId,
  focusMode = false,
  onExitFocusMode,
  onCloseMissing,
}: {
  overrideNoteId?: string;
  overrideFolderId?: string;
  focusMode?: boolean;
  onExitFocusMode?: () => void;
  /** Desktop tabs: closes this tab — "Back to list" wouldn't change the active tab. */
  onCloseMissing?: () => void;
} = {}) {
  const params = useParams();
  const noteId = overrideNoteId || params.noteId;
  const folderId = overrideFolderId || params.folderId;
  // Desktop keeps every opened tab mounted (hidden), so effects that reach
  // outside this note — window shortcuts, the peer socket — must belong to the
  // tab the URL is actually on. Mobile renders one page, so it is always active.
  const isActiveTab = !overrideNoteId || overrideNoteId === params.noteId;
  
  const backTo = useBackTo();
  const {
    get: { data: notes = [], isLoading: isNotesLoading },
    updateNote: { mutateAsync: updateNoteMetadata },
  } = useNotes();
  const { syncNote, syncService } = useSyncService();
  const dotYouClient = useDotYouClientContext();

  // WebLLM for AI-powered features
  const { isReady: isAIReady } = useWebLLM();
  const { settings: aiSettings } = useAISettings();

  // Find the selected note metadata from the notes list
  const selectedNote = notes.find((n) => n.docId === noteId);
  const selectedNoteMetadata = selectedNote?.metadata;
  // A share notification's link: a note not here yet is pulled from its owner first (#745)
  const isPullingShare = useShareLinkPull(isActiveTab ? noteId : undefined, isNotesLoading, !!selectedNoteMetadata);

  // Peer WebSocket for collaborative notes from other identities
  const isPeerNote = !!selectedNoteMetadata?.authorOdinId &&
      selectedNoteMetadata.authorOdinId !== dotYouClient.getHostIdentity();
  usePeerNoteWebsocket({
      authorOdinId: selectedNoteMetadata?.authorOdinId,
      noteUniqueId: noteId,
      isEnabled: isPeerNote && isActiveTab,
      syncService,
  });

  const peerContent = usePeerNoteContent({
    docId: noteId,
    authorOdinId: selectedNoteMetadata?.authorOdinId,
    isEnabled: isPeerNote,
    syncService,
    onRevoked: () => {
      toast.info("This note is no longer shared with you");
      (onCloseMissing ?? handleBackToNotes)();
    },
  });

  // Keyboard shortcuts — only the active tab handles them, otherwise every open
  // tab would preventDefault and handle the same Cmd+S.
  useKeyboardShortcuts({
    onSave: isActiveTab ? swallowSave : undefined,
  });

  const handleSave = async () => {
    // The sync service will pick up pending changes on focus/visibility
    // For immediate sync, we can trigger syncNote
    if (noteId) {
      await syncNote(noteId);
    }
  };

  const handleBackToNotes = () => {
    backTo(folderId ? `/${folderId}` : "/");
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
    if (isPullingShare) return <PeerNoteLoading />;
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm font-medium mb-3">Note not found</p>
        <Button variant="outline" size="sm" onClick={onCloseMissing ?? handleBackToNotes}>
          {onCloseMissing ? "Close tab" : "Back to list"}
        </Button>
      </div>
    );
  }

  if (isPeerNote && isPeerContentFailure(peerContent.status)) {
    return (
      <PeerNoteError
        status={peerContent.status}
        onRetry={peerContent.retry}
        onBack={handleBackToNotes}
      />
    );
  }

  if (isPeerNote && !isPeerContentReady(peerContent.status)) {
    return <PeerNoteLoading />;
  }

  return (
    <EditorProvider
      key={noteId}
      docId={noteId}
      metadata={selectedNoteMetadata}
      editorOdinId={dotYouClient.getHostIdentity()}
      readOnly={isViewOnly(selectedNoteMetadata, dotYouClient.getHostIdentity())}
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
      <EditorLayout noteId={noteId} onBack={handleBackToNotes} focusMode={focusMode} onExitFocusMode={onExitFocusMode} isActive={isActiveTab} isPeerNote={isPeerNote} />
    </EditorProvider>
  );
}
