/**
 * Regression cover for #175: the public share page's sanitizeSchema had to be
 * widened just enough to let `attachment://` image refs through rehype-sanitize
 * (rehypeSanitize forwards straight to hast-util-sanitize's `sanitize`, exercised
 * here directly), without loosening XSS protection for any other scheme.
 */
import { describe, it, expect } from 'vitest';
import { sanitize } from 'hast-util-sanitize';
import type { Element, Nodes, Root } from 'hast';
import { sanitizeSchema } from '@/lib/utils/shareSanitizeSchema';

function imgTree(src: string): Root {
    return {
        type: 'root',
        children: [{ type: 'element', tagName: 'img', properties: { src }, children: [] }],
    };
}

// sanitize() types its input/output as the broader `Nodes`, but root in -> root
// out (the same assumption rehype-sanitize itself makes).
function imgSrc(tree: Nodes): string | undefined {
    const img = (tree as Root).children[0] as Element;
    return img.properties.src as string | undefined;
}

describe('SharePage sanitizeSchema', () => {
    it('allows an attachment:// image src through', () => {
        const out = sanitize(imgTree('attachment://file-abc/jrnl_img'), sanitizeSchema);
        expect(imgSrc(out)).toBe('attachment://file-abc/jrnl_img');
    });

    it('still allows a plain https:// image src', () => {
        const out = sanitize(imgTree('https://example.com/pic.png'), sanitizeSchema);
        expect(imgSrc(out)).toBe('https://example.com/pic.png');
    });

    it('still strips a javascript: image src', () => {
        const out = sanitize(imgTree('javascript:alert(1)'), sanitizeSchema);
        expect(imgSrc(out)).toBeUndefined();
    });

    it('still strips a data: image src', () => {
        const out = sanitize(imgTree('data:text/html,<script>alert(1)</script>'), sanitizeSchema);
        expect(imgSrc(out)).toBeUndefined();
    });
});
