import { useSyncService } from "@/hooks";
import {
  Loader2,
  Cloud,
  CloudOff,
  WifiOff,
  RefreshCw,
  Check,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnlineContext } from "@/hooks/useOnlineContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils/index";

interface SyncStatusProps {
  className?: string;
}

export function SyncStatus({ className }: SyncStatusProps) {
  const { syncStatus, pendingCount, syncProgress, lastSyncedAt, sync } =
    useSyncService();
  const { isOnline } = useOnlineContext();

  const isPending = pendingCount.total > 0;
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
    if (isPending)
      return {
        label: "Changes Pending",
        icon: Cloud,
        color: "text-foreground",
      };
    return { label: "Synced", icon: Check, color: "text-muted-foreground" };
  };

  const status = getStatus();
  const StatusIcon = status.icon;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex items-center justify-center rounded-md p-2 transition-colors hover:bg-muted/50 focus-visible:outline-none",
            className,
          )}
        >
          {isSyncing ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : !isOnline ? (
            <WifiOff className="h-4 w-4 text-muted-foreground/50" />
          ) : isPending ? (
            <div className="relative">
              <Cloud className="h-4 w-4 text-foreground" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
            </div>
          ) : (
            <Cloud className="h-4 w-4 text-muted-foreground/70 group-hover:text-foreground transition-colors" />
          )}
        </button>
      </PopoverTrigger>

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
                <span className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {lastSyncedAt && formatRelativeTime(lastSyncedAt)}
                </span>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
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
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Pending items</span>
                  <span className="font-medium text-foreground">
                    {pendingCount.total}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Footer Status Message */}
          {!isOnline && (
            <div className="bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground">
              Sync paused while offline
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
