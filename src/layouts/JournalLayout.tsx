import { Outlet, useParams, useNavigate, useSearchParams } from "react-router-dom";
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
import { useState, useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CreateFolderModal,
  SearchModal,
  SettingsModal,
  ShareDialog,
  ExtendPermissionDialog,
} from "@/components/modals";
import { 
  JOURNAL_APP_ID, 
  JOURNAL_APP_NAME,  
} from "@/lib/homebase/config";
import { journalDriveRequest } from "@/hooks/auth/useYouAuthAuthorization";
import type { SearchIndexEntry } from "@/types";
import { useNotes, useNotesByFolder } from "@/hooks/useNotes";
import { clearAllLocalData } from "@/lib/db";
import { useAuth } from "@/hooks/auth";
import { useFolders } from "@/hooks/useFolders";
import { useThemePreference } from "@/hooks/useThemePreference";

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

  // Modal states
  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [shareNote, setShareNote] = useState<SearchIndexEntry | null>(null);

  // Handle App Shortcuts (PWA)
  const [searchParams, setSearchParams] = useSearchParams();
  const action = searchParams.get("action");

  useEffect(() => {
    const handleAction = async () => {
        if (!action) return;

        if (action === "search") {
            setShowSearch(true);
        } else if (action === "new") {
            const targetFolderId = folderId || folders[0]?.id;

            if (targetFolderId) {
                // Create note directly
                const { docId, folderId: newFolderId } = await createNote(targetFolderId);

                if (docId) {
                    navigate(`/${newFolderId}/${docId}`, { viewTransition: true });
                }
            }
        }

        // Clear the action param
        setSearchParams((params: URLSearchParams) => {
            params.delete("action");
            return params;
        }, { replace: true });
    };

    handleAction();
  }, [action, folders, folderId, createNote, navigate, setSearchParams]);

  // Keyboard shortcuts (Cmd+K for search)
  useKeyboardShortcuts({
    onSearch: () => setShowSearch(true),
  });

  // Device type detection
  const deviceType = useDeviceType();
  const isDesktop = deviceType === "desktop";
  // If not desktop (so mobile or tablet), treat as mobile layout

  const { data: filteredNotes = [], isLoading: isFilteredNotesLoading } = useNotesByFolder(folderId);

  // Open tab when navigating to a note
  useEffect(() => {
    if (noteId) {
      const note = notes.find((n) => n.docId === noteId);
      if (note) {
        openTab(noteId, note.title || "Untitled");
      }
    }
  }, [noteId, notes, openTab]);

  // Update tab title when note title changes
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
          navigate(`/${note.metadata.folderId}/${nextTab.docId}`, { viewTransition: true });
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
      {/* Sidebar */}
      <div
        className={cn(
          "h-full border-r bg-muted/10 transition-all duration-300 ease-in-out pb-[env(safe-area-inset-bottom)]",
          // Desktop: Always visible
          isDesktop ? "flex static" : "hidden",
          // Mobile: Visible only when no folder selected (root)
          !isDesktop &&
            !isFolderSelected &&
            "flex absolute inset-0 z-30 w-full bg-background"
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
          onSearch={() => setShowSearch(true)}
          onSettings={() => setShowSettings(true)}
          onLogout={handleLogout}
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
            "flex absolute inset-0 z-20 w-full"
        )}
      >
        <div className="flex flex-col h-full w-full max-w-full min-w-0 overflow-hidden">
          {/* Mobile Header for NoteList */}
          <div
            className={cn(
              "flex items-center h-12 px-3 border-b border-border gap-2 shrink-0",
              isDesktop && "hidden"
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
            notes={filteredNotes}
            selectedNoteId={noteId || null}
            onSelectNote={(id) => navigate(`/${folderId}/${id}`, { viewTransition: true })}
            onCreateNote={async () => {
              const { docId, folderId: newFolderId } = await createNote(
                folderId
              );
              if (docId) navigate(`/${newFolderId}/${docId}`, { viewTransition: true });
            }}
            onDeleteNote={async (id) => {
              // Find the next note to select
              const currentIndex = filteredNotes.findIndex(
                (n) => n.docId === id
              );
              let nextNoteId: string | null = null;

              if (currentIndex !== -1 && filteredNotes.length > 1) {
                if (currentIndex < filteredNotes.length - 1) {
                  // Select next note
                  nextNoteId = filteredNotes[currentIndex + 1].docId;
                } else {
                  // Select previous note if we are deleting the last one
                  nextNoteId = filteredNotes[currentIndex - 1].docId;
                }
              }

              // Also close the tab if it's open
              closeTab(id);

              await deleteNote(id);

              // If the deleted note is the one currently open, navigate to next note or folder
              if (noteId === id) {
                if (nextNoteId) {
                  navigate(`/${folderId}/${nextNoteId}`, { viewTransition: true });
                } else {
                  navigate(`/${folderId}`, { viewTransition: true });
                }
              }
            }}
            onShareNote={(note) => setShareNote(note)}
            isLoading={isFilteredNotesLoading}
            className="flex-1 w-full border-r-0"
          />
        </div>
      </div>

      {/* Main Content (Editor) */}
      <main
        className={cn(
          "flex-1 flex flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
          // Desktop: Always visible (Outlet renders Editor or Empty)
          isDesktop ? "flex" : "hidden",
          // Mobile: Visible only when note is selected
          !isDesktop &&
            isNoteSelected &&
            "flex absolute inset-0 z-10 w-full h-full"
        )}
      >
        {/* Desktop Tab Bar */}
        <div className={isDesktop ? "flex items-center" : "hidden"}>
          <TabBar
            tabs={openTabs}
            activeTabId={activeTabId}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
          />
          {/* Sync Status Indicator */}
          <SyncStatus className="ml-auto px-3" />
        </div>

        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>

      {/* Modals */}
      {noteId && <ChatBot activeNoteId={noteId} />}

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

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {shareNote && (
        <ShareDialog
          isOpen={!!shareNote}
          onClose={() => setShareNote(null)}
          noteId={shareNote.docId}
          noteTitle={shareNote.title || "Untitled"}
        />
      )}

      <ExtendPermissionDialog 
        appId={JOURNAL_APP_ID}
        appName={JOURNAL_APP_NAME}
        drives={[journalDriveRequest]}
        circleDrives={[]}
        permissions={[]}
      />
    </div>
  );
}
