import { toast } from 'sonner';
import { useDotYouClientContext } from '@/components/auth';
import { useSyncService } from '@/hooks/useSyncService';
import { refreshFolderCard, setNoteShared } from '@/hooks/useFolderSharing';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { getFolderById, getSearchIndexEntry, setNoteFolderLocal, updateSyncStatus } from '@/lib/db';
import { publicAfterMove } from '@/lib/share/sharedFolder';

/**
 * Move a note to another folder (#622). The folder change is local-first (a pending push
 * sends it as the file's new groupId); then, if the move crosses the shared-folder line,
 * the note is made public or private as the Share dialog does. A failed visibility change
 * leaves the note moved and says so. Resolves true when the note was moved.
 */
export function useMoveNote() {
    const dotYouClient = useDotYouClientContext();
    const { syncNote, syncFolder } = useSyncService();

    return async (docId: string, toFolderId: string): Promise<boolean> => {
        const entry = await getSearchIndexEntry(docId);
        // Your own shared notes move like any other (#682); other people's aren't yours to file
        const author = entry?.metadata.authorOdinId;
        if (!entry || (author && author !== dotYouClient.getHostIdentity())) return false;
        const fromFolderId = entry.metadata.folderId;
        if (fromFolderId === toFolderId) return false;

        const [from, to] = await Promise.all([getFolderById(fromFolderId), getFolderById(toFolderId)]);
        if (!to) {
            toast.error("Couldn't move note: that folder no longer exists");
            return false;
        }
        // A shared folder makes its notes public, and a public note can't also be shared with people
        if (to.isPublic && entry.metadata.isCollaborative) {
            toast.error(`Stop sharing the note with people before you move it to ${to.name}.`);
            return false;
        }
        const isPublic = publicAfterMove(from, to, entry.metadata.isPublic);

        try {
            await setNoteFolderLocal(docId, toFolderId, fromFolderId);
            await updateSyncStatus(docId, 'pending');
        } catch (err) {
            console.error('[useMoveNote] Failed to move note:', err);
            toast.error("Couldn't move note");
            return false;
        }

        let visibilityFailed = false;
        if (isPublic !== !!entry.metadata.isPublic) {
            try {
                await setNoteShared(new NotesDriveProvider(dotYouClient), syncNote, docId, isPublic);
            } catch (err) {
                console.error(`[useMoveNote] Failed to make note ${docId} ${isPublic ? 'public' : 'private'}:`, err);
                visibilityFailed = true;
            }
        }

        // Push the new folder now; if it fails the note stays pending and the next sync retries.
        await updateSyncStatus(docId, 'pending');
        await syncNote(docId).catch((err) => console.warn('[useMoveNote] Push after move failed, will retry:', err));

        // A shared folder's link card shows how many public notes it has.
        await Promise.all([fromFolderId, toFolderId].map((id) => refreshFolderCard(syncFolder, id)));

        if (visibilityFailed) {
            toast.warning(`Moved to ${to.name}, but couldn't make the note ${isPublic ? 'public' : 'private'}.`);
        } else {
            toast.success(`Moved to ${to.name}`);
        }
        return true;
    };
}
