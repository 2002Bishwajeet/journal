/**
 * ShareCardPreview shows the owner how a public note's link will look when it is
 * pasted into a chat or social app: image (or the Journal logo), domain, title
 * and description.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShareCardPreview } from '@/components/share/ShareCardPreview';

type Props = Parameters<typeof ShareCardPreview>[0];

function render(over: Partial<Props> = {}): string {
    return renderToStaticMarkup(
        createElement(ShareCardPreview, {
            title: 'My note',
            description: 'The first paragraph',
            domain: 'journal.example',
            ...over,
        }),
    );
}

describe('ShareCardPreview', () => {
    it('renders the Journal logo when there is no image', () => {
        expect(render()).toContain('/logo.webp');
    });

    it('renders the image instead of the logo when given one', () => {
        const html = render({ imageUrl: 'https://cdn.example/cover.jpg' });
        expect(html).toContain('https://cdn.example/cover.jpg');
        expect(html).not.toContain('/logo.webp');
    });

    it('renders the domain, title and description text', () => {
        const html = render();
        expect(html).toContain('journal.example');
        expect(html).toContain('My note');
        expect(html).toContain('The first paragraph');
    });

    it('escapes the title and description as text', () => {
        const html = render({ title: '<b>x</b>', description: '<i>y</i>' });
        expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
        expect(html).toContain('&lt;i&gt;y&lt;/i&gt;');
        expect(html).not.toContain('<b>x</b>');
    });
});
