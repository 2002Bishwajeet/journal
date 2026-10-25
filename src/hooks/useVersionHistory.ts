import { useQuery } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import { toast } from 'sonner';
import { getSnapshots } from '@/lib/db';
import { restoreSnapshot } from '@/lib/history/restore';
import { isTouchDevice } from '@/lib/utils';

/**
 * Version history for one note: the snapshots saved on this device, and
 * restoring one into the open editor. Read fresh each time the modal opens.
 */
export function useVersionHistory(editor: Editor, docId: string, open: boolean, onRestored: () => void) {
    const { data: snapshots = [], isLoading } = useQuery({
        queryKey: ['version-history', docId],
        queryFn: () => getSnapshots(docId),
        enabled: open,
        staleTime: 0,
        gcTime: 0,
    });

    const restore = async (snapshotId: number) => {
        try {
            await restoreSnapshot(editor, docId, snapshotId);
            onRestored();
            toast.success(isTouchDevice() ? 'Version restored' : 'Version restored — press Cmd+Z to undo');
        } catch (error) {
            console.error('[useVersionHistory] Restore failed:', error);
            toast.error('Could not restore this version');
        }
    };

    return { snapshots, isLoading, restore };
}
