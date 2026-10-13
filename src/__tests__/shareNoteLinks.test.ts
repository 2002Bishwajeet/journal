import { describe, it, expect } from 'vitest';
import { shareNoteLinkHref } from '@/lib/share/markdownPipeline';
import { sanitize } from 'hast-util-sanitize';
import type { Element, Root } from 'hast';
import { sanitizeSchema } from '@/lib/utils/shareSanitizeSchema';

describe('shareNoteLinkHref (#616)', () => {
    it('points a note link at the linked note on the same identity', () => {
        expect(shareNoteLinkHref('journal:note/abc-123', 'me.homebase.id')).toBe('/share/me.homebase.id/abc-123');
    });

    it('encodes the identity', () => {
        expect(shareNoteLinkHref('journal:note/abc', 'a b/c')).toBe('/share/a%20b%2Fc/abc');
    });

    it.each(['https://example.com/journal:note/x', 'journal:note/a/b', 'journal:note/', 'javascript:alert(1)', '/share/x/y', '#fn-1'])(
        'leaves %s alone',
        (url) => {
            expect(shareNoteLinkHref(url, 'me.homebase.id')).toBe(url);
        },
    );

    it('lets a journal: href through the sanitizer so it can be rewritten', () => {
        const tree: Root = { type: 'root', children: [{ type: 'element', tagName: 'a', properties: { href: 'journal:note/x' }, children: [] }] };
        const out = sanitize(tree, sanitizeSchema) as Root;
        expect((out.children[0] as Element).properties.href).toBe('journal:note/x');
    });
});
