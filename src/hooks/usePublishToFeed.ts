import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { toast } from 'sonner';
import type { TargetDriveAccessRequest } from '@homebase-id/js-lib/auth';
import { DrivePermissionType, getFileHeader, getPayloadBytes } from '@homebase-id/js-lib/core';
import { BlogConfig } from '@homebase-id/js-lib/public';
import { useDotYouClientContext } from '@/components/auth';
import { useMissingPermissions } from '@/hooks/auth/useMissingPermissions';
import { useSecurityContext } from '@/hooks/securityContext/useSecurityContext';
import { useNotes } from '@/hooks/useNotes';
import { useSyncService } from '@/hooks/useSyncService';
import { getDocumentUpdates, getSearchIndexEntry, getSyncRecord, updateSearchIndexMetadata, updateSyncStatus } from '@/lib/db';
import { getCover } from '@/lib/editor/cover';
import { JOURNAL_APP_ID, JOURNAL_DRIVE } from '@/lib/homebase/config';
import { buildFeedArticle, saveFeedPost } from '@/lib/share/feedArticle';
import { noteShareUrl } from '@/lib/share/sharedFolder';
import type { NoteFileContent } from '@/types';

// The feed's default public channel (#1074). Asked for on the first Publish to feed, never at
// sign-in, so people who never publish see no extra consent.
export const FEED_DRIVE_REQUEST: TargetDriveAccessRequest = {
    ...BlogConfig.PublicChannelDrive,
    name: 'Public posts',
    description: 'Publish notes to your feed',
    permissions: [DrivePermissionType.Read, DrivePermissionType.Write],
    // Owned by the feed; slugs only apply if the drive doesn't exist yet
    driveSlug: BlogConfig.PublicChannelSlug,
    driveTypeSlug: 'channel',
};

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
            const doc = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment('prosemirror'));
            const cover = getCover(ydoc);
            ydoc.destroy();

            const header = fileId ? await getFileHeader<NoteFileContent>(dotYouClient, JOURNAL_DRIVE, fileId, { decrypt: true }) : null;
            const { bakeImageEdits } = await import('@/lib/share/bakeImageEdits');
            const identity = dotYouClient.getHostIdentity();
            const article = await buildFeedArticle({
                doc,
                title: metadata?.title ?? '',
                coverSrc: cover?.src,
                noteFileId: fileId,
                publicNoteUrl: (id) =>
                    notes?.find((n) => n.docId === id)?.metadata.isPublic ? noteShareUrl(window.location.origin, identity, id) : null,
                // With lastModified, so the browser can't hand back a stale copy (#451)
                readImage: async (key) => {
                    if (!fileId) return null;
                    const lastModified = header?.fileMetadata.payloads?.find((p) => p.key === key)?.lastModified;
                    const data = await getPayloadBytes(dotYouClient, JOURNAL_DRIVE, fileId, key, { decrypt: true, lastModified });
                    return data ? new Blob([new Uint8Array(data.bytes)], { type: data.contentType }) : null;
                },
                bakeImage: bakeImageEdits,
            });
            const postId = await saveFeedPost(dotYouClient, article, feedPostId);
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
