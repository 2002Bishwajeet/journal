import { useState } from "react";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse";
import { useDeviceType } from "@/hooks/useDeviceType";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  FolderOpen,
  Globe,
  Hash,
  Plus,
  Search,
  Settings,
  LogOut,
  Trash2,
  Pencil,
  Archive,
  Users,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { FEATURES } from "@/lib/featureFlags";
import { MAIN_FOLDER_ID, PSEUDO_FOLDERS } from "@/lib/homebase/config";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ContextMenuWrapper, RowOptionsMenu, type ContextMenuItemConfig } from "@/components/ui/context-menu-wrapper";
import { ConfirmDialog, ShareFolderDialog, SignOutConfirmDialog } from "@/components/modals";
import { cn } from "@/lib/utils";
import type { Folder } from "@/types";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { useSyncService } from "@/hooks/useSyncService";
import { useSharedPull } from "@/hooks/useSharedPull";
import { OwnerImage } from "@/components/author/AuthorImage";
import { folderInitials } from "@/lib/folderInitials";

interface SidebarProps {
  folders: Folder[];
  selectedFolderId: string;
  onSelectFolder: (folderId: string) => void;
  onCreateFolder: () => void;
  onDeleteFolder?: (id: string) => void;
  onRenameFolder?: (id: string) => void;
  onOpenToday?: () => void;
  collaborativeCount?: number;
  onSelectShared?: () => void;
  onSelectTrash?: () => void;
  trashCount?: number;
  onSelectArchive?: () => void;
  archivedCount?: number;
  onSearch: () => void;
  onSettings: () => void;
  onLogout: () => void;
  tags?: string[];
  /** Number of notes (trashed and archived included) carrying each tag. */
  tagCounts?: Record<string, number>;
  selectedTag?: string | null;
  onSelectTag?: (tag: string | null) => void;
  onDeleteTag?: (tag: string) => void;
  className?: string;
}

function SectionChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <ChevronDown
      className={cn("h-3 w-3 shrink-0 transition-transform", collapsed && "-rotate-90")}
    />
  );
}

export default function Sidebar({
  folders,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  onOpenToday,
  onSearch,
  onSettings,
  onLogout,
  collaborativeCount,
  onSelectShared,
  onSelectTrash,
  trashCount,
  onSelectArchive,
  archivedCount,
  tags,
  tagCounts,
  selectedTag,
  onSelectTag,
  onDeleteTag,
  className = "",
}: SidebarProps) {
  const { collapsed, toggle } = useSidebarCollapse();
  // The rail only exists on desktop; phones and tablets show the sidebar as a full pane.
  const deviceType = useDeviceType();
  const isDesktop = deviceType === "desktop";
  // On a phone, Shared and Settings are tabs in the bottom bar (#853).
  const isPhone = deviceType === "mobile";
  const isCollapsed = collapsed.sidebar && isDesktop;
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [shareFolderId, setShareFolderId] = useState<string | null>(null);
  const [tagToDelete, setTagToDelete] = useState<string | null>(null);
  const tagToDeleteCount = tagToDelete ? tagCounts?.[tagToDelete] ?? 0 : 0;
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const { sync, pendingCount } = useSyncService();
  const sharedPull = useSharedPull();
  const hasShared = collaborativeCount != null && collaborativeCount > 0;

  const handleRefresh = async () => {
    // The folder list is a live query — a sync pull surfaces new folders automatically.
    await sync();
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        aria-label="Sidebar"
        className={cn(
          "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-200 overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
          // Fixed widths on desktop, so the width transition runs between two lengths, not from a percentage.
          isCollapsed ? "w-full lg:w-14 items-center" : "w-full lg:w-60", // Centered items when collapsed
          className
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex items-center h-12 border-b border-sidebar-border shrink-0",
            isCollapsed
              ? "justify-center w-full px-0"
              : "px-3 gap-2 justify-between"
          )}
        >
          {!isCollapsed && (
            <div className="flex items-center gap-2">
               <OwnerImage size="xs" />
               <span className="text-sm font-semibold text-sidebar-foreground">
                 Journal
               </span>
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className={cn("h-7 w-7 pointer-coarse:size-11", !isCollapsed && "hidden lg:inline-flex")}
                onClick={() => toggle("sidebar")}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isCollapsed ? "Expand" : "Collapse"}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Search */}
        <div className="px-2 py-2">
          <Button
            variant="ghost"
            aria-label={isCollapsed ? "Search" : undefined}
            className={cn(
              "text-muted-foreground transition-all duration-200",
              isCollapsed ? "size-9 px-0" : "w-full justify-start px-2 pointer-coarse:min-h-11"
            )}
            onClick={onSearch}
          >
            <Search className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span className="ml-2 text-sm">Search</span>}
          </Button>
        </div>

        {/* Quick actions */}
        {FEATURES.dailyNotes && (
          <div className="px-2 pb-2 space-y-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Open today's daily note"
                  className={cn(
                    "text-muted-foreground transition-all duration-200",
                    isCollapsed ? "size-9 px-0" : "w-full justify-start px-2 pointer-coarse:min-h-11"
                  )}
                  onClick={onOpenToday}
                >
                  <CalendarDays className="h-4 w-4 shrink-0" />
                  {!isCollapsed && <span className="ml-2 text-sm">Today</span>}
                </Button>
              </TooltipTrigger>
              {isCollapsed && <TooltipContent side="right">Today</TooltipContent>}
            </Tooltip>
          </div>
        )}

        <Separator />

        {/* Radix wraps the content in a display:table div that grows to the longest folder name; block keeps names truncating. */}
        <ScrollArea
          className={cn(
            "flex-1 min-h-0 w-full [&_[data-slot=scroll-area-viewport]>div]:!block",
            // A thinner scrollbar in the rail, so it never covers a tile's badge.
            isCollapsed && "[&_[data-slot=scroll-area-scrollbar]]:w-1.5"
          )}
        >
          <PullToRefresh onRefresh={handleRefresh} className="min-h-full">
          {!isPhone && (hasShared || sharedPull.canPull) && (
            <div className={cn("px-2 pt-2 pb-1 flex", isCollapsed ? "justify-center" : "items-center gap-1")}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={selectedFolderId === PSEUDO_FOLDERS.shared ? "secondary" : "ghost"}
                    aria-label={isCollapsed ? "Shared with me" : undefined}
                    className={cn(
                      "group relative transition-all duration-200 flex items-center",
                      isCollapsed ? "size-9 px-0" : "flex-1 min-w-0 h-10 justify-start px-2 pointer-coarse:min-h-11",
                      selectedFolderId === PSEUDO_FOLDERS.shared && "bg-accent text-accent-foreground font-medium hover:bg-accent"
                    )}
                    onClick={onSelectShared}
                  >
                    <Users
                      className={cn(
                        "h-4 w-4 shrink-0 text-collaborative",
                        !isCollapsed && "mr-2"
                      )}
                    />
                    {!isCollapsed && (
                      <>
                        <span className="text-sm truncate flex-1 text-left">Shared with me</span>
                        {hasShared && (
                          <span className="ml-auto text-xs bg-collaborative text-white px-1.5 py-0.5 rounded-full font-medium">
                            {collaborativeCount}
                          </span>
                        )}
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                {isCollapsed && (
                  <TooltipContent side="right">
                    Shared with me ({collaborativeCount ?? 0})
                  </TooltipContent>
                )}
              </Tooltip>
              {!isCollapsed && sharedPull.canPull && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Refresh shared notes"
                      aria-busy={sharedPull.isRefreshing}
                      className="size-8 pointer-coarse:size-11 shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={sharedPull.refresh}
                    >
                      <RefreshCw className={cn("h-4 w-4", sharedPull.isRefreshing && "animate-spin")} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Refresh shared notes</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
          <div className="px-2 py-2">
            <div
              className={cn(
                "flex items-center mb-1 transition-all duration-200",
                isCollapsed ? "justify-center px-0" : "justify-between px-2"
              )}
            >
              {!isCollapsed && (
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wide pointer-coarse:min-h-11"
                  aria-expanded={!collapsed.folders}
                  aria-controls="sidebar-folders"
                  onClick={() => toggle("folders")}
                >
                  <SectionChevron collapsed={collapsed.folders} />
                  Folders
                </button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="New folder"
                    className={cn(
                      "shrink-0",
                      isCollapsed
                        ? "size-9 rounded-lg border border-dashed border-sidebar-border text-muted-foreground hover:border-solid hover:text-foreground"
                        : "h-6 w-6 pointer-coarse:size-11"
                    )}
                    onClick={onCreateFolder}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">New folder</TooltipContent>
              </Tooltip>
            </div>

            {isCollapsed && <Separator className="mx-auto my-2 w-6!" />}
            <nav
              id="sidebar-folders"
              aria-label="Folders"
              hidden={!isCollapsed && collapsed.folders}
              className={isCollapsed ? "flex flex-col items-center gap-1.5" : "space-y-0.5"}
            >
              {folders.map((folder) => {
                const folderMenuItems: ContextMenuItemConfig[] = [
                  ...(folder.id !== MAIN_FOLDER_ID
                    ? [
                        { label: "Rename Folder", icon: Pencil, action: () => onRenameFolder?.(folder.id) },
                        { label: "Share folder…", icon: Globe, action: () => setShareFolderId(folder.id) },
                      ]
                    : []),
                  { label: "Delete Folder", icon: Trash2, action: () => setFolderToDelete(folder.id), variant: "destructive" as const },
                ];
                const isSelected = selectedFolderId === folder.id;
                return (
                  <ContextMenuWrapper key={folder.id} items={folderMenuItems}>
                    <div className={cn("flex", isCollapsed ? "justify-center" : "w-full")}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant={isSelected ? "secondary" : "ghost"}
                            className={cn(
                              "group relative transition-all duration-200 flex items-center",
                              isCollapsed
                                ? // The button is the tile, so its focus ring and the badge are never clipped by an inner box.
                                  "size-9 px-0 rounded-lg border text-[11px] font-semibold tracking-wide"
                                : "w-full min-w-0 shrink h-10 justify-start px-2 pointer-coarse:min-h-11 [-webkit-touch-callout:none]",
                              // Light mode needs a stronger edge and darker letters than the muted tokens give on the sidebar (4.5:1 text).
                              isCollapsed && !isSelected &&
                                "border-muted-foreground/50 text-sidebar-foreground/80 hover:text-sidebar-foreground dark:border-sidebar-border dark:text-muted-foreground dark:hover:text-foreground",
                              isSelected &&
                                (isCollapsed
                                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground dark:hover:bg-primary/90"
                                  : "bg-accent text-accent-foreground font-medium hover:bg-accent")
                            )}
                            onClick={() => onSelectFolder(folder.id)}
                            aria-current={isSelected ? "page" : undefined}
                            aria-label={isCollapsed ? folder.name : undefined}
                            aria-description={folder.isPublic ? "Shared publicly" : undefined}
                          >
                            {isCollapsed ? (
                              <>
                                {/* Two letters, so folders that share a first letter still look different. */}
                                <span aria-hidden>{folderInitials(folder.name)}</span>
                                {folder.isPublic && (
                                  <span
                                    aria-hidden
                                    data-testid="folder-public-badge"
                                    className="absolute -bottom-1 -right-0.5 flex size-4 items-center justify-center rounded-full bg-sidebar text-sidebar-foreground/80 ring-1 ring-muted-foreground/50"
                                  >
                                    <Globe className="size-3" />
                                  </span>
                                )}
                              </>
                            ) : (
                              <FolderOpen
                                className={cn("h-4 w-4 shrink-0 mr-2", isSelected && "text-primary")}
                              />
                            )}
                            {!isCollapsed && (
                              <span className="text-sm truncate flex-1 text-left" title={folder.name}>
                                {folder.name}
                              </span>
                            )}
                            {!isCollapsed && folder.isPublic && (
                              <Globe aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        {isCollapsed && (
                          <TooltipContent side="right">
                            {folder.name}{folder.isPublic ? " · Shared publicly" : ""}
                          </TooltipContent>
                        )}
                      </Tooltip>
                      {!isCollapsed && (
                        <RowOptionsMenu items={folderMenuItems} label="Folder options" />
                      )}
                    </div>
                  </ContextMenuWrapper>
                );
              })}
            </nav>
          </div>

          {!isCollapsed && tags && tags.length > 0 && (
            <>
              <Separator className="my-2" />
              <div className="px-2 py-2">
                <div className="flex items-center justify-between px-2 mb-1">
                  <button
                    type="button"
                    className="flex items-center gap-1 min-w-0 flex-1 text-xs font-medium text-muted-foreground uppercase tracking-wide pointer-coarse:min-h-11"
                    aria-expanded={!collapsed.tags}
                    aria-controls="sidebar-tags"
                    onClick={() => toggle("tags")}
                  >
                    <SectionChevron collapsed={collapsed.tags} />
                    <span className="truncate">
                      Tags{collapsed.tags && selectedTag ? ` · #${selectedTag}` : ""}
                    </span>
                  </button>
                </div>
                <nav
                  id="sidebar-tags"
                  aria-label="Tags"
                  hidden={collapsed.tags}
                  className="space-y-0.5"
                >
                  {tags.map(tag => (
                    <ContextMenu key={tag}>
                      <ContextMenuTrigger asChild>
                        <Button
                          variant={selectedTag === tag ? "secondary" : "ghost"}
                          className={cn(
                            "w-full h-8 pointer-coarse:min-h-11 justify-start px-2 text-sm",
                            selectedTag === tag && "bg-accent text-accent-foreground font-medium"
                          )}
                          onClick={() => onSelectTag?.(selectedTag === tag ? null : tag)}
                        >
                          <Hash className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                          <span className="truncate">{tag}</span>
                        </Button>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTagToDelete(tag);
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete tag
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </nav>
              </div>
            </>
          )}
          </PullToRefresh>
        </ScrollArea>

        <ConfirmDialog
          isOpen={!!folderToDelete}
          onClose={() => setFolderToDelete(null)}
          onConfirm={() => {
            if (folderToDelete) {
              onDeleteFolder?.(folderToDelete);
            }
          }}
          title="Delete Folder?"
          description="Are you sure you want to delete this folder? All notes in this folder will also be permanently deleted. This action cannot be undone."
          confirmText="Delete"
        />

        <ShareFolderDialog folder={folders.find((f) => f.id === shareFolderId) ?? null} onClose={() => setShareFolderId(null)} />

        <ConfirmDialog
          isOpen={!!tagToDelete}
          onClose={() => setTagToDelete(null)}
          onConfirm={() => {
            if (!tagToDelete) return;
            if (selectedTag === tagToDelete) onSelectTag?.(null);
            onDeleteTag?.(tagToDelete);
          }}
          title="Delete tag?"
          description={tagToDelete
            ? `Remove #${tagToDelete} from ${tagToDeleteCount} ${tagToDeleteCount === 1 ? "note" : "notes"}? The notes themselves are kept.`
            : ""}
          confirmText="Delete"
        />

        <SignOutConfirmDialog
          isOpen={showLogoutConfirm}
          onClose={() => setShowLogoutConfirm(false)}
          onConfirm={onLogout}
          pendingTotal={pendingCount.total + pendingCount.failed}
        />

        {/* Footer */}
        <div
          className={cn(
            "shrink-0 space-y-1",
            isCollapsed
              ? "p-2 w-full flex flex-col items-center"
              : "p-2 pb-[calc(0.5rem+var(--fab-clearance,0px))] mt-auto"
          )}
        >
          <Separator className={isCollapsed ? "mb-2 w-6!" : "mb-2"} />

          <Tooltip>
            {/* Archive */}
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  isCollapsed
                    ? "h-9 w-9 justify-center px-0"
                    : "w-full justify-start px-2 h-8 pointer-coarse:min-h-11 text-muted-foreground",
                  selectedFolderId === PSEUDO_FOLDERS.archive &&
                    "bg-accent text-accent-foreground font-medium hover:bg-accent"
                )}
                aria-label={isCollapsed ? "Archive" : undefined}
                onClick={onSelectArchive}
              >
                <Archive className="h-4 w-4" />
                {!isCollapsed && (
                  <>
                    <span className="ml-2 text-sm flex-1 text-left">Archive</span>
                    {archivedCount != null && archivedCount > 0 && (
                      <span className="ml-auto text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">
                        {archivedCount}
                      </span>
                    )}
                  </>
                )}
              </Button>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">
                Archive{archivedCount ? ` (${archivedCount})` : ''}
              </TooltipContent>
            )}
          </Tooltip>

          <Tooltip>
            {/* Trash */}
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  isCollapsed
                    ? "h-9 w-9 justify-center px-0"
                    : "w-full justify-start px-2 h-8 pointer-coarse:min-h-11 text-muted-foreground",
                  selectedFolderId === PSEUDO_FOLDERS.trash &&
                    "bg-accent text-accent-foreground font-medium hover:bg-accent"
                )}
                aria-label={isCollapsed ? "Trash" : undefined}
                onClick={onSelectTrash}
              >
                <Trash2 className="h-4 w-4" />
                {!isCollapsed && (
                  <>
                    <span className="ml-2 text-sm flex-1 text-left">Trash</span>
                    {trashCount != null && trashCount > 0 && (
                      <span className="ml-auto text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">
                        {trashCount}
                      </span>
                    )}
                  </>
                )}
              </Button>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">
                Trash{trashCount ? ` (${trashCount})` : ''}
              </TooltipContent>
            )}
          </Tooltip>

          {!isPhone && (
            <Tooltip>
              {/* Settings */}
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    isCollapsed
                      ? "h-9 w-9 justify-center px-0"
                      : "w-full justify-start px-2 h-8 pointer-coarse:min-h-11 text-muted-foreground"
                  )}
                  aria-label={isCollapsed ? "Settings" : undefined}
                  onClick={onSettings}
                >
                  <Settings className="h-4 w-4" />
                  {!isCollapsed && <span className="ml-2 text-sm">Settings</span>}
                </Button>
              </TooltipTrigger>
              {isCollapsed && (
                <TooltipContent side="right">Settings</TooltipContent>
              )}
            </Tooltip>
          )}

          <Tooltip>
            {/* Logout */}
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  isCollapsed
                    ? "h-9 w-9 justify-center px-0 text-destructive"
                    : "w-full justify-start px-2 h-8 pointer-coarse:min-h-11 text-destructive hover:text-destructive"
                )}
                aria-label={isCollapsed ? "Log out" : undefined}
                onClick={() => setShowLogoutConfirm(true)}
              >
                <LogOut className="h-4 w-4" />
                {!isCollapsed && <span className="ml-2 text-sm">Log out</span>}
              </Button>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">Log out</TooltipContent>
            )}
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
