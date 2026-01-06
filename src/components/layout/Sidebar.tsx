import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Plus,
  Search,
  Settings,
  LogOut,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
import { ConfirmDialog } from "@/components/modals";
import { cn } from "@/lib/utils";
import type { Folder } from "@/types";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { useSyncService } from "@/hooks/useSyncService";
import { useQueryClient } from "@tanstack/react-query";
import { foldersQueryKey } from "@/hooks/useFolders";

interface SidebarProps {
  folders: Folder[];
  selectedFolderId: string;
  onSelectFolder: (folderId: string) => void;
  onCreateFolder: () => void;
  onDeleteFolder?: (id: string) => void;
  onSearch: () => void;
  onSettings: () => void;
  onLogout: () => void;
  className?: string;
}

export default function Sidebar({
  folders,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onDeleteFolder,
  onSearch,
  onSettings,
  onLogout,
  className = "",
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const { sync } = useSyncService();
  const queryClient = useQueryClient();

  const handleRefresh = async () => {
    await sync();
    await queryClient.invalidateQueries({ queryKey: foldersQueryKey });
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-200 overflow-hidden",
          isCollapsed ? "w-14 items-center" : "w-full md:w-60", // Centered items when collapsed
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
            <span className="text-sm font-semibold text-sidebar-foreground">
              Journal
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-7 w-7", isCollapsed ? "flex" : "md:flex")}
                onClick={() => setIsCollapsed(!isCollapsed)}
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
            className={cn(
              "w-full text-muted-foreground transition-all duration-200",
              isCollapsed ? "justify-center px-0" : "justify-start px-2"
            )}
            onClick={onSearch}
          >
            <Search className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span className="ml-2 text-sm">Search</span>}
          </Button>
        </div>

        <Separator />

        <ScrollArea className="flex-1">
          <PullToRefresh onRefresh={handleRefresh} className="min-h-full">
          <div className="px-2 py-2">
            <div
              className={cn(
                "flex items-center mb-1 transition-all duration-200",
                isCollapsed ? "justify-center px-0" : "justify-between px-2"
              )}
            >
              {!isCollapsed && (
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Folders
                </span>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={onCreateFolder}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">New folder</TooltipContent>
              </Tooltip>
            </div>

            <nav className="space-y-0.5">
              {folders.map((folder) => {
                const isSelected = selectedFolderId === folder.id;
                return (
                  <ContextMenu key={folder.id}>
                    <ContextMenuTrigger className="w-full flex">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant={isSelected ? "secondary" : "ghost"}
                            className={cn(
                              "w-full h-8 group relative transition-all duration-200 flex items-center",
                              isCollapsed
                                ? "justify-center px-0"
                                : "justify-start px-2",
                              isSelected &&
                                "bg-accent text-accent-foreground font-medium hover:bg-accent"
                            )}
                            onClick={() => onSelectFolder(folder.id)}
                          >
                            <FolderOpen
                              className={cn(
                                "h-4 w-4 shrink-0",
                                !isCollapsed && "mr-2",
                                isSelected && "text-primary"
                              )}
                            />
                            {!isCollapsed && (
                              <span className="text-sm truncate flex-1 text-left">
                                {folder.name}
                              </span>
                            )}
                          </Button>
                        </TooltipTrigger>
                        {isCollapsed && (
                          <TooltipContent side="right">
                            {folder.name}
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFolderToDelete(folder.id);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Folder
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </nav>
          </div>
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
          description="Are you sure you want to delete this folder? This action cannot be undone."
          confirmText="Delete"
        />

        <ConfirmDialog
          isOpen={showLogoutConfirm}
          onClose={() => setShowLogoutConfirm(false)}
          onConfirm={onLogout}
          title="Log out?"
          description="Are you sure you want to log out of your account?"
          confirmText="Log out"
        />

        {/* Spacer when collapsed to push footer down if ScrollArea is hidden */}
        {isCollapsed && <div className="flex-1" />}

        {/* Footer */}
        <div
          className={cn(
            "shrink-0 space-y-1",
            isCollapsed
              ? "p-2 w-full flex flex-col items-center"
              : "p-2 mt-auto"
          )}
        >
          {!isCollapsed && <Separator className="mb-2" />}

          <Tooltip>
            {/* Settings */}
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  isCollapsed
                    ? "h-9 w-9 justify-center px-0"
                    : "w-full justify-start px-2 h-8 text-muted-foreground"
                )}
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

          <Tooltip>
            {/* Logout */}
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  isCollapsed
                    ? "h-9 w-9 justify-center px-0 text-destructive"
                    : "w-full justify-start px-2 h-8 text-destructive hover:text-destructive"
                )}
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
