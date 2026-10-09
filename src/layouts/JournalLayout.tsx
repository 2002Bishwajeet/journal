import {
  useParams,
  useNavigate,
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
import {
  useTabRouting,
  useLayoutUrlActions,
  useNoteListView,
  useNoteActions,
  useSessionPersistence,
  useDeviceType,
  useSyncService,
  useKeyboardShortcuts,
  useDocumentTitle,
} from "@/hooks";
import { cn } from "@/lib/utils";
import { useState, useEffect, lazy, Suspense, useMemo, useCallback } from "react";
import { Minimize2 } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import {
  CreateFolderModal,
  SearchModal,
  ConfirmDialog,
  KeyboardShortcutsModal,
  ExtendPermissionDialog,
} from "@/components/modals";

const SettingsModal = lazy(() => import("@/components/modals/SettingsModal"));
const ShareDialog = lazy(() => import("@/components/modals/ShareDialog"));
const MarkCollaborativeDialog = lazy(() =>
  import("@/components/modals/MarkCollaborativeDialog").then((m) => ({
    default: m.MarkCollaborativeDialog,
  })),
);
import {
  JOURNAL_APP_ID,
  JOURNAL_APP_NAME,
  COLLABORATION_PERMISSIONS,
  CONTACT_TARGET_DRIVE_REQUEST,
  PSEUDO_FOLDERS,
} from "@/lib/homebase/config";
import type { NoteListEntry } from "@/types";
import { useNotes } from "@/hooks/useNotes";
import { getMobilePane } from "@/layouts/mobilePane";
import { useDailyNote } from "@/hooks/useDailyNote";
import { useTags } from "@/hooks/useTags";
import { useAuth } from "@/hooks/auth";
import { useAutoWhatsNew } from "@/hooks/useWhatsNew";
import WhatsNewDialog from "@/components/modals/WhatsNewDialog";
import { useFolders, isUnknownFolderRoute } from "@/hooks/useFolders";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useEditorAppearance } from "@/hooks/useEditorAppearance";
import { toast } from "sonner";
import { prefetchEditorPage } from "@/pages/EditorPage.lazy";
import { journalDriveRequest } from "@/hooks/auth/useYouAuthAuthorization";

const BASE_DRIVES = [journalDriveRequest];
const COLLAB_DRIVES = [journalDriveRequest, CONTACT_TARGET_DRIVE_REQUEST];
const NO_PERMISSIONS: [] = [];

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

  const { logout } = useAuth();

  const {
    get: { data: notes = [], isLoading: isNotesLoading },
    createNote: { mutateAsync: createNote },
  } = useNotes();

  const {
    get: { data: folders = [], isLoading: isFolderLoading },
    createFolder: { mutateAsync: createNewFolder },
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

  // Focus / Zen mode state
  const [focusMode, setFocusMode] = useState(false);

  // Modal states
  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [collaborativeNote, setCollaborativeNote] =
    useState<NoteListEntry | null>(null);
  const [revokeNote, setRevokeNote] = useState<NoteListEntry | null>(null);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [shareNote, setShareNote] = useState<NoteListEntry | null>(null);

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

  // Focus mode hides all chrome to spotlight the editor; management views have
  // no editor, so its effect is suppressed there (otherwise: blank screen).
  const inFocusMode = focusMode && !isManagementView;

  // Daily notes ("Today"): open/create today's note, then route to it.
  const handleOpenToday = useCallback(async () => {
    try {
      const { docId, folderId: dailyFolderId } = await openToday();
      navigate(`/${dailyFolderId}/${docId}`, { viewTransition: true });
    } catch {
      toast.error("Couldn't open today's note");
    }
  }, [openToday, navigate]);

  // Keyboard shortcuts (Cmd+K for search)
  useKeyboardShortcuts({
    onSearch: () => setShowSearch(true),
    onKeyboardHelp: () => setShowKeyboardHelp(true),
    // No editor to focus in a management view — would just blank the screen.
    onFocusMode: () => setFocusMode((prev) => (isManagementView ? false : !prev)),
    onDailyNote: handleOpenToday,
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

  // Tab/window title: the open note, else the current view. Trash/Archive hide
  // the desktop editor, so an open tab there must not win.
  const openNoteId = isManagementView ? null : isDesktop ? activeTabId : noteId;
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
    <div className="flex h-screen bg-background overflow-hidden relative">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      {/* Sidebar */}
      <div
        className={cn(
          "h-full border-r bg-muted/10 transition-all duration-300 ease-in-out pb-[env(safe-area-inset-bottom)]",
          // Desktop: Always visible
          isDesktop ? "flex static" : "hidden",
          // Mobile: Visible only at the root (no folder, tag or note)
          !isDesktop &&
            mobilePane === "sidebar" &&
            "flex absolute inset-0 z-30 w-full bg-background",
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
            navigate(`/${id}`, { viewTransition: true });
          }}
          onCreateFolder={() => setShowCreateFolder(true)}
          onDeleteFolder={(id) => deleteFolder(id)}
          onOpenToday={handleOpenToday}
          collaborativeCount={counts.collaborative}
          onSelectShared={() => navigate("/shared")}
          onSelectTrash={() => navigate("/trash")}
          trashCount={counts.trashed}
          onSelectArchive={() => navigate("/archive")}
          archivedCount={counts.archived}
          onSearch={() => setShowSearch(true)}
          onSettings={() => setShowSettings(true)}
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
          className="w-full h-full"
        />
      </div>

      <NoteListPane
        isDesktop={isDesktop}
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
        folderId={folderId}
        noteId={noteId}
        openTabs={openTabs}
        mountedTabs={mountedTabs}
        activeTabId={activeTabId}
        collaborativeTabIds={collaborativeTabIds}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
      />

      {/* Focus mode exit pill — centered top, auto-fades, reveals on hover */}
      {inFocusMode && (
        <div className="fixed top-0 left-0 right-0 z-40 flex justify-center group/focus">
          <button
            onClick={() => setFocusMode(false)}
            className="mt-2 flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-foreground/5 backdrop-blur-md border border-border/50 text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all opacity-0 group-hover/focus:opacity-100 -translate-y-2 group-hover/focus:translate-y-0"
          >
            <Minimize2 className="h-3 w-3" />
            Exit Focus
            <Kbd>⌘⇧F</Kbd>
          </button>
        </div>
      )}

      {/* Modals */}
      {noteId ? <ChatBot activeNoteId={noteId} /> : null}

      <SearchModal
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
        onSelectNote={(docId) => {
          // Find note to get folder
          const note = notes.find((n) => n.docId === docId);
          if (note) {
            navigate(`/${note.metadata.folderId}/${docId}`);
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

      <Suspense fallback={null}>
        <SettingsModal
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
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
        onConfirm={() => noteActions.revokeCollaboration(revokeNote)}
      />
      <KeyboardShortcutsModal
        isOpen={showKeyboardHelp}
        onClose={() => setShowKeyboardHelp(false)}
      />

      <ExtendPermissionDialog
        appId={JOURNAL_APP_ID}
        appName={JOURNAL_APP_NAME}
        drives={counts.collaborative > 0 ? COLLAB_DRIVES : BASE_DRIVES}
        circleDrives={
          counts.collaborative > 0 ? COLLAB_DRIVES : NO_PERMISSIONS
        }
        permissions={
          counts.collaborative > 0
            ? COLLABORATION_PERMISSIONS
            : NO_PERMISSIONS
        }
      />
    </div>
  );
}
