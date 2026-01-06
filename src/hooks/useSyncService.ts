
import type { SyncStatus, SyncResult, SyncService } from '@/lib/homebase/SyncService';
import type { PendingCount } from '@/components/providers/SyncProvider';
import type { SyncProgress } from '@/types';
import { createContext, useContext } from 'react';

export interface SyncContextType {
    /** Current sync status */
    syncStatus: SyncStatus;
    /** Whether we're online */
    isOnline: boolean;
    /** Count of pending items to sync */
    pendingCount: PendingCount;
    /** Last sync result (counts of pulled/pushed items) */
    lastSyncResult: SyncResult | null;
    /** Current sync progress (during sync operation) */
    syncProgress: SyncProgress | null;
    /** Trigger a full sync */
    sync: () => Promise<void>;
    /** Sync a single note (for debounced saves) */
    syncNote: (docId: string) => Promise<void>;
    /** Sync a single folder */
    syncFolder: (folderId: string) => Promise<void>;
    /** Delete a note from remote (call before deleting local) */
    deleteNoteRemote: (docId: string) => Promise<void>;
    /** Delete a folder from remote (call before deleting local) */
    deleteFolderRemote: (folderId: string) => Promise<void>;
    /** The underlying sync service instance */
    syncService: SyncService | null;
}


export const SyncContext = createContext<SyncContextType | null>(null);

export function useSyncService() {
    const context = useContext(SyncContext);
    if (!context) {
        throw new Error('useSyncContext must be used within a SyncProvider');
    }
    return context;
}
