import { toast } from 'sonner';
import { fetchMembersOfCircle } from '@homebase-id/js-lib/network';
import { useDotYouClientContext } from '@/components/auth';
import { useSyncService } from '@/hooks/useSyncService';
import { useNotes } from '@/hooks/useNotes';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { ShareCircleProvider, type EnrollResult } from '@/lib/homebase/ShareCircleProvider';
import { SharePushProvider } from '@/lib/homebase/SharePushProvider';
import { COLLABORATIVE_FOLDER_ID, MAIN_FOLDER_ID, ownerConsoleDriveUrl } from '@/lib/homebase/config';
import { getRecipientsOfOwnNotes, getSyncRecord } from '@/lib/db';
import { normalizeOdinId } from '@/lib/homebase/shareTargets';
import { READ_ONLY_SHARE_NOTICE_KEY, readString, writeString } from '@/lib/storage';
import type { NoteListEntry } from '@/types';

export interface SelectedCircle {
    circleId: string;
    name: string;
}

/** Who a note is shared with: circles, whose members edit it, and people who only view it (#897). */
export interface ShareTargets {
    circles: SelectedCircle[];
    odinIds: string[];
}

export interface ShareResult {
    shared: boolean;
    /**
     * Set once per identity on this device when recipients got Read only because the
     * Journal drive isn't Journal's: the owner console page where the owner can adopt it.
     */
    readOnlyDriveUrl?: string;
}

/** One toast per person the share circle refused; the share itself still saves (#730). */
function reportEnrollment(results: EnrollResult[]) {
    for (const { odinId, status } of results) {
        if (status === 'contactNotReviewed') {
            toast.error(`Review ${odinId} in Homebase (Connections) so they can open shared notes.`);
        } else if (status === 'notAConnectedIdentity') {
            toast.error(`${odinId} isn't connected to you, so they can't open shared notes.`);
        } else if (status === 'failed') {
            toast.error(`Couldn't give ${odinId} access to shared notes.`);
        }
    }
}

/**
 * Removes the people in `candidates` who no longer have any of the owner's notes shared
 * with them: editors (`recipients`) from the share circle, viewers (`odinIds`) from the
 * viewers' circle (#897).
 */
async function unenrollUnshared(
    shareCircle: ShareCircleProvider,
    ownerOdinId: string,
    candidates: string[],
    role: 'recipients' | 'odinIds' = 'recipients',
) {
    if (candidates.length === 0) return;
    try {
        const stillShared = new Set(await getRecipientsOfOwnNotes(ownerOdinId, role));
        const unshared = candidates.filter((odinId) => odinId !== ownerOdinId && !stillShared.has(odinId));
        if (unshared.length === 0) return;
        await (role === 'odinIds' ? shareCircle.unenrollViewers(unshared) : shareCircle.unenroll(unshared));
    } catch (err) {
        console.error('[ShareCircle] Could not remove people from the share circle:', err);
    }
}

/**
 * Sharing a note with circles and people, changing who it is shared with, and revoking
 * it: the remote upload, the drive access through Journal's circles, the push and the
 * local metadata, with user-visible toasts.
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
     * Shares the note with the circles (editors) and people (viewers), or changes who an
     * existing share names.
     */
    const share = async (noteId: string, { circles, ...targets }: ShareTargets): Promise<ShareResult> => {
        const odinIds = [...new Set(targets.odinIds.map(normalizeOdinId))];
        if (circles.length === 0 && odinIds.length === 0) {
            toast.error('Choose at least one circle or person');
            return { shared: false };
        }

        if (!dotYouClient) {
            toast.error('Not authenticated');
            return { shared: false };
        }

        const editorOdinId = dotYouClient.getHostIdentity() || '';
        if (odinIds.includes(editorOdinId)) {
            toast.error("You can't share a note with yourself");
            return { shared: false };
        }

        try {
            // Resolve members now, not from the rows' queries: a row clicked before its
            // members loaded would otherwise invite nobody
            const circleIds = circles.map((c) => c.circleId);
            const memberLists = await Promise.all(
                circles.map((c) => fetchMembersOfCircle(dotYouClient, c.circleId)),
            );
            const empty = circles.find((_, i) => !memberLists[i]?.some((m) => m.domain));
            if (empty) {
                toast.error(`${empty.name} has no members`);
                return { shared: false };
            }
            const recipients = [...new Set(memberLists.flatMap((l) => (l ?? []).map((m) => m.domain)))].filter(Boolean);

            const provider = new NotesDriveProvider(dotYouClient);
            const shareCircle = new ShareCircleProvider(dotYouClient);
            const editors = recipients.filter((r) => r !== editorOdinId);

            // Recipients get drive access through Journal's own circles before the push
            // sends them to the note: editors Read and Write, viewers Read only (#897).
            // A failure here doesn't stop the share (#730).
            let canEdit = true;
            const enrollRecipients = async () => {
                try {
                    if (editors.length > 0) {
                        ({ canEdit } = await shareCircle.ensureShareCircle());
                        reportEnrollment(await shareCircle.enroll(editors));
                    }
                    if (odinIds.length > 0) reportEnrollment(await shareCircle.enrollViewers(odinIds));
                } catch (err) {
                    console.error('[ShareCircle] Could not give recipients access:', err);
                    toast.error("Couldn't give the people you shared with access to the note.");
                }
            };

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
                { circleIds, odinIds, recipients },
                editorOdinId,
                record?.remoteFileId,
                enrollRecipients,
            );

            const existingNote = notes.find((n) => n.docId === noteId);
            const previous = existingNote?.metadata;
            // Best-effort and never throws: the people just added get a push (#745)
            await new SharePushProvider(dotYouClient).send(
                noteId,
                [...new Set([...recipients, ...odinIds])],
                [...(previous?.recipients ?? []), ...(previous?.odinIds ?? [])],
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
                const dropped = (existingNote.metadata.recipients ?? []).filter((r) => !recipients.includes(r));
                await unenrollUnshared(shareCircle, editorOdinId, dropped);
                const droppedViewers = (existingNote.metadata.odinIds ?? []).filter((v) => !odinIds.includes(v));
                await unenrollUnshared(shareCircle, editorOdinId, droppedViewers, 'odinIds');
            } else {
                console.warn(
                    '[MarkCollaborative] Note not found locally, remote ACL updated but local state may be stale',
                );
            }

            toast.success(existingNote?.metadata.isCollaborative ? 'Sharing updated' : 'Note is now collaborative');
            // The drive belongs to the owner console, so Journal's circle can grant Read only
            if (canEdit || readString(READ_ONLY_SHARE_NOTICE_KEY) === editorOdinId) return { shared: true };
            writeString(READ_ONLY_SHARE_NOTICE_KEY, editorOdinId);
            return {
                shared: true,
                readOnlyDriveUrl: ownerConsoleDriveUrl(dotYouClient.getRoot()),
            };
        } catch (err) {
            console.error('Failed to make note collaborative:', err);
            toast.error('Failed to make note collaborative');
            return { shared: false };
        }
    };

    const revoke = async (note: NoteListEntry | null) => {
        if (!note || !dotYouClient) return;
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
            const shareCircle = new ShareCircleProvider(dotYouClient);
            await unenrollUnshared(shareCircle, editorOdinId, note.metadata.recipients ?? []);
            await unenrollUnshared(shareCircle, editorOdinId, note.metadata.odinIds ?? [], 'odinIds');
            toast.success('Collaboration revoked');
        } catch (err) {
            console.error('Failed to revoke collaboration:', err);
            toast.error('Failed to revoke collaboration');
        }
    };

    return { share, revoke };
}
