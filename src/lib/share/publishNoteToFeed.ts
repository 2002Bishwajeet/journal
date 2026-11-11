/**
 * Publish to feed (#1074) without React: the note's Yjs state as an Article post on the owner's
 * public channel, images read from the note's file on the server. Shared by the app's
 * usePublishToFeed and the MCP's publish_to_feed.
 */
import * as Y from 'yjs';
import type { TargetDriveAccessRequest } from '@homebase-id/js-lib/auth';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { DrivePermissionType, getFileHeader, type DotYouClient } from '@homebase-id/js-lib/core';
import { BlogConfig } from '@homebase-id/js-lib/public';
import { getCover } from '@/lib/editor/cover';
import { JOURNAL_DRIVE } from '@/lib/homebase/config';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { buildFeedArticle, saveFeedPost, type FeedArticleInput } from '@/lib/share/feedArticle';
import type { NoteFileContent } from '@/types';

// The feed's default public channel (#1074). Asked for on the first Publish to feed, never at
// sign-in, so people who never publish see no extra consent. The MCP checks for the same grant.
export const FEED_DRIVE_REQUEST: TargetDriveAccessRequest = {
    ...BlogConfig.PublicChannelDrive,
    name: 'Public posts',
    description: 'Publish notes to your feed',
    permissions: [DrivePermissionType.Read, DrivePermissionType.Write],
    // Owned by the feed; slugs only apply if the drive doesn't exist yet
    driveSlug: 'posts',
    driveTypeSlug: 'channel',
};

export interface PublishNoteToFeedInput extends Pick<FeedArticleInput, 'title' | 'publicNoteUrl' | 'bakeImage'> {
    /** The note's Yjs state; null for an empty note. */
    ydoc: Y.Doc | null;
    /** The note's remote fileId: its images are read from the server copy. */
    noteFileId: string | undefined;
    /** The post published before, to update. */
    feedPostId: string | undefined;
}

/** Publishes the note and returns its post's global transit id (see saveFeedPost): `feedPostId` on an update. */
export async function publishNoteToFeed(client: DotYouClient, input: PublishNoteToFeedInput): Promise<string> {
    const fileId = input.noteFileId;
    // Without it every image would be left out of the post
    if (!fileId) throw new Error('The note is not on the server yet');
    const ydoc = input.ydoc ?? new Y.Doc();
    const doc = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment('prosemirror'));
    const cover = getCover(ydoc);

    const header = await getFileHeader<NoteFileContent>(client, JOURNAL_DRIVE, fileId, { decrypt: true });
    const provider = new NotesDriveProvider(client);
    const article = await buildFeedArticle({
        doc,
        title: input.title,
        coverSrc: cover?.src,
        noteFileId: fileId,
        publicNoteUrl: input.publicNoteUrl,
        readImage: (key) => provider.readPayloadBlob(fileId, key, header),
        bakeImage: input.bakeImage,
    });
    return saveFeedPost(client, article, input.feedPostId);
}
