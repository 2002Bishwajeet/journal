import { useAuth } from '@/hooks/auth/useAuth';
import { useSyncService } from '@/hooks/useSyncService';
import { useOnlineContext } from '@/hooks/useOnlineContext';
import type { SyncStatus } from '@/lib/homebase/SyncService';

export interface UseAccountSettingsReturn {
    identity: string | null;
    syncStatus: SyncStatus | 'offline';
    lastSyncedAt: Date | null;
    pendingTotal: number;
    syncNow: () => Promise<void>;
    signOut: () => Promise<void>;
}

export function useAccountSettings(): UseAccountSettingsReturn {
    const { getIdentity, logout } = useAuth();
    const { syncStatus, lastSyncedAt, pendingCount, sync } = useSyncService();
    const { isOnline } = useOnlineContext();

    return {
        identity: getIdentity() || null,
        syncStatus: isOnline ? syncStatus : 'offline',
        lastSyncedAt,
        pendingTotal: pendingCount.total,
        syncNow: sync,
        signOut: logout,
    };
}
