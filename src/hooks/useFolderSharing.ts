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
 * Make one note public or private, as the Share dialog does (also used when a note moves
 * into or out of a shared folder, #622). Throws if the server refuses.
 */
export async function setNoteShared(
    provider: NotesDriveProvider,
    syncNote: (docId: string) => Promise<void>,
    docId: string,
    isPublic: boolean
): Promise<void> {
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
}

/** Notes changed at once when sharing or unsharing a folder. */
const SHARE_CONCURRENCY = 4;

/**
 * Run `work` over `items` with at most `limit` in flight. `onSettled(done)` fires as each
 * finishes; returns how many threw (each is logged by the caller via `work`'s own catch).
 */
export async function runLimited<T>(
    items: T[],
    limit: number,
    work: (item: T) => Promise<void>,
    onSettled: (done: number) => void
): Promise<number> {
    let next = 0;
    let done = 0;
    let failed = 0;
    const worker = async () => {
        while (next < items.length) {
            try {
                await work(items[next++]);
            } catch {
                failed++;
            }
            onSettled(++done);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return failed;
}

/**
 * Share a folder, or stop sharing it (#618). The folder's flag is local-first and syncs
 * like its name (its push re-uploads the folder file Anonymous or Owner-only); then
 * every non-trashed note in it is made public or private four at a time, as the Share
 * dialog does. A note that fails is counted in the summary toast and the rest carry on.
 */
export function useFolderSharing() {
    const dotYouClient = useDotYouClientContext();
    const { syncNote, syncFolder } = useSyncService();

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
            toast.loading(`Making notes ${target} (0/${docIds.length})…`, { id: toastId });
            const failed = await runLimited(
                docIds,
                SHARE_CONCURRENCY,
                async (docId) => {
                    try {
                        await setNoteShared(provider, syncNote, docId, isPublic);
                    } catch (err) {
                        console.error(`[useFolderSharing] Failed to make note ${docId} ${target}:`, err);
                        throw err;
                    }
                },
                (n) => toast.loading(`Making notes ${target} (${n}/${docIds.length})…`, { id: toastId })
            );

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
