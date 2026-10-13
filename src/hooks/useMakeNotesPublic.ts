import { useState } from 'react';
import * as Y from 'yjs';
import { toast } from 'sonner';
import { useDotYouClientContext } from '@/components/auth';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { getDocumentUpdates, getSyncRecord } from '@/lib/db';
import { buildPublicCard } from '@/lib/share/publicCard';
import { privateLinkedNotes } from '@/lib/share/privateLinks';
import { useNotes } from '@/hooks/useNotes';
import { useSyncService } from '@/hooks/useSyncService';

/**
 * Publishing a note from the share dialog, and the private notes it links to.
 * `makePublic(extraIds)` publishes the note and then each of `extraIds`, with one toast.
 */
export function useMakeNotesPublic(noteId: string) {
    const dotYouClient = useDotYouClientContext();
    const { get, setNotePublic, setShareCard } = useNotes();
    const { syncNote } = useSyncService();
    const [isMakingPublic, setIsMakingPublic] = useState(false);

    const notes = get.data;
    const privateLinks = privateLinkedNotes(
        notes?.find((n) => n.docId === noteId)?.metadata.linkedNoteIds,
        notes ?? [],
    );

    const publishOne = async (provider: NotesDriveProvider, docId: string) => {
        // Pass the synced fileId: a just-created note's uniqueId lookup can 404 (#293)
        let record = await getSyncRecord(docId);
        // A note shared within its debounced save window isn't on the server yet: push it first.
        if (!record?.remoteFileId) {
            await syncNote(docId);
            record = await getSyncRecord(docId);
        }
        const updates = await getDocumentUpdates(docId);
        const blob = updates.length > 0 ? Y.mergeUpdates(updates) : undefined;
        const metadata = notes?.find((n) => n.docId === docId)?.metadata;
        // New publishes are indexable unless the owner opts out; a stored value is kept as is.
        const publishIndexable = metadata?.shareIndexable ?? true;
        const rekeyed = await provider.makeNotePublic(
            docId,
            record?.remoteFileId,
            buildPublicCard(blob, { ...metadata, shareIndexable: publishIndexable })
        );
        // Persist it so later pushes rebuild the card with the same flag.
        if (metadata?.shareIndexable === undefined) await setShareCard.mutateAsync({ docId, shareIndexable: true });
        setNotePublic.mutate({ docId, isPublic: true, rekeyed });
    };

    const makePublic = async (extraIds: string[] = []) => {
        if (!dotYouClient) {
            toast.error('Not authenticated');
            return;
        }

        setIsMakingPublic(true);
        try {
            const provider = new NotesDriveProvider(dotYouClient);
            for (const docId of [noteId, ...extraIds]) await publishOne(provider, docId);
            toast.success(extraIds.length ? 'Note and linked notes are now publicly accessible' : 'Note is now publicly accessible');
        } catch (err) {
            console.error('Failed to make note public:', err);
            toast.error('Failed to make note public');
        } finally {
            setIsMakingPublic(false);
        }
    };

    return { privateLinks, isMakingPublic, makePublic };
}
