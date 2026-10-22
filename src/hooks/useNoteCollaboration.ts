import { toast } from 'sonner';
import { useDotYouClientContext } from '@/components/auth';
import { useSyncService } from '@/hooks/useSyncService';
import { useNotes } from '@/hooks/useNotes';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { COLLABORATIVE_FOLDER_ID, MAIN_FOLDER_ID } from '@/lib/homebase/config';
import { getSyncRecord } from '@/lib/db';
import type { NoteListEntry } from '@/types';

export interface SelectedCircle {
    circleId: string;
    members: string[];
}

/**
 * Sharing a note with circles and revoking it: the remote upload, the invite and
 * the local metadata, with user-visible toasts.
 */
export function useNoteCollaboration() {
    const dotYouClient = useDotYouClientContext();
    const { syncService } = useSyncService();
    const {
        get: { data: notes = [] },
        updateNote: { mutateAsync: updateNoteMetadata },
        setNotePublic: { mutateAsync: setNotePublic },
    } = useNotes();

    /** Shares the note with the circles; resolves true when it succeeded. */
    const share = async (noteId: string, circles: SelectedCircle[]): Promise<boolean> => {
        if (circles.length === 0) {
            toast.error('Please select at least one circle');
            return false;
        }

        if (!dotYouClient) {
            toast.error('Not authenticated');
            return false;
        }

        try {
            // Extract circleIds and unique recipients from selected circles
            const circleIds = circles.map((c) => c.circleId);
            const allMembers = circles.flatMap((c) => c.members);
            const recipients = [...new Set(allMembers)].filter(Boolean);

            const provider = new NotesDriveProvider(dotYouClient);
            const editorOdinId = dotYouClient.getHostIdentity() || '';

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
                circleIds,
                recipients,
                editorOdinId,
                record?.remoteFileId,
            );

            const existingNote = notes.find((n) => n.docId === noteId);
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
                        circleIds,
                        recipients,
                        lastEditedBy: editorOdinId,
                    },
                });
            } else {
                console.warn(
                    '[MarkCollaborative] Note not found locally, remote ACL updated but local state may be stale',
                );
            }

            toast.success('Note is now collaborative');
            return true;
        } catch (err) {
            console.error('Failed to make note collaborative:', err);
            toast.error('Failed to make note collaborative');
            return false;
        }
    };

    const revoke = async (note: NoteListEntry | null) => {
        if (!note || !dotYouClient) return;
        try {
            const provider = new NotesDriveProvider(dotYouClient);
            const editorOdinId = dotYouClient.getHostIdentity() || '';
            await provider.revokeNoteCollaboration(
                note.docId,
                editorOdinId,
            );
            await updateNoteMetadata({
                docId: note.docId,
                metadata: {
                    ...note.metadata,
                    folderId: MAIN_FOLDER_ID,
                    isCollaborative: false,
                    circleIds: undefined,
                    recipients: undefined,
                    lastEditedBy: editorOdinId,
                },
            });
            toast.success('Collaboration revoked');
        } catch (err) {
            console.error('Failed to revoke collaboration:', err);
            toast.error('Failed to revoke collaboration');
        }
    };

    return { share, revoke };
}
