import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AppPermissionType } from '@homebase-id/js-lib/network';
import { useSyncService } from './useSyncService';
import { useSecurityContext } from './securityContext/useSecurityContext';

const INTERVAL_MS = 10 * 60_000;

/**
 * Finds notes shared with you on your connections' drives (#732): once after the
 * first sync of this session, then every 10 minutes while the tab is visible, and
 * on "Refresh" (which ignores backoff and also drops revoked notes).
 */
export function useSharedPull() {
    const { syncService, lastSyncResult } = useSyncService();
    const { data: securityContext } = useSecurityContext().fetch;
    const [isRefreshing, setIsRefreshing] = useState(false);

    // ReadConnections is still only in the collaboration consent; #743 moves it to the base one
    const canPull = !!securityContext?.permissionContext.permissionGroups
        .some((group) => group.permissionSet.keys.includes(AppPermissionType.ReadConnections));
    const hasSynced = lastSyncResult !== null;

    useEffect(() => {
        if (!syncService || !canPull || !hasSynced) return;
        const pull = () => syncService.pullShared({ canReadConnections: true })
            .catch((error) => console.warn('[useSharedPull] pull failed:', error));
        pull();
        const id = setInterval(() => {
            if (document.visibilityState === 'visible') pull();
        }, INTERVAL_MS);
        return () => clearInterval(id);
    }, [syncService, canPull, hasSynced]);

    const refresh = async () => {
        if (!syncService || isRefreshing) return;
        setIsRefreshing(true);
        try {
            await syncService.pullShared({ canReadConnections: canPull, manual: true });
        } catch (error) {
            console.warn('[useSharedPull] refresh failed:', error);
            toast.error("Couldn't refresh shared notes");
        } finally {
            setIsRefreshing(false);
        }
    };

    return { canPull, isRefreshing, refresh };
}
