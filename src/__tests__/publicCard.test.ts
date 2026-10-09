/**
 * buildPublicCard derives the link-card data a public note publishes in its
 * plaintext header: a short description (owner override, else the first
 * paragraph) and an opt-in "allow search engines" flag.
 */
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import {
    buildPublicCard,
    fallbackShareDescription,
    firstParagraphText,
    mergeShareCard,
    truncateAtWord,
} from '@/lib/share/publicCard';
import { fallbackShareDescription as functionFallback } from '../../functions/_lib/shareMeta';
import { setCover, setDarkCover } from '@/lib/editor/cover';

function block(name: string, text: string): Y.XmlElement {
    const el = new Y.XmlElement(name);
    const t = new Y.XmlText();
    el.insert(0, [t]);
    t.insert(0, text);
    return el;
}

function buildDoc(blocks: Y.XmlElement[]): Y.Doc {
    const doc = new Y.Doc();
    doc.getXmlFragment('prosemirror').insert(0, blocks);
    return doc;
}

const toBlob = (doc: Y.Doc) => Y.encodeStateAsUpdate(doc);

describe('firstParagraphText', () => {
    it('picks the first paragraph after a heading', () => {
        const doc = buildDoc([block('heading', 'Title'), block('paragraph', 'Hello  world')]);
        expect(firstParagraphText(doc)).toBe('Hello world');
    });

    it('skips an empty paragraph', () => {
        const doc = buildDoc([block('paragraph', '   '), block('paragraph', 'Real text')]);
        expect(firstParagraphText(doc)).toBe('Real text');
    });

    it('skips code blocks and reads a blockquote', () => {
        const quote = new Y.XmlElement('blockquote');
        quote.insert(0, [block('paragraph', 'Quoted line')]);
        const doc = buildDoc([block('codeBlock', 'const x = 1'), quote]);
        expect(firstParagraphText(doc)).toBe('Quoted line');
    });

    it('returns an empty string for an empty doc', () => {
        expect(firstParagraphText(new Y.Doc())).toBe('');
    });
});

describe('truncateAtWord', () => {
    it('leaves short text alone', () => {
        expect(truncateAtWord('short text', 200)).toBe('short text');
    });

    it('cuts at the last space before max and appends an ellipsis', () => {
        expect(truncateAtWord('alpha beta gamma', 12)).toBe('alpha beta…');
    });
});

describe('buildPublicCard', () => {
    it('cuts a 500-char first paragraph to at most 201 chars ending with …', () => {
        const long = 'lorem '.repeat(84).slice(0, 500);
        expect(long).toHaveLength(500);
        const card = buildPublicCard(toBlob(buildDoc([block('paragraph', long)])), {});
        expect(card.description!.length).toBeLessThanOrEqual(201);
        expect(card.description!.endsWith('…')).toBe(true);
    });

    it('uses a custom shareDescription over the first paragraph', () => {
        const doc = buildDoc([block('paragraph', 'From the body')]);
        const card = buildPublicCard(toBlob(doc), { shareDescription: '  Custom blurb  ' });
        expect(card.description).toBe('Custom blurb');
    });

    it('falls back to the first paragraph when the custom description is whitespace', () => {
        const doc = buildDoc([block('paragraph', 'From the body')]);
        const card = buildPublicCard(toBlob(doc), { shareDescription: '   ' });
        expect(card.description).toBe('From the body');
    });

    it('returns only the card image for an empty doc, and {} without content', () => {
        expect(buildPublicCard(toBlob(new Y.Doc()), {})).toEqual({
            cardImageKey: 'jrnl_card',
            cardImageFrom: { title: 'Untitled' },
        });
        expect(buildPublicCard(undefined, {})).toEqual({});
    });

    it('omits the description instead of throwing for an undecodable blob', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(buildPublicCard(new Uint8Array([1, 2, 3]), {})).toEqual({});
    });

    it('sets indexable only when shareIndexable is true', () => {
        expect(buildPublicCard(undefined, { shareIndexable: true })).toEqual({ indexable: true });
        expect(buildPublicCard(undefined, { shareIndexable: false })).toEqual({});
        expect(buildPublicCard(undefined, {})).not.toHaveProperty('indexable');
    });

    it('sets coverKey from an uploaded attachment:// cover', () => {
        const doc = buildDoc([block('paragraph', 'Hello')]);
        setCover(doc, { src: 'attachment://F/jrnl_img4', positionY: 30 });
        expect(buildPublicCard(toBlob(doc), {}).coverKey).toBe('jrnl_img4');
    });

    it('omits coverKey while the cover upload is pending', () => {
        const doc = buildDoc([block('paragraph', 'Hello')]);
        setCover(doc, { src: 'attachment://F/jrnl_img4', pendingId: 'q1', positionY: 30 });
        expect(buildPublicCard(toBlob(doc), {})).not.toHaveProperty('coverKey');
    });

    it('keeps the link card on the light cover when a dark cover is set (#512)', () => {
        const doc = buildDoc([block('paragraph', 'Hello')]);
        setCover(doc, { src: 'attachment://F/jrnl_img4', positionY: 30 });
        setDarkCover(doc, { src: 'attachment://F/jrnl_img5', positionY: 70 });
        const card = buildPublicCard(toBlob(doc), {});
        expect(card.coverKey).toBe('jrnl_img4');
        expect(card.cardImageFrom?.cover).toEqual({ src: 'attachment://F/jrnl_img4', positionY: 30 });
    });

    it('omits coverKey when the note has no cover', () => {
        const doc = buildDoc([block('paragraph', 'Hello')]);
        expect(buildPublicCard(toBlob(doc), {})).not.toHaveProperty('coverKey');
    });

    it('sets the card image key and what it is drawn from for an uploaded cover', () => {
        const doc = buildDoc([block('paragraph', 'Hello')]);
        setCover(doc, { src: 'attachment://F/jrnl_img4', positionY: 30 });
        const card = buildPublicCard(toBlob(doc), { title: 'My note' });
        expect(card.cardImageKey).toBe('jrnl_card');
        expect(card.cardImageFrom).toEqual({
            title: 'My note',
            excerpt: 'Hello',
            cover: { src: 'attachment://F/jrnl_img4', positionY: 30 },
        });
    });

    it('draws the designed card, with no cover, while the cover upload is pending or without one (#434)', () => {
        const pending = buildDoc([block('paragraph', 'Hello')]);
        setCover(pending, { src: 'blob:x', pendingId: 'q1', positionY: 30 });
        const none = buildDoc([block('paragraph', 'Hello')]);
        for (const doc of [pending, none]) {
            const card = buildPublicCard(toBlob(doc), { title: 'My note' });
            expect(card.cardImageKey).toBe('jrnl_card');
            expect(card.cardImageFrom).toEqual({ title: 'My note', excerpt: 'Hello' });
        }
    });

    it('draws the card from the share description, and an untitled note as Untitled', () => {
        const doc = buildDoc([block('paragraph', 'Hello')]);
        const card = buildPublicCard(toBlob(doc), { title: '  ', shareDescription: 'Custom words' });
        expect(card.cardImageFrom).toEqual({ title: 'Untitled', excerpt: 'Custom words' });
        expect(buildPublicCard(toBlob(buildDoc([])), { title: 'Empty' }).cardImageFrom).toEqual({ title: 'Empty' });
    });
});

describe('fallbackShareDescription', () => {
    it('matches the Pages Function fallback exactly', () => {
        expect(fallbackShareDescription('X')).toBe(functionFallback('X'));
    });
});

describe('mergeShareCard', () => {
    const base = { title: 'Note', tags: [], shareDescription: 'Old' };

    it('stores an empty description as undefined', () => {
        const merged = mergeShareCard(base, { shareDescription: '' });
        expect(merged.shareDescription).toBeUndefined();
        expect(JSON.parse(JSON.stringify(merged))).not.toHaveProperty('shareDescription');
    });

    it('stores a whitespace-only description as undefined', () => {
        expect(mergeShareCard(base, { shareDescription: '   ' }).shareDescription).toBeUndefined();
    });

    it('sets a custom description and keeps the other metadata', () => {
        expect(mergeShareCard(base, { shareDescription: 'Custom text' }))
            .toEqual({ title: 'Note', tags: [], shareDescription: 'Custom text' });
    });

    it('persists shareIndexable: true without touching the description', () => {
        expect(mergeShareCard(base, { shareIndexable: true }))
            .toEqual({ ...base, shareIndexable: true });
    });

    it('leaves fields that are not in the patch unchanged', () => {
        const withIndex = { ...base, shareIndexable: true };
        expect(mergeShareCard(withIndex, { shareDescription: 'New' }).shareIndexable).toBe(true);
    });
});
