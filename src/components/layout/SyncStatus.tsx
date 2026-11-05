import { useState } from "react";
import { useSyncService } from "@/hooks";
import { openSettings } from "@/hooks/useSettingsOpener";
import {
  Loader2,
  Cloud,
  CloudOff,
  WifiOff,
  RefreshCw,
  Check,
  Clock,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnlineContext } from "@/hooks/useOnlineContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { useSheetMode } from "@/hooks/useSheetMode";
import { formatRelativeTime } from "@/lib/utils";

interface SyncStatusProps {
  className?: string;
}

export function SyncStatus({ className }: SyncStatusProps) {
  const { syncStatus, pendingCount, syncProgress, lastSyncedAt, sync } =
    useSyncService();
  const { isOnline } = useOnlineContext();
  const [open, setOpen] = useState(false);
  const asSheet = useSheetMode();

  const isPending = pendingCount.total > 0;
  // Changes sync stopped retrying (#874): they need the user, in Diagnostics
  const failed = pendingCount.failed;
  const isSyncing = syncStatus === "syncing";

  // Minimalist Status Logic
  const getStatus = () => {
    if (!isOnline)
      return {
        label: "Offline",
        icon: WifiOff,
        color: "text-muted-foreground",
      };
    if (isSyncing)
      return {
        label: "Syncing...",
        icon: Loader2,
        color: "text-foreground",
        animate: true,
      };
    if (syncStatus === "error")
      return { label: "Sync Error", icon: CloudOff, color: "text-destructive" };
    if (failed > 0)
      return { label: "Couldn't sync", icon: CloudOff, color: "text-destructive" };
    if (isPending)
      return {
        label: "Changes Pending",
        icon: Cloud,
        color: "text-foreground",
      };
    return { label: "Synced", icon: Check, color: "text-muted-foreground" };
  };

  // Pending items, errors and the log, for a phone without a console (#800).
  const showDiagnostics = () => {
    setOpen(false);
    if (!asSheet) return openSettings("diagnostics");
    // The sheet pops its history entry as it closes; open Settings after that pop, or it takes
    // Settings' entry with it and closes the dialog again.
    // With no pop (no router, or a desktop-class touch device) a short timer opens it instead.
    const go = () => {
      window.removeEventListener("popstate", go);
      clearTimeout(fallback);
      setTimeout(() => openSettings("diagnostics"));
    };
    const fallback = setTimeout(go, 300);
    window.addEventListener("popstate", go);
  };

  const status = getStatus();
  const StatusIcon = status.icon;

  // A 44 px hit area on touch, with the icon at its size
  const trigger = (
    <button
      type="button"
      aria-label="Sync status"
      onClick={asSheet ? () => setOpen(true) : undefined}
      className={cn(
        "group flex items-center justify-center rounded-md p-2 transition-colors hover:bg-muted/50 focus-visible:outline-none pointer-coarse:size-11",
        className,
      )}
    >
      {isSyncing ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : !isOnline ? (
        <WifiOff className="h-4 w-4 text-muted-foreground/70" />
      ) : isPending || failed > 0 ? (
        <div className="relative">
          <Cloud className="h-4 w-4 text-foreground" />
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-background",
              failed > 0 ? "bg-destructive dark:bg-red-400" : "bg-primary",
            )}
          />
        </div>
      ) : (
        <Cloud className="h-4 w-4 text-muted-foreground/70 group-hover:text-foreground transition-colors" />
      )}
    </button>
  );

  if (asSheet) {
    const waiting =
      isPending && isOnline && !isSyncing && !failed && syncStatus !== "error";
    return (
      <>
        {trigger}
        <ResponsiveSheet open={open} onOpenChange={setOpen} title="Sync status">
          <div className="flex flex-col gap-3 pb-2">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary",
                  status.color,
                )}
              >
                <StatusIcon
                  className={cn("h-5 w-5", status.animate && "animate-spin")}
                />
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="text-base font-medium">
                  {waiting
                    ? `${pendingCount.total} ${pendingCount.total === 1 ? "change" : "changes"} waiting`
                    : status.label}
                </span>
                {lastSyncedAt && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatRelativeTime(lastSyncedAt)}
                  </span>
                )}
              </div>
            </div>

            <Button
              className="h-11 w-full"
              onClick={() => sync()}
              disabled={isSyncing || !isOnline}
            >
              <RefreshCw
                className={cn(isSyncing && "animate-spin")}
                aria-hidden="true"
              />
              Sync now
            </Button>

            {isSyncing && syncProgress && syncProgress.total > 0 && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{
                    width: `${(syncProgress.current / syncProgress.total) * 100}%`,
                  }}
                />
              </div>
            )}

            {isPending && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Pending items</span>
                <span className="font-medium text-foreground">
                  {pendingCount.total}
                </span>
              </div>
            )}

            {failed > 0 && (
              <button
                type="button"
                className="flex min-h-11 items-center justify-between text-sm text-destructive dark:text-red-400"
                onClick={showDiagnostics}
              >
                <span>Couldn't sync</span>
                <span className="font-medium">{failed}</span>
              </button>
            )}

            {!isOnline && (
              <p className="text-sm text-muted-foreground">
                Sync paused while offline
              </p>
            )}

            <button
              type="button"
              className="press-row -mx-5 flex min-h-11 items-center justify-between border-t px-5 text-sm transition-colors duration-(--duration-fade) ease-(--ease-standard)"
              onClick={showDiagnostics}
            >
              Open diagnostics
              <ChevronRight
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          </div>
        </ResponsiveSheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-60 p-0 overflow-hidden"
        sideOffset={8}
      >
        <div className="flex flex-col gap-px bg-border/50">
          {/* Header Section */}
          <div className="flex items-center justify-between bg-popover p-3">
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full bg-secondary",
                  status.color,
                )}
              >
                <StatusIcon
                  className={cn("h-4 w-4", status.animate && "animate-spin")}
                />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium leading-none">
                  {status.label}
                </span>
                <span className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {lastSyncedAt && formatRelativeTime(lastSyncedAt)}
                </span>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              aria-label="Sync now"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => sync()}
              disabled={isSyncing || !isOnline}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")}
              />
            </Button>
          </div>

          {/* Pending Details (Only if needed) */}
          {(isPending || isSyncing) && (
            <div className="bg-popover px-3 py-2 text-xs">
              {isSyncing && syncProgress ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-muted-foreground">
                    <span>
                      {syncProgress.phase === "pull"
                        ? "Downloading"
                        : "Uploading"}
                      ...
                    </span>
                    <span>
                      {Math.round(
                        (syncProgress.current / syncProgress.total) * 100,
                      )}
                      %
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{
                        width: `${(syncProgress.current / syncProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="-mx-3 -my-2 flex min-h-11 w-[calc(100%+1.5rem)] items-center justify-between px-3 text-muted-foreground hover:bg-muted/50 md:min-h-9"
                  onClick={showDiagnostics}
                >
                  <span>Pending items</span>
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    {pendingCount.total}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  </span>
                </button>
              )}
            </div>
          )}

          {failed > 0 && !isSyncing && (
            <button
              type="button"
              className="flex min-h-11 items-center justify-between bg-popover px-3 text-xs text-destructive hover:bg-muted/50 md:min-h-9 dark:text-red-400"
              onClick={showDiagnostics}
            >
              <span>Couldn't sync</span>
              <span className="flex items-center gap-1 font-medium">
                {failed}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </button>
          )}

          {!isPending && !isSyncing && failed === 0 && (
            <button
              type="button"
              className="flex min-h-11 items-center justify-between bg-popover px-3 text-xs text-muted-foreground hover:bg-muted/50 md:min-h-9"
              onClick={showDiagnostics}
            >
              Diagnostics
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}

          {/* Footer Status Message */}
          {!isOnline && (
            <div className="bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Sync paused while offline
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
