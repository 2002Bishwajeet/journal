import { toast } from 'sonner';
import { fetchMembersOfCircle, getConnectionInfo } from '@homebase-id/js-lib/network';
import { useDotYouClientContext } from '@/components/auth';
import { useSyncService } from '@/hooks/useSyncService';
import { useNotes } from '@/hooks/useNotes';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { COLLABORATIVE_FOLDER_ID, MAIN_FOLDER_ID } from '@/lib/homebase/config';
import { getSyncRecord } from '@/lib/db';
import { normalizeOdinId, shareRecipients } from '@/lib/homebase/shareTargets';
import type { NoteListEntry } from '@/types';

export interface SelectedCircle {
    circleId: string;
    name: string;
}

/** Who a note is shared with: circles, and connections named by identity (#681). */
export interface ShareTargets {
    circles: SelectedCircle[];
    odinIds: string[];
}

/**
 * Sharing a note with circles and people, changing who it is shared with, and
 * revoking it: the remote upload, the invite and the local metadata, with
 * user-visible toasts.
 */
export function useNoteCollaboration() {
    const dotYouClient = useDotYouClientContext();
    const { syncService } = useSyncService();
    const {
        get: { data: notes = [] },
        updateNote: { mutateAsync: updateNoteMetadata },
        setNotePublic: { mutateAsync: setNotePublic },
    } = useNotes();

    /**
     * Shares the note with the circles and identities, or changes who an existing share
     * names (naming no one stops sharing); resolves true when it succeeded.
     */
    const share = async (noteId: string, targets: ShareTargets): Promise<boolean> => {
        const { circles } = targets;
        const odinIds = [...new Set(targets.odinIds.map(normalizeOdinId))];
        const existingNote = notes.find((n) => n.docId === noteId);
        const wasShared = !!existingNote?.metadata.isCollaborative;

        if (circles.length === 0 && odinIds.length === 0) {
            if (wasShared) return revoke(existingNote);
            toast.error('Choose at least one circle or person');
            return false;
        }

        if (!dotYouClient) {
            toast.error('Not authenticated');
            return false;
        }

        const editorOdinId = dotYouClient.getHostIdentity() || '';
        if (odinIds.includes(editorOdinId)) {
            toast.error("You can't share a note with yourself");
            return false;
        }

        try {
            // The server refuses a named identity that isn't a connection anyway, but
            // only when they read: say so now instead.
            const connections = await Promise.all(odinIds.map((id) => getConnectionInfo(dotYouClient, id)));
            const stranger = odinIds.find((_, i) => connections[i]?.status.toLowerCase() !== 'connected');
            if (stranger) {
                toast.error(`${stranger} is not one of your connections`);
                return false;
            }

            // Resolve members now, not from the rows' queries: a row clicked before its
            // members loaded would otherwise invite nobody
            const circleIds = circles.map((c) => c.circleId);
            const memberLists = await Promise.all(
                circles.map((c) => fetchMembersOfCircle(dotYouClient, c.circleId)),
            );
            const empty = circles.find((_, i) => !memberLists[i]?.some((m) => m.domain));
            if (empty) {
                toast.error(`${empty.name} has no members`);
                return false;
            }
            const recipients = shareRecipients(
                memberLists.flatMap((l) => (l ?? []).map((m) => m.domain)),
                odinIds,
                editorOdinId,
            );
            // People taken off the share lose the invite, so it leaves their list (#681)
            const removedRecipients = (existingNote?.metadata.recipients ?? [])
                .filter((r) => !recipients.includes(r));

            const provider = new NotesDriveProvider(dotYouClient);

            // Ensure the note body is on the server BEFORE we send the invite, so
            // recipients bootstrap real content instead of an empty note.
            if (syncService) {
                await syncService.flushAndSyncNote(noteId);
            }

            // The note may have just been created by the flush above: pass its fileId,
            // since a fresh note's uniqueId lookup can 404 (#293)
            const record = await getSyncRecord(noteId);
            await provider.makeNoteCollaborative(
                noteId,
                { circleIds, odinIds, recipients, removedRecipients },
                editorOdinId,
                record?.remoteFileId,
            );

            if (existingNote) {
                if (existingNote.metadata.isPublic) {
                    // makeNoteCollaborative re-uploaded the public note encrypted, which re-keys
                    // it: drop the public flag and the now-stale cached key header (#161)
                    await setNotePublic({ docId: noteId, isPublic: false });
                }
                await updateNoteMetadata({
                    docId: noteId,
                    metadata: {
                        ...existingNote.metadata,
                        // Without this the next push re-publishes the note unencrypted (#161)
                        isPublic: false,
                        folderId: COLLABORATIVE_FOLDER_ID,
                        isCollaborative: true,
                        circleIds: circleIds.length > 0 ? circleIds : undefined,
                        odinIds: odinIds.length > 0 ? odinIds : undefined,
                        recipients,
                        lastEditedBy: editorOdinId,
                    },
                });
            } else {
                console.warn(
                    '[MarkCollaborative] Note not found locally, remote ACL updated but local state may be stale',
                );
            }

            toast.success(wasShared ? 'Sharing updated' : 'Note is now collaborative');
            return true;
        } catch (err) {
            console.error('Failed to make note collaborative:', err);
            toast.error('Failed to make note collaborative');
            return false;
        }
    };

    /** Stops sharing the note; resolves true when it succeeded. */
    const revoke = async (note: NoteListEntry | null | undefined): Promise<boolean> => {
        if (!note || !dotYouClient) return false;
        try {
            const provider = new NotesDriveProvider(dotYouClient);
            const editorOdinId = dotYouClient.getHostIdentity() || '';
            const { previousUpdated } = await provider.revokeNoteCollaboration(
                note.docId,
                editorOdinId,
                note.metadata.recipients,
            );
            // A pull that fetched the note before the revoke (say, with a peer's last
            // edit) would otherwise put it back in the shared folder (#689)
            syncService?.supersedeNoteHeaders(note.docId, previousUpdated);
            await updateNoteMetadata({
                docId: note.docId,
                metadata: {
                    ...note.metadata,
                    folderId: MAIN_FOLDER_ID,
                    isCollaborative: false,
                    circleIds: undefined,
                    odinIds: undefined,
                    recipients: undefined,
                    lastEditedBy: editorOdinId,
                },
            });
            toast.success('Collaboration revoked');
            return true;
        } catch (err) {
            console.error('Failed to revoke collaboration:', err);
            toast.error('Failed to revoke collaboration');
            return false;
        }
    };

    return { share, revoke };
}
