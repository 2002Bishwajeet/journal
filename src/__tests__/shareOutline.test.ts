import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import type { Element, Root } from 'hast';
import { sanitizeSchema } from '@/lib/utils/shareSanitizeSchema';
import { rehypeHeadingIds, slugifyHeading } from '@/lib/share/markdownPipeline';

const el = (tagName: string, text: string, properties: Element['properties'] = {}): Element => ({
    type: 'element',
    tagName,
    properties,
    children: text ? [{ type: 'text', value: text }] : [],
});

describe('slugifyHeading', () => {
    it('lowercases and turns spaces into dashes', () => {
        expect(slugifyHeading('Hello Big World')).toBe('hello-big-world');
    });
    it('drops other punctuation', () => {
        expect(slugifyHeading("What's new? (2026)")).toBe('whats-new-2026');
    });
    it('keeps non-latin letters', () => {
        expect(slugifyHeading('Über café')).toBe('über-café');
    });
    it('falls back to section when nothing is left', () => {
        expect(slugifyHeading('')).toBe('section');
        expect(slugifyHeading('🚀 !!!')).toBe('section');
    });
});

describe('rehypeHeadingIds', () => {
    it('ids h2-h4, not h1, with -2/-3 on repeats', () => {
        const tree: Root = {
            type: 'root',
            children: [el('h1', 'Intro'), el('h2', 'Intro'), el('h3', 'Intro'), el('h4', 'Intro'), el('h2', '🎉'), el('h2', '')],
        };
        rehypeHeadingIds()(tree);
        const ids = (tree.children as Element[]).map((c) => c.properties.id);
        expect(ids).toEqual([undefined, 'intro', 'intro-2', 'intro-3', 'section', 'section-2']);
    });

    it('keeps an existing id (the footnotes label)', () => {
        const tree: Root = { type: 'root', children: [el('h2', 'Footnotes', { id: 'user-content-footnote-label' })] };
        rehypeHeadingIds()(tree);
        expect((tree.children[0] as Element).properties.id).toBe('user-content-footnote-label');
    });

    it('runs after sanitize: ids carry no user-content- prefix', async () => {
        const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeSanitize, sanitizeSchema).use(rehypeHeadingIds);
        const tree = (await processor.run(processor.parse('# Title\n\n## First\n\n### Second\n\n## First'))) as Root;
        const headings = tree.children.filter((c): c is Element => c.type === 'element');
        expect(headings.map((h) => [h.tagName, h.properties.id])).toEqual([
            ['h1', undefined],
            ['h2', 'first'],
            ['h3', 'second'],
            ['h2', 'first-2'],
        ]);
    });
});
