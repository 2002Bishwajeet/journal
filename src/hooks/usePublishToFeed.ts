import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useIsMutating, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDotYouClientContext } from '@/components/auth';
import { useMissingPermissions } from '@/hooks/auth/useMissingPermissions';
import { useSecurityContext } from '@/hooks/securityContext/useSecurityContext';
import { useNotes } from '@/hooks/useNotes';
import { useSyncService } from '@/hooks/useSyncService';
import { flushToIndexedDb, getSearchIndexEntry, getSyncRecord, updateSearchIndexMetadata, updateSyncStatus } from '@/lib/db';
import { JOURNAL_APP_ID } from '@/lib/homebase/config';
import { bakeImageEdits } from '@/lib/share/bakeImageEdits';
import { FEED_DRIVE_REQUEST, publishNoteToFeed } from '@/lib/share/publishNoteToFeed';
import { collaborateReturnUrl } from '@/lib/share/shareAccess';
import { noteShareUrl } from '@/lib/share/sharedFolder';
import { publicOrigin } from '@/lib/native';
import { loadLocalYDoc } from '@/lib/yjs/loadDoc';
import type { DocumentMetadata } from '@/types';

/** The note whose Publish to feed went to the Homebase consent page, so the publish goes on after it. */
export const FEED_CONSENT_PENDING_KEY = 'journal.feedConsentPending';
export const FEED_PERMISSION_MESSAGE =
    'Publishing to your feed needs permission to write to your public posts. Nothing was published. Press Publish to feed to ask again.';

// A flag older than this is left from backing out of the consent page, not a return from it
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

const readPending = () => {
    try {
        const [noteId, at] = (sessionStorage.getItem(FEED_CONSENT_PENDING_KEY) ?? '').split(' ');
        return Date.now() - Number(at) < PENDING_MAX_AGE_MS ? noteId : null;
    } catch {
        return null;
    }
};
const writePending = (noteId: string | null) => {
    try {
        if (noteId) sessionStorage.setItem(FEED_CONSENT_PENDING_KEY, `${noteId} ${Date.now()}`);
        else sessionStorage.removeItem(FEED_CONSENT_PENDING_KEY);
    } catch {
        // Without storage the publish just doesn't resume after the consent page
    }
};

/**
 * Publish to feed (#1074): the note as an Article post on the owner's public channel, or an
 * update of the post published before (`feedPostId`). The author's summary (#1360) is kept on
 * the note (`feedSummary`) and sent as the post's abstract.
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
    const missing = useMissingPermissions({
        appId: JOURNAL_APP_ID, drives: [FEED_DRIVE_REQUEST], permissions: [], returnUrl: collaborateReturnUrl(noteId),
    });
    // This dialog opened back from the consent page (or Back out of it)
    const [fromConsent] = useState(() => readPending() === noteId);

    const notes = get.data;
    const metadata = notes?.find((n) => n.docId === noteId)?.metadata;
    const feedPostId = metadata?.feedPostId;
    const summary = metadata?.feedSummary ?? '';
    // The context persisted before the consent page predates the grant: wait for this mount's fetch
    const permissionKnown = security.isFetchedAfterMount && !security.isFetching && !!security.data;
    // Back from the consent page without the grant: nothing was published. A press asks again.
    const permissionDeclined = fromConsent && permissionKnown && !!missing;

    const saveToNote = async (patch: Pick<DocumentMetadata, 'feedPostId' | 'feedSummary'>) => {
        const current = await getSearchIndexEntry(noteId);
        if (!current) return;
        await updateSearchIndexMetadata(noteId, current.title, { ...current.metadata, ...patch });
        await updateSyncStatus(noteId, 'pending');
        void syncNote(noteId);
    };

    /** Keeps the summary on the note, so a republish (or one after the consent page) sends it. */
    const saveSummary = async (text: string) => {
        const feedSummary = text.trim() || undefined;
        if (feedSummary !== metadata?.feedSummary) await saveToNote({ feedSummary });
    };

    // Keyed by note, so a Share dialog reopened mid-publish can't start a second post
    const mutationKey = ['publishToFeed', noteId];
    const publishing = useMutation({
        mutationKey,
        mutationFn: async () => {
            // Push the latest edits first: the images are read from the server
            await syncNote(noteId);
            const fileId = (await getSyncRecord(noteId))?.remoteFileId;
            const ydoc = await loadLocalYDoc(noteId);
            // As saved on the note: a publish resumed after the consent page has no field to read
            const savedSummary = (await getSearchIndexEntry(noteId))?.metadata.feedSummary;
            const identity = dotYouClient.getHostIdentity();
            const postId = await publishNoteToFeed(dotYouClient, {
                ydoc,
                title: metadata?.title ?? '',
                summary: savedSummary,
                noteFileId: fileId,
                feedPostId,
                publicNoteUrl: (id) =>
                    notes?.find((n) => n.docId === id)?.metadata.isPublic ? noteShareUrl(publicOrigin(), identity, id) : null,
                bakeImage: bakeImageEdits,
            }).finally(() => ydoc?.destroy());
            if (postId !== feedPostId) await saveToNote({ feedPostId: postId });
            return postId === feedPostId;
        },
        // From the result, not the render: the post id is saved before this runs
        onSuccess: (updated) => toast.success(updated ? 'Updated on your feed' : 'Published to your feed'),
        onError: (err) => {
            console.error('Failed to publish to the feed:', err);
            toast.error('Failed to publish to your feed');
        },
    });
    const isPublishing = useIsMutating({ mutationKey }) > 0;

    /** Publishes with `summaryText`, the Summary field as it is now, saving it on the note first. */
    const publish = async (summaryText: string) => {
        if (!permissionKnown || isPublishing) return;
        await saveSummary(summaryText);
        if (missing) {
            writePending(noteId);
            // The consent page unloads this one: the summary must be on disk, not just committed
            await flushToIndexedDb();
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

    return { publish, summary, saveSummary, isPublishing, isPublished: !!feedPostId, canPublish: permissionKnown && !isPublishing, permissionDeclined };
}
