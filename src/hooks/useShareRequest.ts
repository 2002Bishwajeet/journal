import { getSearchIndexEntry, updateSearchIndexMetadata, updateSyncStatus } from '@/lib/db';
import { useSyncService } from '@/hooks/useSyncService';

/**
 * Drops an agent's share request from a note (#325), once the owner has shared it from the
 * Share dialog or declined. The note is pushed so the agent's get_sharing sees it gone.
 */
export function useClearShareRequest() {
    const { syncNote } = useSyncService();
    return async (docId: string) => {
        const current = await getSearchIndexEntry(docId);
        if (!current?.metadata.shareRequest) return;
        const { shareRequest: _, ...metadata } = current.metadata;
        await updateSearchIndexMetadata(docId, current.title, metadata);
        await updateSyncStatus(docId, 'pending');
        void syncNote(docId);
    };
}
