/**
 * publish_to_feed (#1074): the MCP publishes a note to the owner's feed as the app does, keeps
 * the post id on the note so a second publish updates the post, and without the feed grant
 * publishes nothing and returns the link that asks for it.
 */
import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createJournalMcpServer, type McpDriveDeps } from '../../mcp/createServer';
import type { FeedDeps } from '../../mcp/feed';
import { stripForFeed } from '../../mcp/drive';
import { createDoc } from '@/lib/agent/editEngine';
import { NO_EDITS } from '@/lib/images/imageEdits';
import type { AgentGrants } from '@/lib/agent/grants';
import type { NoteSummary } from '@/lib/agent/tools/read';
import type { DocumentMetadata } from '@/types';

const SUMMARY: NoteSummary = { id: 'n1', title: 'Note One', folderId: 'F1', tags: [], modified: '2024-01-01T00:00:00.000Z' };
const GRANT_URL = 'https://owner.dotyou.cloud/owner/appupdate?feed';

function setup({ access = 'write', feedPostId, grantUrl = null }: { access?: 'read' | 'write'; feedPostId?: string; grantUrl?: string | null } = {}) {
    const grants: AgentGrants = { version: 1, folders: { F1: access }, notes: {} };
    const metadata: DocumentMetadata = {
        title: 'Note One',
        folderId: 'F1',
        tags: [],
        timestamps: { created: SUMMARY.modified, modified: SUMMARY.modified },
        excludeFromAI: false,
        feedPostId,
    };
    const uploads: DocumentMetadata[] = [];
    const feed: FeedDeps = {
        missingGrantUrl: vi.fn(async () => grantUrl),
        publish: vi.fn(async (note) => note.metadata.feedPostId ?? 'post-1'),
        postUrl: async (postId) => `https://owner.dotyou.cloud/posts/public-posts/${postId}`,
    };
    const deps = {
        loadGrants: async () => grants,
        listFolders: async () => [{ id: 'F1', name: 'Folder One' }],
        listNotes: async () => [SUMMARY],
        fetchNoteForEdit: async (id: string) =>
            id === 'n1' ? { summary: SUMMARY, doc: createDoc('body'), versionTag: 'v1', fileId: 'f1', metadata } : null,
        uploadNoteEdit: async (_id: string, edit: { metadata: DocumentMetadata }) => {
            uploads.push(edit.metadata);
            return '2024-02-01T00:00:00.000Z';
        },
        feed,
    } as unknown as McpDriveDeps;
    return { deps, feed, uploads };
}

async function callPublish(deps: McpDriveDeps, id = 'n1') {
    const server = createJournalMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name: 'publish_to_feed', arguments: { id } });
    return { isError: !!result.isError, text: (result.content as Array<{ text: string }>)[0].text };
}

describe('publish_to_feed', () => {
    it('publishes the note, keeps the post id on it, and returns the post', async () => {
        const { deps, feed, uploads } = setup();
        const { isError, text } = await callPublish(deps);

        expect(isError).toBe(false);
        expect(JSON.parse(text)).toEqual({ id: 'n1', status: 'published', postId: 'post-1', url: 'https://owner.dotyou.cloud/posts/public-posts/post-1' });
        expect(feed.publish).toHaveBeenCalledTimes(1);
        expect(uploads).toHaveLength(1);
        expect(uploads[0].feedPostId).toBe('post-1');
    });

    it('updates the post published before without rewriting the note', async () => {
        const { deps, feed, uploads } = setup({ feedPostId: 'post-1' });
        const { text } = await callPublish(deps);

        expect(JSON.parse(text)).toMatchObject({ status: 'updated', postId: 'post-1' });
        expect(vi.mocked(feed.publish).mock.calls[0][0].metadata.feedPostId).toBe('post-1');
        expect(uploads).toHaveLength(0);
    });

    it('publishes nothing without the feed grant and returns the link that asks for it', async () => {
        const { deps, feed, uploads } = setup({ grantUrl: GRANT_URL });
        const { isError, text } = await callPublish(deps);

        expect(isError).toBe(true);
        expect(text).toContain("Journal MCP can't write to your feed yet, so nothing was published");
        expect(text).toContain(GRANT_URL);
        expect(feed.publish).not.toHaveBeenCalled();
        expect(uploads).toHaveLength(0);
    });

    it('needs Read+write access to the note', async () => {
        const { deps, feed } = setup({ access: 'read' });
        const { isError, text } = await callPublish(deps);

        expect(isError).toBe(true);
        expect(text).toContain('Note is read-only for agents: n1');
        expect(feed.missingGrantUrl).not.toHaveBeenCalled();
        expect(feed.publish).not.toHaveBeenCalled();
    });

    it('treats a note it may not see as not found', async () => {
        const { deps, feed } = setup();
        const { isError, text } = await callPublish(deps, 'missing');

        expect(isError).toBe(true);
        expect(text).toContain('Note not found: missing');
        expect(feed.publish).not.toHaveBeenCalled();
    });
});

describe('stripForFeed', () => {
    it("refuses an edited image, which only the app's canvas can redraw", async () => {
        const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
        await expect(stripForFeed(image, { ...NO_EDITS, rotate: 90 })).rejects.toThrow('only the Journal app can publish');
    });

    it('drops the EXIF of an unedited JPEG', async () => {
        const exif = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
        const scan = [0xff, 0xda, 0x00, 0x02, 0x11, 0xff, 0xd9];
        const jpeg = new Uint8Array([0xff, 0xd8, ...exif, ...scan]);
        const out = await stripForFeed(new Blob([jpeg], { type: 'image/jpeg' }), NO_EDITS);

        expect(out.type).toBe('image/jpeg');
        expect([...new Uint8Array(await out.arrayBuffer())]).toEqual([0xff, 0xd8, ...scan]);
    });

    it('keeps an unedited GIF as it is', async () => {
        const gif = new Blob([new TextEncoder().encode('GIF89a')], { type: 'image/gif' });
        expect(await stripForFeed(gif, NO_EDITS)).toBe(gif);
    });

    it('refuses a type it cannot strip, which the app re-encodes', async () => {
        const avif = new Blob([new Uint8Array([0, 0, 0, 0x20])], { type: 'image/avif' });
        await expect(stripForFeed(avif, NO_EDITS)).rejects.toThrow('an image of type image/avif');
    });
});
