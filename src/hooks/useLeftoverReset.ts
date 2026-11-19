import { useState } from 'react';
import { isLeftoverSession } from '@/lib/db';
import { useSyncService } from '@/hooks/useSyncService';
import type { SyncContextType } from '@/hooks/useSyncService';

type SyncState = Pick<SyncContextType, 'syncStatus' | 'lastSyncResult' | 'pendingCount'>;

/**
 * Whether a sync couldn't send the unsynced changes of the plain database an older desktop
 * build left (#1362): it failed, or finished with errors or with changes it stopped retrying,
 * and changes are still left.
 */
export function leftoverPushFailed({ syncStatus, lastSyncResult, pendingCount }: SyncState): boolean {
  if (syncStatus === 'syncing' || pendingCount.total + pendingCount.failed === 0) return false;
  if (syncStatus === 'error') return true;
  return !!lastSyncResult && (lastSyncResult.errors.length > 0 || pendingCount.failed > 0);
}

/**
 * The desktop app's reset prompt for a launch on that plain database: shown once a sync
 * couldn't send its changes, until dismissed. The database is kept unless the user resets.
 */
export function useLeftoverReset() {
  const sync = useSyncService();
  const [dismissed, setDismissed] = useState(false);
  const unsynced = sync.pendingCount.total + sync.pendingCount.failed;

  const reset = async () => {
    const { resetLocalData } = await import('@/lib/db/localReset');
    await resetLocalData();
    window.location.reload();
  };

  return {
    open: isLeftoverSession() && !dismissed && leftoverPushFailed(sync),
    unsynced,
    dismiss: () => setDismissed(true),
    reset,
  };
}
