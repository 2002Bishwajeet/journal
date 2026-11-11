/**
 * Publish to feed (#1074) without React: the note's Yjs state as an Article post on the owner's
 * public channel, images read from the note's file on the server. Shared by the app's
 * usePublishToFeed and the MCP's publish_to_feed.
 */
import type * as Y from 'yjs';
import type { TargetDriveAccessRequest } from '@homebase-id/js-lib/auth';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { DrivePermissionType, getFileHeader, getPayloadBytes, type DotYouClient } from '@homebase-id/js-lib/core';
import { BlogConfig } from '@homebase-id/js-lib/public';
import { getCover } from '@/lib/editor/cover';
import { JOURNAL_DRIVE } from '@/lib/homebase/config';
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
    driveSlug: BlogConfig.PublicChannelSlug,
    driveTypeSlug: 'channel',
};

export interface PublishNoteToFeedInput extends Pick<FeedArticleInput, 'title' | 'noteFileId' | 'publicNoteUrl' | 'bakeImage'> {
    /** The note's Yjs state as the server has it (its images are read from the server). */
    ydoc: Y.Doc;
    /** The post published before, to update. */
    feedPostId: string | undefined;
}

/** Publishes the note and returns its post's global transit id (see saveFeedPost). */
export async function publishNoteToFeed(client: DotYouClient, input: PublishNoteToFeedInput): Promise<string> {
    const { ydoc, noteFileId: fileId } = input;
    const doc = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment('prosemirror'));
    const cover = getCover(ydoc);

    const header = fileId ? await getFileHeader<NoteFileContent>(client, JOURNAL_DRIVE, fileId, { decrypt: true }) : null;
    const article = await buildFeedArticle({
        doc,
        title: input.title,
        coverSrc: cover?.src,
        noteFileId: fileId,
        publicNoteUrl: input.publicNoteUrl,
        // With lastModified, so the browser can't hand back a stale copy (#451)
        readImage: async (key) => {
            if (!fileId) return null;
            const lastModified = header?.fileMetadata.payloads?.find((p) => p.key === key)?.lastModified;
            const data = await getPayloadBytes(client, JOURNAL_DRIVE, fileId, key, { decrypt: true, lastModified });
            return data ? new Blob([new Uint8Array(data.bytes)], { type: data.contentType }) : null;
        },
        bakeImage: input.bakeImage,
    });
    return saveFeedPost(client, article, input.feedPostId);
}
