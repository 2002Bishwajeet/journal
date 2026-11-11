/**
 * A note as an `Article` post on the owner's Homebase feed (#1074).
 *
 * `buildFeedArticle` is pure apart from the image reader and baker it is given: it turns the
 * note's Tiptap JSON into the article's `body` / `bodyDoc`, with every image re-uploaded as a
 * payload of the post (edits baked in) and note links resolved. `saveFeedPost` writes it to the
 * public channel, as a new post or over the one published before.
 */
import type { DotYouClient, HomebaseFile, NewHomebaseFile, NewMediaFile } from '@homebase-id/js-lib/core';
import { SecurityGroupType } from '@homebase-id/js-lib/core';
import { makeSlug } from '@homebase-id/js-lib/helpers';
import { BlogConfig, getPostByGlobalTransitId, savePost, type Article } from '@homebase-id/js-lib/public';
import { getNewId } from '@/lib/utils';
import { readEdits, NO_EDITS, type ImageEdits } from '@/lib/images/imageEdits';
import { parseAttachmentSrc } from '@/lib/utils/attachmentSrc';
import { toStoredArticleBody, type StoredBodyDoc, type TiptapJSONContent } from '@/lib/share/articleBody';

/** An article with the Tiptap document next to its Slate body (odin-js#1035 adds `bodyDoc` to `Article`). */
type FeedArticle = Article & { bodyDoc: StoredBodyDoc };

/** The post's own payload keys for the note's images, as the feed's uploader names media. */
const FEED_MEDIA_KEY_PREFIX = 'pst_mdi';
const EDIT_ATTRS = ['crop', 'rotate', 'flipH', 'flipV'];

export interface FeedArticleInput {
    /** The note body as Tiptap JSON (from its Yjs state). */
    doc: TiptapJSONContent;
    title: string;
    /** The cover's `attachment://` src, when the note has one. */
    coverSrc?: string;
    /** The note's remote fileId: only images of this note are read (see parseAttachmentSrc). */
    noteFileId: string;
    /** A linked note's public URL, or null while that note is not public. */
    publicNoteUrl: (noteId: string) => string | null | Promise<string | null>;
    /** The bytes of one of the note's image payloads. */
    readImage: (payloadKey: string) => Promise<Blob | null>;
    bakeImage: (image: Blob, edits: ImageEdits) => Promise<Blob>;
}

interface BuiltFeedArticle {
    content: Pick<FeedArticle, 'caption' | 'abstract' | 'body' | 'bodyDoc' | 'primaryMediaFile'>;
    files: NewMediaFile[];
}

const textOf = (node: TiptapJSONContent): string =>
    node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('');

/** The article fields and the payloads to upload with them. */
export async function buildFeedArticle(input: FeedArticleInput): Promise<BuiltFeedArticle> {
    // One slot per payload, reserved in document order before any await, so the keys are the
    // same on every run while the images are read in parallel. A failed read leaves a gap.
    const slots: (NewMediaFile | null)[] = [];
    // One payload per original, however often the note shows it with the same edits
    const uploaded = new Map<string, Promise<string | null>>();
    // One bake at a time: each holds a full-size bitmap and canvas
    let baking: Promise<unknown> = Promise.resolve();

    const upload = (src: string, edits: ImageEdits): Promise<string | null> => {
        const ref = parseAttachmentSrc(src, input.noteFileId);
        if (!ref) return Promise.resolve(null);
        const id = `${ref.payloadKey}:${JSON.stringify(edits)}`;
        let key = uploaded.get(id);
        if (!key) {
            const slot = slots.push(null) - 1;
            key = (async () => {
                const original = await input.readImage(ref.payloadKey);
                if (!original) return null;
                const baked = baking.then(() => input.bakeImage(original, edits));
                baking = baked.catch(() => undefined);
                const fileKey = `${FEED_MEDIA_KEY_PREFIX}${slot}`;
                slots[slot] = { key: fileKey, file: await baked };
                return fileKey;
            })();
            uploaded.set(id, key);
        }
        return key;
    };

    const convert = async (node: TiptapJSONContent): Promise<TiptapJSONContent[]> => {
        if (node.type === 'image') {
            const attrs = { ...node.attrs };
            const src = typeof attrs.src === 'string' ? attrs.src : '';
            const edits = readEdits(attrs);
            for (const k of EDIT_ATTRS) delete attrs[k];
            if (/^https?:\/\//.test(src)) return [{ ...node, attrs }];
            // A pending (blob:) image or one of another note can't be published
            const fileKey = await upload(src, edits);
            if (!fileKey) return [];
            delete attrs.src;
            delete attrs['data-pending-id'];
            return [{ ...node, attrs: { ...attrs, fileKey } }];
        }
        if (node.type === 'noteLink') {
            const label = typeof node.attrs?.label === 'string' ? node.attrs.label : '';
            if (!label) return [];
            const href = typeof node.attrs?.noteId === 'string' ? await input.publicNoteUrl(node.attrs.noteId) : null;
            return [href ? { type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] } : { type: 'text', text: label }];
        }
        if (!node.content) return [node];
        return [{ ...node, content: (await Promise.all(node.content.map(convert))).flat() }];
    };

    // Both started before either is awaited, so the cover's slot comes after the body's
    const converting = convert(input.doc);
    const covering = input.coverSrc ? upload(input.coverSrc, NO_EDITS) : Promise.resolve(null);
    const [[doc], coverKey] = await Promise.all([converting, covering]);
    const files = slots.filter((f): f is NewMediaFile => !!f);
    const cover = coverKey ? files.find((f) => f.key === coverKey) : undefined;
    const { body, bodyDoc } = await toStoredArticleBody(doc);
    const abstract = (doc.content ?? []).filter((n) => n.type === 'paragraph').map((n) => textOf(n).trim()).find(Boolean) ?? '';

    return {
        content: {
            caption: input.title,
            abstract,
            body,
            bodyDoc,
            primaryMediaFile: cover ? { fileKey: cover.key as string, fileId: undefined, type: cover.file.type } : undefined,
        },
        files,
    };
}

/**
 * Publishes the article on the public channel and returns the post's global transit id. With
 * `feedPostId` (the post published before) it updates that post, replacing its payloads;
 * a post deleted on the feed meanwhile is published anew.
 */
export async function saveFeedPost(client: DotYouClient, article: BuiltFeedArticle, feedPostId?: string): Promise<string> {
    const channelId = BlogConfig.PublicChannelId;
    const existing = feedPostId ? await getPostByGlobalTransitId<FeedArticle>(client, channelId, feedPostId) : null;

    let file: HomebaseFile<FeedArticle> | NewHomebaseFile<FeedArticle>;
    if (existing) {
        const content = { ...existing.fileMetadata.appData.content, ...article.content };
        file = { ...existing, fileMetadata: { ...existing.fileMetadata, appData: { ...existing.fileMetadata.appData, content } } };
    } else {
        const content: FeedArticle = {
            id: getNewId(),
            channelId,
            type: 'Article',
            slug: '',
            reactAccess: true,
            ...article.content,
        };
        file = {
            fileMetadata: { appData: { content, userDate: Date.now() } },
            serverMetadata: { accessControlList: { requiredSecurityGroup: SecurityGroupType.Anonymous } },
        };
        content.slug = makeSlug(file);
    }

    const result = await savePost(client, file, undefined, channelId, article.files);
    // An update keeps the post's id; don't rely on the update response carrying it
    const id = existing ? feedPostId : 'globalTransitIdFileIdentifier' in result ? result.globalTransitIdFileIdentifier?.globalTransitId : undefined;
    if (!id) throw new Error('The feed returned no post id');
    return id;
}
