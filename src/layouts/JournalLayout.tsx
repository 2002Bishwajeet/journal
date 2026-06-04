import {
  Outlet,
  useParams,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  Sidebar,
  NoteList,
  ChatBot,
  TabBar,
  SyncStatus,
  SplashScreen,
} from "@/components/layout";
import {
  useTabManager,
  useSessionPersistence,
  useDeviceType,
  useSyncService,
  useKeyboardShortcuts,
} from "@/hooks";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, lazy, Suspense, useMemo, Activity } from "react";
import { ChevronLeft, Minimize2, Maximize2 } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
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
  MAIN_FOLDER_ID,
  COLLABORATION_PERMISSIONS,
  CONTACT_TARGET_DRIVE_REQUEST,
} from "@/lib/homebase/config";
import type { NoteListEntry } from "@/types";
import {
  useNotes,
  useNotesByFolder,
  useCollaborativeNotes,
  notesQueryKey,
} from "@/hooks/useNotes";
import { useTags, useNotesByTag } from "@/hooks/useTags";
import { clearAllLocalData } from "@/lib/db";
import { useAuth } from "@/hooks/auth";
import { useFolders } from "@/hooks/useFolders";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useDotYouClientContext } from "@/components/auth";
import { NotesDriveProvider } from "@/lib/homebase/NotesDriveProvider";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import EditorPage from "@/pages/EditorPage";
import { journalDriveRequest } from "@/hooks/auth/useYouAuthAuthorization";

const BASE_DRIVES = [journalDriveRequest];
const COLLAB_DRIVES = [journalDriveRequest, CONTACT_TARGET_DRIVE_REQUEST];
const NO_PERMISSIONS: [] = [];

export default function JournalLayout() {
  // Initialize theme preference & system listener at root level
  useThemePreference();

  const { folderId, noteId } = useParams();
  const navigate = useNavigate();

  const { logout } = useAuth();

  const handleLogout = async () => {
    // Clear all local data to prevent mixing between identities
    await clearAllLocalData();
    await logout();
  };

  const {
    get: { data: notes = [], isLoading: isNotesLoading },
    createNote: { mutateAsync: createNote },
    deleteNote: { mutateAsync: deleteNote },
    updateNote: { mutateAsync: updateNoteMetadata },
  } = useNotes();

  const {
    get: { data: folders = [], isLoading: isFolderLoading },
    createFolder: { mutateAsync: createNewFolder },
    deleteFolder: { mutate: deleteFolder },
  } = useFolders();

  // Tab management
  const {
    openTabs,
    activeTabId,
    openTab,
    closeTab,
    switchTab,
    updateTabTitle,
  } = useTabManager();

  // Session persistence
  useSessionPersistence();

  // Homebase sync - auto-syncs on mount and focus
  useSyncService();

  const queryClient = useQueryClient();
  const dotYouClient = useDotYouClientContext();

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

  // Handle App Shortcuts (PWA)
  const [searchParams, setSearchParams] = useSearchParams();
  const action = searchParams.get("action");

  const notesRef = useRef(notes);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const collaborativeTabIds = useMemo(
    () =>
      new Set(
        notes.filter((n) => n.metadata.isCollaborative).map((n) => n.docId),
      ),
    [notes],
  );

  // Handle pending collaborative note from localStorage (after permission redirect)
  useEffect(() => {
    if (notes.length === 0) return;
    try {
      const pendingNoteId = localStorage.getItem("pendingCollaborativeNoteId");
      if (!pendingNoteId) return;
      const note = notes.find((n) => n.docId === pendingNoteId);
      if (!note) return;
      localStorage.removeItem("pendingCollaborativeNoteId");
      queueMicrotask(() => setCollaborativeNote(note));
    } catch {
      /* private browsing */
    }
  }, [notes]);

  // Handle URL action params (PWA shortcuts, permission redirects)
  useEffect(() => {
    if (!action) return;

    const handleAction = async () => {
      if (action === "search") {
        setShowSearch(true);
      } else if (action === "new") {
        const targetFolderId = folderId || folders[0]?.id;
        if (targetFolderId) {
          const { docId, folderId: newFolderId } =
            await createNote(targetFolderId);
          if (docId) {
            navigate(`/${newFolderId}/${docId}`, { viewTransition: true });
          }
        }
      } else if (action === "collaborate") {
        const collaborateNoteId = searchParams.get("noteId");
        if (collaborateNoteId) {
          const currentNotes = notesRef.current;
          if (currentNotes.length === 0) return;
          const note = currentNotes.find((n) => n.docId === collaborateNoteId);
          if (note) {
            setCollaborativeNote(note);
          }
        }
      }

      setSearchParams(
        (params: URLSearchParams) => {
          params.delete("action");
          params.delete("noteId");
          return params;
        },
        { replace: true },
      );
    };

    handleAction();
  }, [
    action,
    folders,
    folderId,
    createNote,
    navigate,
    setSearchParams,
    searchParams,
  ]);

  // Keyboard shortcuts (Cmd+K for search)
  useKeyboardShortcuts({
    onSearch: () => setShowSearch(true),
    onKeyboardHelp: () => setShowKeyboardHelp(true),
    onFocusMode: () => setFocusMode((prev) => !prev),
  });

  // Device type detection
  const deviceType = useDeviceType();
  const isDesktop = deviceType === "desktop";
  // If not desktop (so mobile or tablet), treat as mobile layout

  const { data: filteredNotes = [], isLoading: isFilteredNotesLoading } =
    useNotesByFolder(folderId);
  const { data: collaborativeNotes = [], isLoading: isCollaborativeLoading } =
    useCollaborativeNotes();

  const selectedTag = searchParams.get("tag");
  const { tags } = useTags();
  const { data: tagFilteredNotes } = useNotesByTag(selectedTag);
  const notesToShow = selectedTag
    ? (tagFilteredNotes ?? [])
    : folderId === "shared"
      ? collaborativeNotes
      : filteredNotes;
  const isNotesToShowLoading =
    folderId === "shared" ? isCollaborativeLoading : isFilteredNotesLoading;

  // Open tab when noteId changes (URL navigation, back/forward)
  useEffect(() => {
    if (noteId) {
      const note = notesRef.current.find((n) => n.docId === noteId);
      openTab(noteId, note?.title || "Untitled");
    }
  }, [noteId, openTab]);

  // Sync tab titles when notes data changes
  useEffect(() => {
    if (activeTabId) {
      const note = notes.find((n) => n.docId === activeTabId);
      if (note) {
        updateTabTitle(activeTabId, note.title || "Untitled");
      }
    }
  }, [notes, activeTabId, updateTabTitle]);

  // Handle tab click - navigate to the note
  const handleTabClick = (docId: string) => {
    const note = notes.find((n) => n.docId === docId);
    if (note) {
      navigate(`/${note.metadata.folderId}/${docId}`, { viewTransition: true });
      switchTab(docId);
    }
  };

  // Handle tab close
  const handleTabClose = (docId: string) => {
    closeTab(docId);

    // If closing the active tab, navigate to another open tab or folder
    if (docId === noteId) {
      const remainingTabs = openTabs.filter((t) => t.docId !== docId);
      if (remainingTabs.length > 0) {
        const nextTab = remainingTabs[remainingTabs.length - 1];
        const note = notes.find((n) => n.docId === nextTab.docId);
        if (note) {
          navigate(`/${note.metadata.folderId}/${nextTab.docId}`, {
            viewTransition: true,
          });
        }
      } else if (folderId) {
        navigate(`/${folderId}`, { viewTransition: true });
      }
    }
  };

  const isNoteSelected = !!noteId;
  const isFolderSelected = !!folderId;

  if (isNotesLoading || isFolderLoading) {
    return <SplashScreen />;
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
          // Mobile: Visible only when no folder selected (root)
          !isDesktop &&
            !isFolderSelected &&
            "flex absolute inset-0 z-30 w-full bg-background",
          focusMode && "hidden!",
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
          collaborativeCount={collaborativeNotes.length}
          onSelectShared={() => navigate("/shared")}
          onSearch={() => setShowSearch(true)}
          onSettings={() => setShowSettings(true)}
          onLogout={handleLogout}
          tags={tags}
          selectedTag={selectedTag}
          onSelectTag={(tag) => {
            if (tag) {
              navigate(`/?tag=${encodeURIComponent(tag)}`);
            } else {
              navigate(folderId ? `/${folderId}` : "/");
            }
          }}
          className="w-full h-full"
        />
      </div>

      {/* Note List */}
      <div
        className={cn(
          "h-full border-r bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
          // Desktop: Always visible, static positioning (part of flex flow)
          isDesktop ? "flex w-64 static shrink-0" : "hidden",
          // Mobile: Visible when folder selected but no note selected (Absolute covering screen)
          !isDesktop &&
            isFolderSelected &&
            !isNoteSelected &&
            "flex absolute inset-0 z-20 w-full",
          focusMode && "hidden!",
        )}
      >
        <div className="flex flex-col h-full w-full max-w-full min-w-0 overflow-hidden">
          {/* Mobile Header for NoteList */}
          <div
            className={cn(
              "flex items-center h-12 px-3 border-b border-border gap-2 shrink-0",
              isDesktop && "hidden",
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => navigate("/")}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h2 className="text-sm font-medium truncate flex-1 leading-none">
              {folders.find((f) => f.id === folderId)?.name || "Notes"}
            </h2>
            <SyncStatus />
          </div>

          <NoteList
            notes={notesToShow}
            selectedNoteId={noteId || null}
            onSelectNote={(id) => {
              const note = notesToShow.find((n) => n.docId === id);
              const targetFolder = note?.metadata.folderId || folderId;
              if (selectedTag) {
                navigate(
                  `/${targetFolder}/${id}?tag=${encodeURIComponent(selectedTag)}`,
                  { viewTransition: true },
                );
              } else {
                navigate(`/${folderId}/${id}`, { viewTransition: true });
              }
            }}
            onCreateNote={async () => {
              const { docId, folderId: newFolderId } =
                await createNote(folderId);
              if (docId)
                navigate(`/${newFolderId}/${docId}`, { viewTransition: true });
            }}
            onDeleteNote={async (id) => {
              // Find the next note to select
              const currentIndex = notesToShow.findIndex((n) => n.docId === id);
              let nextNoteId: string | null = null;

              if (currentIndex !== -1 && notesToShow.length > 1) {
                if (currentIndex < notesToShow.length - 1) {
                  // Select next note
                  nextNoteId = notesToShow[currentIndex + 1].docId;
                } else {
                  // Select previous note if we are deleting the last one
                  nextNoteId = notesToShow[currentIndex - 1].docId;
                }
              }

              // Also close the tab if it's open
              closeTab(id);

              await deleteNote(id);

              // If the deleted note is the one currently open, navigate to next note or folder
              if (noteId === id) {
                if (nextNoteId) {
                  navigate(`/${folderId}/${nextNoteId}`, {
                    viewTransition: true,
                  });
                } else {
                  navigate(`/${folderId}`, { viewTransition: true });
                }
              }
            }}
            onShareNote={(note) => setShareNote(note)}
            onMarkCollaborative={(note) => {
              if (note.metadata.isCollaborative) {
                setRevokeNote(note);
              } else {
                setCollaborativeNote(note);
              }
            }}
            isLoading={isNotesToShowLoading}
            className="flex-1 w-full border-r-0"
          />
        </div>
      </div>

      {/* Main Content (Editor) */}
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          "flex-1 flex flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
          // Desktop: Always visible (Outlet renders Editor or Empty)
          isDesktop ? "flex" : "hidden",
          // Mobile: Visible only when note is selected
          !isDesktop &&
            isNoteSelected &&
            "flex absolute inset-0 z-10 w-full h-full",
        )}
      >
        {/* Desktop Tab Bar — hidden in focus mode */}
        <div
          className={cn(
            isDesktop ? "flex items-center" : "hidden",
            focusMode && "hidden!",
          )}
        >
          <TabBar
            tabs={openTabs}
            activeTabId={activeTabId}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            collaborativeTabIds={collaborativeTabIds}
          />
          <div className="flex items-center ml-auto gap-1 px-3">
            {noteId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setFocusMode(true)}
                title="Focus Mode (Cmd+Shift+F)"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <SyncStatus />
          </div>
        </div>

        <div className="flex-1 relative overflow-hidden">
          {isDesktop ? (
            /* Desktop DOM Keep-Alive implementation */
            openTabs.map((tab) => (
              <Activity
                key={tab.docId}
                mode={tab.docId === activeTabId ? "visible" : "hidden"}
              >
                <div
                  className={cn(
                    "absolute inset-0 w-full h-full",
                    tab.docId === activeTabId && "z-10 bg-background",
                  )}
                >
                  <EditorPage
                    overrideNoteId={tab.docId}
                    overrideFolderId={folderId}
                    focusMode={focusMode}
                  />
                </div>
              </Activity>
            ))
          ) : (
            /* Mobile keeps the simple Router Outlet behavior */
            <Outlet />
          )}

          {/* Show empty state when no tab is active on desktop */}
          {isDesktop && openTabs.length === 0 && (
            <div className="absolute inset-0 z-0 flex items-center justify-center text-muted-foreground bg-background">
              No notes open
            </div>
          )}
        </div>
      </main>

      {/* Focus mode exit pill — centered top, auto-fades, reveals on hover */}
      {focusMode && (
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
            onClose={() => setCollaborativeNote(null)}
            noteId={collaborativeNote.docId}
            noteTitle={collaborativeNote.title || "Untitled"}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: notesQueryKey });
            }}
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
        onConfirm={async () => {
          if (!revokeNote || !dotYouClient) return;
          try {
            const provider = new NotesDriveProvider(dotYouClient);
            const editorOdinId = dotYouClient.getHostIdentity() || "";
            await provider.revokeNoteCollaboration(
              revokeNote.docId,
              editorOdinId,
            );
            await updateNoteMetadata({
              docId: revokeNote.docId,
              metadata: {
                ...revokeNote.metadata,
                folderId: MAIN_FOLDER_ID,
                isCollaborative: false,
                circleIds: undefined,
                recipients: undefined,
                lastEditedBy: editorOdinId,
              },
            });
            toast.success("Collaboration revoked");
          } catch (err) {
            console.error("Failed to revoke collaboration:", err);
            toast.error("Failed to revoke collaboration");
          }
        }}
      />
      <KeyboardShortcutsModal
        isOpen={showKeyboardHelp}
        onClose={() => setShowKeyboardHelp(false)}
      />

      <ExtendPermissionDialog
        appId={JOURNAL_APP_ID}
        appName={JOURNAL_APP_NAME}
        drives={collaborativeNotes.length > 0 ? COLLAB_DRIVES : BASE_DRIVES}
        circleDrives={
          collaborativeNotes.length > 0 ? COLLAB_DRIVES : NO_PERMISSIONS
        }
        permissions={
          collaborativeNotes.length > 0
            ? COLLABORATION_PERMISSIONS
            : NO_PERMISSIONS
        }
      />
    </div>
  );
}
