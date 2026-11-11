/**
 * publish_to_feed (#1074): the app's Publish to feed (src/lib/share/publishNoteToFeed.ts) for an
 * agent, against `FeedDeps` (createFeedDeps in mcp/drive.ts). The MCP can't show the consent
 * page, so without the feed grant it says how to give it and publishes nothing.
 */
import { assertWritable, editWithRetry, type NoteForEdit, type WriteDeps } from '@/lib/agent/tools/write';

export interface FeedDeps {
    /** The page that gives this app write access to the feed, or null when it has it. */
    missingGrantUrl(): Promise<string | null>;
    /** Publishes the note (over `note.metadata.feedPostId` when set) and returns the post's id. */
    publish(note: NoteForEdit): Promise<string>;
    /** The post's page on the owner's feed. */
    postUrl(postId: string): Promise<string>;
}

export interface PublishToFeedResult {
    id: string;
    status: 'published' | 'updated';
    postId: string;
    url: string;
}

/**
 * Publishes a note with Read+write access to the owner's feed, or updates the post published
 * before, and keeps the post's id on the note (`feedPostId`) as the app does.
 */
export async function publishToFeed(deps: WriteDeps, feed: FeedDeps, { id }: { id: string }): Promise<PublishToFeedResult> {
    const [grants, note] = await Promise.all([deps.loadGrants(), deps.fetchNoteForEdit(id)]);
    assertWritable(grants, note, id);

    const grantUrl = await feed.missingGrantUrl();
    if (grantUrl) {
        throw new Error(
            "publish_to_feed: Journal MCP can't write to your feed yet, so nothing was published. " +
                `Open this link in a browser signed in to your Homebase to allow it, then retry: ${grantUrl}`
        );
    }

    const before = note.metadata.feedPostId;
    const postId = await feed.publish(note);
    if (postId !== before) await editWithRetry(deps, id, () => {}, { metadata: { feedPostId: postId }, fetched: [grants, note] });
    return { id, status: before && postId === before ? 'updated' : 'published', postId, url: await feed.postUrl(postId) };
}
