import type { SyncStatus } from '@/lib/homebase/SyncService';
import type { SyncProgress } from '@/types';
import { useSyncService } from '@/hooks/useSyncService';
import { useOnlineContext } from '@/hooks/useOnlineContext';
import { openSettings } from '@/hooks/useSettingsOpener';

export type SyncIndicator =
    | { kind: 'syncing'; label: string }
    | { kind: 'offline'; label: string }
    | { kind: 'error'; label: string; action: 'retry' }
    | { kind: 'failed'; label: string; action: 'details' };

/**
 * What the phone's sync pill (#1162) shows, or null when there is nothing to say: synced, or
 * changes waiting for the next sync. Offline wins (no sync can run), then a running sync, then
 * a failed one, then changes sync stopped retrying (#874).
 */
export function getSyncIndicator({
    isOnline,
    syncStatus,
    syncProgress,
    failed,
}: {
    isOnline: boolean;
    syncStatus: SyncStatus;
    syncProgress: SyncProgress | null;
    failed: number;
}): SyncIndicator | null {
    if (!isOnline) return { kind: 'offline', label: 'Offline' };
    if (syncStatus === 'syncing') {
        const counted = syncProgress && syncProgress.total > 1;
        return {
            kind: 'syncing',
            label: counted ? `Syncing ${Math.min(syncProgress.current, syncProgress.total)} of ${syncProgress.total}` : 'Syncing…',
        };
    }
    if (syncStatus === 'error') return { kind: 'error', label: "Couldn't sync", action: 'retry' };
    if (failed > 0) return { kind: 'failed', label: `${failed} couldn't sync`, action: 'details' };
    return null;
}

/** The phone sync pill's state, and what tapping it does. */
export function useSyncIndicator() {
    const { syncStatus, syncProgress, pendingCount, sync } = useSyncService();
    const { isOnline } = useOnlineContext();
    const indicator = getSyncIndicator({ isOnline, syncStatus, syncProgress, failed: pendingCount.failed });
    const act = () => {
        if (indicator?.kind === 'error') void sync();
        else if (indicator?.kind === 'failed') openSettings('diagnostics');
    };
    return { indicator, act };
}
