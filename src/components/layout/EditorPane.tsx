import { Outlet } from "react-router-dom";
import { Suspense } from "react";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import EditorPage from "@/pages/EditorPage.lazy";
import type { TabInfo } from "@/hooks/useTabManager";
import TabBar from "./TabBar";
import { SyncStatus } from "./SyncStatus";

interface EditorPaneProps {
  isDesktop: boolean;
  isManagementView: boolean;
  isEditorVisibleOnMobile: boolean;
  focusMode: boolean;
  onEnterFocusMode: () => void;
  folderId?: string;
  noteId?: string;
  openTabs: TabInfo[];
  mountedTabs: TabInfo[];
  activeTabId: string | null;
  collaborativeTabIds: Set<string>;
  onTabClick: (docId: string) => void;
  onTabClose: (docId: string) => void;
}

/** Right pane: desktop tab bar plus the (keep-alive) editor, or the mobile Outlet. */
export function EditorPane({
  isDesktop,
  isManagementView,
  isEditorVisibleOnMobile,
  focusMode,
  onEnterFocusMode,
  folderId,
  noteId,
  openTabs,
  mountedTabs,
  activeTabId,
  collaborativeTabIds,
  onTabClick,
  onTabClose,
}: EditorPaneProps) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn(
        "flex-1 flex flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        // Visible focus indicator when reached via the skip-link (WCAG 2.4.7)
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        // Desktop: Always visible (Outlet renders Editor or Empty), except in
        // management views (Trash/Archive) where the list takes the full width.
        isDesktop && !isManagementView ? "flex" : "hidden",
        // Mobile: Visible only when note is selected
        !isDesktop &&
          isEditorVisibleOnMobile &&
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
          onTabClick={onTabClick}
          onTabClose={onTabClose}
          collaborativeTabIds={collaborativeTabIds}
        />
        <div className="flex items-center ml-auto gap-1 px-3">
          {noteId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onEnterFocusMode()}
              title="Focus Mode (Cmd+Shift+F)"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <SyncStatus />
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {/* Local boundaries: the editor chunk is lazy, so both suspending and
            failing here must stay inside the content pane. Without them a
            slow chunk blanks the shell via App's route fallback, and a
            rejected fetch (offline first visit, or a deploy rotating the
            hashed filename under a long-open tab) replaces the entire app —
            sidebar and note list included — with the crash screen. */}
        <ErrorBoundary
          fallback={
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center">
              <p className="text-sm text-muted-foreground">
                The editor failed to load.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                Reload
              </Button>
            </div>
          }
        >
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center bg-background">
              <div className="w-8 h-8 border-4 border-foreground/30 border-t-foreground rounded-full animate-spin" />
            </div>
          }
        >
        {isDesktop ? (
          /* Desktop DOM keep-alive: a tab mounts on first activation and then
             stays mounted, hidden with display:none. <Activity mode="hidden">
             runs effect cleanups, so every switch tore down the note's Yjs
             provider (flush + compaction rewrite) and its editor — losing undo
             history and leaving the re-shown tab on a destroyed Y.Doc. */
          mountedTabs.map((tab) => (
            <div
              key={tab.docId}
              className={cn(
                "absolute inset-0 w-full h-full",
                tab.docId === activeTabId ? "z-10 bg-background" : "hidden",
              )}
            >
              <EditorPage
                overrideNoteId={tab.docId}
                overrideFolderId={folderId}
                focusMode={focusMode}
                onCloseMissing={() => onTabClose(tab.docId)}
              />
            </div>
          ))
        ) : (
          /* Mobile keeps the simple Router Outlet behavior */
          <Outlet />
        )}
        </Suspense>
        </ErrorBoundary>

        {/* Show empty state when no tab is active on desktop */}
        {isDesktop && openTabs.length === 0 && (
          <div className="absolute inset-0 z-0 flex items-center justify-center text-muted-foreground bg-background">
            No notes open
          </div>
        )}
      </div>
    </main>
  );
}
