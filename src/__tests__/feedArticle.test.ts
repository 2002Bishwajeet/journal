/**
 * #1074: a note becomes an Article post on the owner's feed. Images move onto the post with
 * their edits baked in, note links resolve to public URLs or plain text, live blocks stay code
 * blocks, and a second Publish updates the post instead of creating another.
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityGroupType } from '@homebase-id/js-lib/core';

const { mockSavePost, mockGetPost } = vi.hoisted(() => ({ mockSavePost: vi.fn(), mockGetPost: vi.fn() }));
vi.mock('@homebase-id/js-lib/public', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/public')>()),
    savePost: mockSavePost,
    getPostByGlobalTransitId: mockGetPost,
}));

import { BlogConfig, readingTimeOf } from '@homebase-id/js-lib/public';
import { buildFeedArticle, saveFeedPost, type FeedArticleInput } from '@/lib/share/feedArticle';
import type { TiptapJSONContent } from '@homebase-id/js-lib/public';
import { fakeDotYouClient } from './fakes';

const FILE_ID = 'note-file';
const img = (src: string, attrs: Record<string, unknown> = {}): TiptapJSONContent => ({ type: 'image', attrs: { src, alt: 'a', caption: null, ...attrs } });
const text = (t: string): TiptapJSONContent => ({ type: 'text', text: t });

const DOC: TiptapJSONContent = {
    type: 'doc',
    content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('Heading first')] },
        {
            type: 'paragraph',
            content: [
                text('See '),
                { type: 'noteLink', attrs: { noteId: 'public-note', label: 'Public one' } },
                text(' and '),
                { type: 'noteLink', attrs: { noteId: 'private-note', label: 'Private one' } },
            ],
        },
        { type: 'paragraph', content: [img(`attachment://${FILE_ID}/jrnl_img0`, { crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, rotate: 90, flipH: true, flipV: null })] },
        { type: 'paragraph', content: [img('attachment://another-note/jrnl_img9')] },
        { type: 'gallery', attrs: { layout: 'row' }, content: [img(`attachment://${FILE_ID}/jrnl_img1`), img('https://example.com/a.png')] },
        { type: 'codeBlock', attrs: { language: 'html id=k3f9 wide' }, content: [text('<p>hi</p>')] },
    ],
};

const input = (over: Partial<FeedArticleInput> = {}): FeedArticleInput => ({
    doc: DOC,
    title: 'My note',
    coverSrc: `attachment://${FILE_ID}/jrnl_img2`,
    noteFileId: FILE_ID,
    publicNoteUrl: (id) => (id === 'public-note' ? 'https://app.test/share/me/public-note' : null),
    readImage: vi.fn(async (key: string) => new Blob([key], { type: 'image/jpeg' })),
    bakeImage: vi.fn(async (image: Blob) => new Blob([`baked:${await image.text()}`], { type: 'image/jpeg' })),
    ...over,
});

const find = (node: TiptapJSONContent, type: string): TiptapJSONContent[] =>
    [...(node.type === type ? [node] : []), ...(node.content ?? []).flatMap((c) => find(c, type))];

describe('buildFeedArticle', () => {
    it('hands the gallery layout and images per row (#1367) to the published doc unchanged', async () => {
        const doc: TiptapJSONContent = {
            type: 'doc',
            content: [{ type: 'gallery', attrs: { layout: 'grid', columns: 3 }, content: [img('https://example.com/a.png'), img('https://example.com/b.png')] }],
        };
        const { content } = await buildFeedArticle(input({ doc, coverSrc: undefined }));
        expect(find(content.bodyDoc.doc, 'gallery').map((g) => g.attrs)).toEqual([{ layout: 'grid', columns: 3 }]);
    });

    it('uploads the note images as post payloads and drops the edit attrs', async () => {
        const args = input();
        const { content, files } = await buildFeedArticle(args);
        const images = find(content.bodyDoc.doc, 'image');

        // The image of another note is left out; the remote one keeps its src
        expect(images.map((i) => i.attrs?.fileKey ?? i.attrs?.src)).toEqual(['pst_mdi0', 'pst_mdi1', 'https://example.com/a.png']);
        for (const image of images) {
            for (const attr of ['crop', 'rotate', 'flipH', 'flipV']) expect(image.attrs).not.toHaveProperty(attr);
        }
        expect(images[0].attrs).not.toHaveProperty('src');
        expect(images[0].attrs?.alt).toBe('a');
        expect(files.map((f) => f.key)).toEqual(['pst_mdi0', 'pst_mdi1', 'pst_mdi2']);
        expect(await files[0].file.text()).toBe('baked:jrnl_img0');
        expect(args.bakeImage).toHaveBeenCalledWith(expect.any(Blob), { crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, rotate: 90, flipH: true, flipV: false });
        expect(args.readImage).not.toHaveBeenCalledWith('jrnl_img9');
    });

    it('makes the cover the primary media file', async () => {
        const { content } = await buildFeedArticle(input());
        expect(content.primaryMediaFile).toEqual({ fileKey: 'pst_mdi2', fileId: undefined, type: 'image/jpeg' });
        expect((await buildFeedArticle(input({ coverSrc: undefined }))).content.primaryMediaFile).toBeUndefined();
    });

    it('links a note link to a public note and writes a private one as plain text', async () => {
        const { content } = await buildFeedArticle(input());
        const para = content.bodyDoc.doc.content?.[1];

        expect(find(content.bodyDoc.doc, 'noteLink')).toEqual([]);
        expect(para?.content).toEqual([
            text('See '),
            { type: 'text', text: 'Public one', marks: [{ type: 'link', attrs: { href: 'https://app.test/share/me/public-note' } }] },
            text(' and '),
            text('Private one'),
        ]);
    });

    it('keeps a live block as a code block with its info string', async () => {
        const { content } = await buildFeedArticle(input());
        expect(find(content.bodyDoc.doc, 'codeBlock')[0].attrs).toEqual({ language: 'html id=k3f9 wide' });
    });

    it('stores the Slate body with its hash, and the title as caption', async () => {
        const { content } = await buildFeedArticle(input());

        expect(content.bodyDoc.format).toBe('tiptap-v1');
        expect(content.bodyDoc.slateHash).toBe(createHash('sha256').update(JSON.stringify(content.body)).digest('hex'));
        expect(content.caption).toBe('My note');
    });

    it('sets readingTimeStats from the converted doc', async () => {
        const { content } = await buildFeedArticle(input());
        expect(content.readingTimeStats).toEqual(readingTimeOf(content.bodyDoc.doc));
        expect(content.readingTimeStats?.words).toBeGreaterThan(0);
    });

    describe('abstract', () => {
        const para = (t: string): TiptapJSONContent => ({ type: 'paragraph', content: [text(t)] });
        const doc: TiptapJSONContent = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [text('Title')] }, para('  Hello,   brave new world. '), para('Second paragraph.')] };
        const abstractFor = async (summary?: string) => (await buildFeedArticle(input({ doc, summary }))).content.abstract;

        it('is empty without a summary, not the first paragraph', async () => {
            expect(await abstractFor()).toBe('');
            expect(await abstractFor('   ')).toBe('');
        });

        it('is the summary as given, trimmed', async () => {
            expect(await abstractFor('  A short take.  ')).toBe('A short take.');
        });

        it('is empty when the summary repeats the first paragraph or starts it', async () => {
            expect(await abstractFor('hello, brave new world')).toBe('');
            expect(await abstractFor('HELLO,  BRAVE\nNEW   WORLD!')).toBe('');
            expect(await abstractFor('Hello, brave')).toBe('');
        });

        it('keeps a summary that goes beyond the first paragraph', async () => {
            expect(await abstractFor('Hello, brave new world. Second paragraph.')).toBe('Hello, brave new world. Second paragraph.');
        });
    });
});

describe('saveFeedPost', () => {
    const client = fakeDotYouClient();
    const built = { content: { caption: 'T', abstract: 'A', body: [], bodyDoc: { format: 'tiptap-v1' as const, doc: { type: 'doc' }, slateHash: 'h' } }, files: [] };

    beforeEach(() => {
        vi.clearAllMocks();
        mockSavePost.mockResolvedValue({ globalTransitIdFileIdentifier: { globalTransitId: 'post-new' } });
    });

    it('creates a public post on the default public channel', async () => {
        expect(await saveFeedPost(client, built)).toBe('post-new');

        const [, file, odinId, channelId] = mockSavePost.mock.calls[0];
        expect(mockGetPost).not.toHaveBeenCalled();
        expect(odinId).toBeUndefined();
        expect(channelId).toBe(BlogConfig.PublicChannelId);
        expect(file.fileId).toBeUndefined();
        expect(file.serverMetadata.accessControlList).toEqual({ requiredSecurityGroup: SecurityGroupType.Anonymous });
        expect(file.fileMetadata.appData.content).toMatchObject({ type: 'Article', channelId: BlogConfig.PublicChannelId, caption: 'T', slug: 't' });
    });

    it('updates the post published before instead of creating one', async () => {
        mockGetPost.mockResolvedValue({
            fileId: 'post-file',
            fileMetadata: { versionTag: 'v1', appData: { content: { id: 'p', slug: 'old-slug', caption: 'Old', type: 'Article' } } },
            serverMetadata: { accessControlList: { requiredSecurityGroup: SecurityGroupType.Anonymous } },
        });
        // An update response need not carry the post's global transit id
        mockSavePost.mockResolvedValue({ newVersionTag: 'v2' });

        expect(await saveFeedPost(client, built, 'post-1')).toBe('post-1');

        const [, file] = mockSavePost.mock.calls[0];
        expect(mockGetPost).toHaveBeenCalledWith(client, BlogConfig.PublicChannelId, 'post-1');
        expect(file.fileId).toBe('post-file');
        expect(file.fileMetadata.versionTag).toBe('v1');
        expect(file.fileMetadata.appData.content).toMatchObject({ id: 'p', slug: 'old-slug', caption: 'T' });
    });

    it('publishes anew when the earlier post is gone from the feed', async () => {
        mockGetPost.mockResolvedValue(null);
        expect(await saveFeedPost(client, built, 'deleted-post')).toBe('post-new');
        expect(mockSavePost.mock.calls[0][1].fileId).toBeUndefined();
    });
});
