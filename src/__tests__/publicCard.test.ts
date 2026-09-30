/**
 * buildPublicCard derives the link-card data a public note publishes in its
 * plaintext header: a short description (owner override, else the first
 * paragraph) and an opt-in "allow search engines" flag.
 */
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { buildPublicCard, firstParagraphText, truncateAtWord } from '@/lib/share/publicCard';
import { setCover } from '@/lib/editor/cover';

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

    it('returns {} for an empty doc with no overrides', () => {
        expect(buildPublicCard(toBlob(new Y.Doc()), {})).toEqual({});
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

    it('omits coverKey when the note has no cover', () => {
        const doc = buildDoc([block('paragraph', 'Hello')]);
        expect(buildPublicCard(toBlob(doc), {})).not.toHaveProperty('coverKey');
    });
});
