import {
  useParams,
  useNavigate,
  useLocation,
  useSearchParams,
  Navigate,
} from "react-router-dom";
import {
  Sidebar,
  NoteListPane,
  EditorPane,
  ChatBot,
  SplashScreen,
} from "@/components/layout";
import { NewNoteFab } from "@/components/layout/NewNoteFab";
import {
  useTabRouting,
  useLayoutUrlActions,
  useNoteListView,
  useNoteActions,
  useNoteCollaboration,
  useSessionPersistence,
  useDeviceType,
  useSyncService,
  useKeyboardShortcuts,
  useDocumentTitle,
} from "@/hooks";
import { cn } from "@/lib/utils";
import { useState, useEffect, useLayoutEffect, lazy, Suspense, useMemo, useCallback } from "react";
import { routeRendered, slideNavigate } from "@/lib/navDirection";
import { Minimize2 } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import {
  CreateFolderModal,
  SearchModal,
  ConfirmDialog,
  KeyboardShortcutsModal,
  ExtendPermissionDialog,
} from "@/components/modals";
import MoveToFolderDialog from "@/components/modals/MoveToFolderDialog";

const SettingsModal = lazy(() => import("@/components/modals/SettingsModal"));
const ShareDialog = lazy(() => import("@/components/modals/ShareDialog"));
const MarkCollaborativeDialog = lazy(() =>
  import("@/components/modals/MarkCollaborativeDialog").then((m) => ({
    default: m.MarkCollaborativeDialog,
  })),
);
import { PSEUDO_FOLDERS } from "@/lib/homebase/config";
import type { NoteListEntry } from "@/types";
import { useNotes } from "@/hooks/useNotes";
import { getMobilePane, showNewNoteFab } from "@/layouts/mobilePane";
import { useTextFieldFocused } from "@/hooks/useTextFieldFocused";
import { useDailyNote } from "@/hooks/useDailyNote";
import { useTags } from "@/hooks/useTags";
import { usePeerPushSubscriptions } from "@/hooks/usePeerPushSubscriptions";
import { useSharePush } from "@/hooks/useSharePush";
import { useRecordRecentNote } from "@/hooks/useRecentNotes";
import { useWebMcpBridge } from "@/hooks/useWebMcp";
import { useSettingsOpener } from "@/hooks/useSettingsOpener";
import { useAuth } from "@/hooks/auth";
import { overlayEntryOpen } from "@/hooks/useOverlayHistory";
import { useAutoWhatsNew } from "@/hooks/useWhatsNew";
import WhatsNewDialog from "@/components/modals/WhatsNewDialog";
import { useFolders, isUnknownFolderRoute } from "@/hooks/useFolders";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useEditorAppearance } from "@/hooks/useEditorAppearance";
import { toast } from "sonner";
import { prefetchEditorPage } from "@/pages/EditorPage.lazy";

export default function JournalLayout() {
  // Initialize theme preference & system listener at root level
  useThemePreference();
  // Apply the stored editor font/width attributes at root level
  useEditorAppearance();
  const whatsNew = useAutoWhatsNew();

  // Warm the lazy editor chunk once the shell is idle. Desktop with restored
  // tabs already triggers the import by rendering it; this covers mobile and
  // the empty-tab case so the first note tap has nothing left to download.
  useEffect(() => {
    // Cancel with the canceller matching the scheduler actually used — Safari
    // < 16.4 has no requestIdleCallback, and cancelIdleCallback?.() there is a
    // no-op that would leave the timer to fire (and fetch ~1 MB) after unmount.
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => prefetchEditorPage());
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(() => prefetchEditorPage(), 1000);
    return () => clearTimeout(id);
  }, []);

  const { folderId, noteId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // A phone slide (#779) animates once the new location has rendered.
  useLayoutEffect(routeRendered, [location.key]);

  const { logout } = useAuth();

  const {
    get: { data: notes = [], isLoading: isNotesLoading },
    createNote: { mutateAsync: createNote },
  } = useNotes();

  const {
    get: { data: folders = [], isLoading: isFolderLoading },
    createFolder: { mutateAsync: createNewFolder },
    renameFolder: { mutate: renameFolder },
    deleteFolder: { mutate: deleteFolder },
  } = useFolders();

  const { openToday } = useDailyNote();

  // Tab management, kept in sync with the URL
  const {
    openTabs,
    activeTabId,
    mountedTabs,
    closeTab,
    handleTabClick,
    handleTabClose,
  } = useTabRouting({ noteId, folderId, notes, isNotesLoading });

  // Session persistence
  useSessionPersistence();

  // Homebase sync - auto-syncs on mount and focus
  useSyncService();

  // Subscribe to each connection's Journal peer push
  usePeerPushSubscriptions();
  // Pull the owner of each share push (#745)
  useSharePush();
  useWebMcpBridge();

  // Focus / Zen mode state
  const [focusMode, setFocusMode] = useState(false);

  // Modal states
  const [showSearch, setShowSearch] = useState(false);
  const settings = useSettingsOpener();
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [folderToRename, setFolderToRename] = useState<string | null>(null);
  const [collaborativeNote, setCollaborativeNote] =
    useState<NoteListEntry | null>(null);
  const [revokeNote, setRevokeNote] = useState<NoteListEntry | null>(null);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [shareNote, setShareNote] = useState<NoteListEntry | null>(null);
  const [moveNote, setMoveNote] = useState<NoteListEntry | null>(null);

  const [searchParams] = useSearchParams();

  const collaborativeTabIds = useMemo(
    () =>
      new Set(
        notes.filter((n) => n.metadata.isCollaborative).map((n) => n.docId),
      ),
    [notes],
  );

  // Handle App Shortcuts (PWA) and permission redirects
  useLayoutUrlActions({
    folders,
    isFolderLoading,
    folderId,
    notes,
    createNote,
    openSearch: setShowSearch,
    openCollaborate: setCollaborativeNote,
  });

  const selectedTag = searchParams.get("tag");
  const {
    notes: listNotes,
    isLoading: isListLoading,
    isManagementView,
    counts,
  } = useNoteListView({ folderId, selectedTag });
  const noteActions = useNoteActions({
    folderId,
    noteId,
    selectedTag,
    notes: listNotes,
    folders,
    closeTab,
    handleTabClose,
  });
  const { revoke: revokeCollaboration } = useNoteCollaboration();

  // Focus mode hides all chrome to spotlight the editor; management views have
  // no editor, so its effect is suppressed there (otherwise: blank screen).
  const inFocusMode = focusMode && !isManagementView;

  // Daily notes ("Today"): open/create today's note, then route to it.
  const handleOpenToday = useCallback(async () => {
    try {
      const { docId, folderId: dailyFolderId } = await openToday();
      const path = `/${dailyFolderId}/${docId}`;
      // Already there: a push would make Back need two presses.
      if (path !== location.pathname) navigate(path, { viewTransition: true });
    } catch {
      toast.error("Couldn't open today's note");
    }
  }, [openToday, navigate, location.pathname]);

  // Keyboard shortcuts (Cmd+K for search)
  useKeyboardShortcuts({
    onSearch: () => setShowSearch(true),
    onKeyboardHelp: () => setShowKeyboardHelp(true),
    // No editor to focus in a management view — would just blank the screen.
    onFocusMode: () => setFocusMode((prev) => (isManagementView ? false : !prev)),
    onDailyNote: handleOpenToday,
    onEscape: inFocusMode ? () => setFocusMode(false) : undefined,
  });

  // Device type detection
  const deviceType = useDeviceType();
  const isDesktop = deviceType === "desktop";
  // If not desktop (so mobile or tablet), treat as mobile layout

  const viewLabel = selectedTag
    ? `#${selectedTag}`
    : folderId === PSEUDO_FOLDERS.trash
      ? "Trash"
      : folderId === PSEUDO_FOLDERS.archive
        ? "Archive"
        : folderId === PSEUDO_FOLDERS.shared
          ? "Shared"
          : folders.find((f) => f.id === folderId)?.name;
  const { tags, tagCounts, deleteTag } = useTags();

  const mobilePane = getMobilePane({ folderId, noteId, tag: selectedTag });
  const isPhone = deviceType === "mobile";
  const textFieldFocused = useTextFieldFocused();
  const showFab = showNewNoteFab({
    isPhone,
    pane: mobilePane,
    isManagementView,
    overlayOpen: overlayEntryOpen(location.state),
    textFieldFocused,
  });

  // Tab/window title: the open note, else the current view. Trash/Archive hide
  // the desktop editor, so an open tab there must not win.
  const openNoteId = isManagementView ? null : isDesktop ? activeTabId : noteId;
  useRecordRecentNote(openNoteId);
  useDocumentTitle(
    openNoteId
      ? notes.find((n) => n.docId === openNoteId)?.title || "Untitled"
      : viewLabel,
  );

  if (isNotesLoading || isFolderLoading) {
    return <SplashScreen />;
  }

  if (isUnknownFolderRoute(folderId, noteId, folders)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex h-dvh bg-background overflow-hidden relative pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      {/* Sidebar */}
      <div
        data-pane="sidebar"
        className={cn(
          "h-full border-r bg-muted/10 transition-all duration-300 ease-in-out",
          // Desktop: Always visible
          isDesktop ? "flex static" : "hidden",
          // Mobile: Visible only at the root (no folder, tag or note)
          !isDesktop &&
            mobilePane === "sidebar" &&
            "flex absolute inset-y-0 left-[env(safe-area-inset-left)] right-[env(safe-area-inset-right)] z-30 bg-background",
          inFocusMode && "hidden!",
        )}
      >
        <Sidebar
          folders={folders}
          selectedFolderId={folderId || ""}
          onSelectFolder={(id) => {
            // On desktop, if there's an active tab, keep showing it
            if (isDesktop && activeTabId) {
              const activeNote = notes.find((n) => n.docId === activeTabId);
              if (activeNote) {
                // Navigate to new folder but keep showing the active note
                navigate(`/${id}/${activeTabId}`, { viewTransition: true });
                return;
              }
            }
            slideNavigate("forward", () => navigate(`/${id}`));
          }}
          onCreateFolder={() => setShowCreateFolder(true)}
          onDeleteFolder={(id) => deleteFolder(id)}
          onRenameFolder={setFolderToRename}
          onOpenToday={handleOpenToday}
          collaborativeCount={counts.collaborative}
          onSelectShared={() => navigate("/shared")}
          onSelectTrash={() => navigate("/trash")}
          trashCount={counts.trashed}
          onSelectArchive={() => navigate("/archive")}
          archivedCount={counts.archived}
          onSearch={() => setShowSearch(true)}
          onSettings={settings.open}
          onLogout={logout}
          tags={tags}
          tagCounts={tagCounts}
          selectedTag={selectedTag}
          onSelectTag={(tag) => {
            if (tag) {
              navigate(`/?tag=${encodeURIComponent(tag)}`);
            } else {
              navigate(folderId ? `/${folderId}` : "/");
            }
          }}
          onDeleteTag={(tag) => {
            deleteTag(tag).catch(() => toast.error("Couldn't delete tag"));
          }}
          className="h-full"
        />
      </div>

      <NoteListPane
        isDesktop={isDesktop}
        isPhone={isPhone}
        isManagementView={isManagementView}
        isListVisibleOnMobile={mobilePane === "list"}
        inFocusMode={inFocusMode}
        folderId={folderId}
        noteId={noteId}
        selectedTag={selectedTag}
        viewLabel={viewLabel}
        listNotes={listNotes}
        isListLoading={isListLoading}
        noteActions={noteActions}
        onShareNote={setShareNote}
        onMoveToFolder={setMoveNote}
        onMarkCollaborative={(note) => {
          if (note.metadata.isCollaborative) {
            setRevokeNote(note);
          } else {
            setCollaborativeNote(note);
          }
        }}
      />

      <EditorPane
        isDesktop={isDesktop}
        isManagementView={isManagementView}
        isEditorVisibleOnMobile={mobilePane === "editor"}
        focusMode={focusMode}
        onEnterFocusMode={() => setFocusMode(true)}
        onExitFocusMode={() => setFocusMode(false)}
        folderId={folderId}
        noteId={noteId}
        openTabs={openTabs}
        mountedTabs={mountedTabs}
        activeTabId={activeTabId}
        collaborativeTabIds={collaborativeTabIds}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
      />

      {/* Focus mode exit pill for touch layouts; desktop has an Exit button in the toolbar. */}
      {inFocusMode && !isDesktop && (
        <div className="fixed top-[calc(env(safe-area-inset-top)+3rem)] left-0 right-0 z-40 flex justify-center pointer-events-none">
          <button
            onClick={() => setFocusMode(false)}
            className="pointer-events-auto mt-2 flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-foreground/5 backdrop-blur-md border border-border/50 text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors"
          >
            <Minimize2 className="h-3 w-3" />
            Exit Focus
            <Kbd className="pointer-coarse:hidden">⌘⇧F</Kbd>
          </button>
        </div>
      )}

      {showFab && <NewNoteFab onClick={() => void noteActions.createAndOpen(folderId)} />}

      {/* Modals */}
      {noteId && deviceType !== "mobile" ? <ChatBot activeNoteId={noteId} /> : null}

      <SearchModal
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
        onSelectNote={(docId) => {
          // Find note to get folder
          const note = notes.find((n) => n.docId === docId);
          if (note) {
            // On a phone the sheet owns the current entry (#822): replace it,
            // so Back from the note returns to the screen under the sheet.
            navigate(`/${note.metadata.folderId}/${docId}`, { replace: overlayEntryOpen(location.state) });
          }
          setShowSearch(false);
        }}
      />

      <CreateFolderModal
        isOpen={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        onCreate={(name) => {
          createNewFolder(name);
          setShowCreateFolder(false);
        }}
      />

      <CreateFolderModal
        key={folderToRename ?? "none"}
        isOpen={!!folderToRename}
        initialName={folders.find((f) => f.id === folderToRename)?.name ?? ""}
        onClose={() => setFolderToRename(null)}
        onCreate={(name) => {
          if (folderToRename) renameFolder({ id: folderToRename, name });
          setFolderToRename(null);
        }}
      />

      <Suspense fallback={null}>
        <SettingsModal
          isOpen={settings.isOpen}
          initialSection={settings.section}
          onClose={settings.close}
        />
      </Suspense>

      <WhatsNewDialog entries={whatsNew.entries} onClose={whatsNew.close} />

      {shareNote && (
        <Suspense fallback={null}>
          <ShareDialog
            isOpen={!!shareNote}
            onClose={() => setShareNote(null)}
            noteId={shareNote.docId}
            noteTitle={shareNote.title || "Untitled"}
          />
        </Suspense>
      )}

      {moveNote && (
        <MoveToFolderDialog
          isOpen
          onClose={() => setMoveNote(null)}
          noteTitle={moveNote.title || "Untitled"}
          currentFolderId={moveNote.metadata.folderId}
          folders={folders}
          onMove={(targetFolderId) =>
            void noteActions.moveToFolder(moveNote.docId, targetFolderId)
          }
        />
      )}

      {collaborativeNote && (
        <Suspense fallback={null}>
          <MarkCollaborativeDialog
            isOpen={!!collaborativeNote}
            onClose={() => {
              setCollaborativeNote(null);
              requestAnimationFrame(() => {
                (document.getElementById("main-content") as HTMLElement | null)?.focus();
              });
            }}
            noteId={collaborativeNote.docId}
            noteTitle={collaborativeNote.title || "Untitled"}
          />
        </Suspense>
      )}

      <ConfirmDialog
        isOpen={!!revokeNote}
        onClose={() => setRevokeNote(null)}
        title="Revoke Collaboration"
        description={`This will remove circle access to "${revokeNote?.title || "Untitled"}" and move it out of the shared folder — it will no longer be accessible to collaborators.`}
        confirmText="Revoke"
        variant="destructive"
        onConfirm={() => revokeCollaboration(revokeNote)}
      />
      <KeyboardShortcutsModal
        isOpen={showKeyboardHelp}
        onClose={() => setShowKeyboardHelp(false)}
      />

      <ExtendPermissionDialog />
    </div>
  );
}
