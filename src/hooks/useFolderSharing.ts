import * as Y from 'yjs';
import { toast } from 'sonner';
import { useDotYouClientContext } from '@/components/auth';
import { useSyncService } from '@/hooks/useSyncService';
import { setNotePublicLocal } from '@/hooks/useNotes';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import {
    getDocumentUpdates,
    getFolderNotesToShare,
    getSearchIndexEntry,
    getSyncRecord,
    setFolderPublicLocal,
    updateSearchIndexMetadata,
    updateSyncStatus,
} from '@/lib/db';
import { buildPublicCard } from '@/lib/share/publicCard';

const notes = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`;

/**
 * Share a folder, or stop sharing it (#618). The folder's flag is local-first and syncs
 * like its name (its push re-uploads the folder file Anonymous or Owner-only); then
 * every non-trashed note in it is made public or private one at a time, as the Share
 * dialog does. A note that fails is counted in the summary toast and the rest carry on.
 */
export function useFolderSharing() {
    const dotYouClient = useDotYouClientContext();
    const { syncNote, syncFolder } = useSyncService();

    const setNoteShared = async (provider: NotesDriveProvider, docId: string, isPublic: boolean) => {
        // A note still within its debounced save window isn't on the server yet: push it first.
        let record = await getSyncRecord(docId);
        if (!record?.remoteFileId) {
            await syncNote(docId);
            record = await getSyncRecord(docId);
        }
        const entry = await getSearchIndexEntry(docId);
        if (!entry) return;
        // New publishes are indexable unless the owner opted out (as in the Share dialog).
        const shareFields = isPublic ? { isPublic, shareIndexable: entry.metadata.shareIndexable ?? true } : { isPublic };

        if (!record?.remoteFileId) {
            // Still not on the server (offline): its first push uploads it with this flag.
            await updateSearchIndexMetadata(docId, entry.title, { ...entry.metadata, ...shareFields });
            await updateSyncStatus(docId, 'pending');
            return;
        }

        if (!isPublic) {
            await setNotePublicLocal({ docId, isPublic, rekeyed: await provider.makeNotePrivate(docId, record.remoteFileId) });
            return;
        }

        const updates = await getDocumentUpdates(docId);
        const blob = updates.length > 0 ? Y.mergeUpdates(updates) : undefined;
        const rekeyed = await provider.makeNotePublic(docId, record.remoteFileId, buildPublicCard(blob, { ...entry.metadata, ...shareFields }));
        // The re-key is recorded before anything marks the note pending, so no push uses the old key.
        await setNotePublicLocal({ docId, isPublic, rekeyed });
        if (entry.metadata.shareIndexable === undefined) {
            // Persist it so later pushes rebuild the card with the same flag.
            const current = await getSearchIndexEntry(docId);
            if (current) await updateSearchIndexMetadata(docId, current.title, { ...current.metadata, shareIndexable: true });
            await updateSyncStatus(docId, 'pending');
        }
    };

    const setFolderShared = async (folderId: string, isPublic: boolean) => {
        if (!dotYouClient) {
            toast.error('Not authenticated');
            return;
        }
        const toastId = toast.loading(isPublic ? 'Sharing folder…' : 'Stopping sharing…');
        try {
            await setFolderPublicLocal(folderId, isPublic);
            await updateSyncStatus(folderId, 'pending');
            await syncFolder(folderId);

            const docIds = await getFolderNotesToShare(folderId, isPublic);
            const provider = new NotesDriveProvider(dotYouClient);
            const target = isPublic ? 'public' : 'private';
            let failed = 0;
            for (const [i, docId] of docIds.entries()) {
                toast.loading(`Making notes ${target} (${i + 1}/${docIds.length})…`, { id: toastId });
                try {
                    await setNoteShared(provider, docId, isPublic);
                } catch (err) {
                    console.error(`[useFolderSharing] Failed to make note ${docId} ${target}:`, err);
                    failed++;
                }
            }

            const done = isPublic ? 'Folder shared' : 'Folder is private again';
            if (failed > 0) {
                toast.warning(`${done}, but ${notes(failed)} couldn't be made ${target}.`, { id: toastId });
            } else {
                toast.success(docIds.length > 0 ? `${done}. ${notes(docIds.length)} made ${target}.` : `${done}.`, { id: toastId });
            }
        } catch (err) {
            console.error('[useFolderSharing] Failed to change folder sharing:', err);
            toast.error(isPublic ? 'Failed to share folder' : 'Failed to stop sharing folder', { id: toastId });
        }
    };

    /** How many notes stopping sharing `folderId` would make private (for its confirm dialog). */
    const countPublicNotes = async (folderId: string) => (await getFolderNotesToShare(folderId, false)).length;

    return { setFolderShared, countPublicNotes };
}
