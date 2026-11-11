import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import * as Y from 'yjs';
import { toast } from 'sonner';
import { useDotYouClientContext } from '@/components/auth';
import { useMissingPermissions } from '@/hooks/auth/useMissingPermissions';
import { useSecurityContext } from '@/hooks/securityContext/useSecurityContext';
import { useNotes } from '@/hooks/useNotes';
import { useSyncService } from '@/hooks/useSyncService';
import { getDocumentUpdates, getSearchIndexEntry, getSyncRecord, updateSearchIndexMetadata, updateSyncStatus } from '@/lib/db';
import { JOURNAL_APP_ID } from '@/lib/homebase/config';
import { FEED_DRIVE_REQUEST, publishNoteToFeed } from '@/lib/share/publishNoteToFeed';
import { noteShareUrl } from '@/lib/share/sharedFolder';

/** The note whose Publish to feed went to the Homebase consent page, so the publish goes on after it. */
export const FEED_CONSENT_PENDING_KEY = 'journal.feedConsentPending';
export const FEED_PERMISSION_MESSAGE =
    'Publishing to your feed needs permission to write to your public posts. Nothing was published. Press Publish to feed to ask again.';

const readPending = () => {
    try {
        return sessionStorage.getItem(FEED_CONSENT_PENDING_KEY);
    } catch {
        return null;
    }
};
const writePending = (noteId: string | null) => {
    try {
        if (noteId) sessionStorage.setItem(FEED_CONSENT_PENDING_KEY, noteId);
        else sessionStorage.removeItem(FEED_CONSENT_PENDING_KEY);
    } catch {
        // Without storage the publish just doesn't resume after the consent page
    }
};

/**
 * Publish to feed (#1074): the note as an Article post on the owner's public channel, or an
 * update of the post published before (`feedPostId`).
 *
 * Write access to the channel is asked for on the first Publish, not at sign-in: the button
 * goes to the Homebase consent page, which returns to this dialog, and the publish goes on once
 * the grant shows in the security context. Declined, nothing is published and the dialog says so;
 * the next press asks again.
 */
export function usePublishToFeed(noteId: string) {
    const dotYouClient = useDotYouClientContext();
    const { get } = useNotes();
    const { syncNote } = useSyncService();
    const security = useSecurityContext().fetch;
    // After a permission grant the app reopens the share dialog from this URL
    const returnUrl = `${window.location.origin}${window.location.pathname}?action=collaborate&noteId=${noteId}`;
    const missing = useMissingPermissions({ appId: JOURNAL_APP_ID, drives: [FEED_DRIVE_REQUEST], permissions: [], returnUrl });
    // This dialog opened back from the consent page (or Back out of it)
    const [fromConsent] = useState(() => readPending() === noteId);

    const notes = get.data;
    const metadata = notes?.find((n) => n.docId === noteId)?.metadata;
    const feedPostId = metadata?.feedPostId;
    // The context persisted before the consent page predates the grant: wait for this mount's fetch
    const permissionKnown = security.isFetchedAfterMount && !security.isFetching && !!security.data;
    // Back from the consent page without the grant: nothing was published. A press asks again.
    const permissionDeclined = fromConsent && permissionKnown && !!missing;

    const saveFeedPostId = async (postId: string) => {
        const current = await getSearchIndexEntry(noteId);
        if (!current) return;
        await updateSearchIndexMetadata(noteId, current.title, { ...current.metadata, feedPostId: postId });
        await updateSyncStatus(noteId, 'pending');
        void syncNote(noteId);
    };

    const publishing = useMutation({
        mutationFn: async () => {
            // Push the latest edits first: the images are read from the server
            await syncNote(noteId);
            const fileId = (await getSyncRecord(noteId))?.remoteFileId;
            const updates = await getDocumentUpdates(noteId);
            const ydoc = new Y.Doc();
            if (updates.length) Y.applyUpdate(ydoc, Y.mergeUpdates(updates));
            const { bakeImageEdits } = await import('@/lib/share/bakeImageEdits');
            const identity = dotYouClient.getHostIdentity();
            const postId = await publishNoteToFeed(dotYouClient, {
                ydoc,
                title: metadata?.title ?? '',
                noteFileId: fileId,
                feedPostId,
                publicNoteUrl: (id) =>
                    notes?.find((n) => n.docId === id)?.metadata.isPublic ? noteShareUrl(window.location.origin, identity, id) : null,
                bakeImage: bakeImageEdits,
            }).finally(() => ydoc.destroy());
            if (postId !== feedPostId) await saveFeedPostId(postId);
        },
        onSuccess: () => toast.success(feedPostId ? 'Updated on your feed' : 'Published to your feed'),
        onError: (err) => {
            console.error('Failed to publish to the feed:', err);
            toast.error('Failed to publish to your feed');
        },
    });
    const isPublishing = publishing.isPending;

    const publish = async () => {
        if (!permissionKnown || isPublishing) return;
        if (missing) {
            writePending(noteId);
            window.location.assign(missing.url);
            return;
        }
        await publishing.mutateAsync().catch(() => undefined);
    };

    // Back from the consent page: publish once the grant shows, else say why not.
    const resumed = useRef(false);
    const resume = useEffectEvent(() => {
        if (resumed.current || !fromConsent || !permissionKnown) return;
        resumed.current = true;
        writePending(null);
        if (missing) toast.error(FEED_PERMISSION_MESSAGE);
        else publishing.mutate();
    });
    useEffect(() => resume(), [permissionKnown, noteId]);

    return { publish, isPublishing, isPublished: !!feedPostId, canPublish: permissionKnown && !isPublishing, permissionDeclined };
}
