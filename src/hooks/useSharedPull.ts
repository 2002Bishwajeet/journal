import { useState } from 'react';
import { toast } from 'sonner';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { useDotYouClientContext } from '@/components/auth';
import { getSharedNoteOwners } from '@/lib/db';
import { pullMissedSharePushes, type OwnerSync } from './useSharePush';
import { usePeerAccess } from './usePeerAccess';
import { useSyncService } from './useSyncService';

/**
 * "Refresh" in Shared with me (#1494): pulls each owner the host already has notes from,
 * then acts on the unread share and unshare pushes. Never lists connections. Rejects only
 * when the pushes could not be read; an owner that does not answer is skipped.
 */
export async function refreshSharedNotes(client: DotYouClient, sync: OwnerSync): Promise<void> {
    const pulled = new Set<string>();
    const pullOnce: OwnerSync = {
        pullOwnerNow: async (odinId) => {
            if (pulled.has(odinId)) return;
            await sync.pullOwnerNow(odinId);
            pulled.add(odinId);
        },
        revalidateOwner: (odinId) => sync.revalidateOwner(odinId),
    };
    const owners = await getSharedNoteOwners(client.getHostIdentity());
    await Promise.allSettled(owners.map((odinId) => pullOnce.pullOwnerNow(odinId)));
    await pullMissedSharePushes(client, pullOnce);
}

/**
 * Notes shared with you (#732) arrive by push, invite or share link, never by polling
 * (#1494). This is the "Refresh" button, shown only with peer access.
 */
export function useSharedPull() {
    const client = useDotYouClientContext();
    const { syncService } = useSyncService();
    const canPull = usePeerAccess() === true;
    const [isRefreshing, setIsRefreshing] = useState(false);

    const refresh = async () => {
        if (!syncService || !canPull || isRefreshing) return;
        setIsRefreshing(true);
        try {
            await refreshSharedNotes(client, syncService);
        } catch (error) {
            console.warn('[useSharedPull] refresh failed:', error);
            toast.error("Couldn't refresh shared notes");
        } finally {
            setIsRefreshing(false);
        }
    };

    return { canPull, isRefreshing, refresh };
}
