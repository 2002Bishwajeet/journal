import { useSyncService } from '@/hooks';
import { Loader2, Cloud, CloudOff, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SyncStatusProps {
  className?: string;
  showText?: boolean;
}

export function SyncStatus({ className, showText = true }: SyncStatusProps) {
  const { syncStatus, isOnline, pendingCount, syncProgress } = useSyncService();

  const progressText = syncProgress 
    ? syncProgress.message 
    : showText && pendingCount.total > 0 
      ? "Syncing..." 
      : null;

  return (
    <div className={cn("flex items-center gap-2 text-muted-foreground text-xs", className)}>
      {!isOnline && (
        <span className="flex items-center gap-1 text-amber-500">
          <WifiOff className="h-4 w-4" />
          {showText && <span>Offline</span>}
        </span>
      )}
      {isOnline && syncStatus === 'syncing' && (
        <span className="flex items-center gap-1 text-blue-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {progressText && <span>{progressText}</span>}
        </span>
      )}
      {isOnline && syncStatus === 'idle' && pendingCount.total === 0 && (
        <Cloud className="h-4 w-4 text-green-500" />
      )}
      {isOnline && syncStatus === 'idle' && pendingCount.total > 0 && (
        <span className="flex items-center gap-1 text-amber-500">
          <Cloud className="h-4 w-4" />
          <span>{pendingCount.total}</span>
        </span>
      )}
      {isOnline && syncStatus === 'error' && (
        <CloudOff className="h-4 w-4 text-red-500" />
      )}
    </div>
  );
}
