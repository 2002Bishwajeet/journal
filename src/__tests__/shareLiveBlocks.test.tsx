// @vitest-environment happy-dom
/**
 * Live blocks on the public share page (#390): `mermaid`, `svg` and `html`
 * fences render as previews built from the code text, while raw iframes and
 * scripts in the markdown body stay stripped by the sanitizer.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';
import { LiveBlockAwarePre } from '@/components/share/LiveBlockAwarePre';

function render(markdown: string): string {
  return renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins, components: { pre: LiveBlockAwarePre } },
      markdown,
    ),
  );
}

const LIVE = [
  '```mermaid',
  'graph TD; A-->B',
  '```',
  '',
  '```svg',
  '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>',
  '```',
  '',
  '```html',
  '<h1>Hello live</h1>',
  '```',
].join('\n');

describe('share page live blocks', () => {
  const html = render(LIVE);

  it('renders an svg block as a data:image/svg+xml img', () => {
    expect(html).toMatch(/<img[^>]*src="data:image\/svg\+xml/);
  });

  it('renders an html block in a sandboxed iframe', () => {
    expect(html).toMatch(/<iframe[^>]*sandbox="allow-scripts"/);
    expect(html).toContain('Hello live');
  });

  it('renders a mermaid block into a preview container', () => {
    expect(html).toContain('data-live-block-preview="mermaid"');
  });

  it('keeps ordinary code blocks as plain highlighted code', () => {
    const plain = render('```ts\nconst a = 1;\n```');
    expect(plain).toContain('hljs-keyword');
    expect(plain).not.toContain('data-live-block');
  });

  it('does not render a raw iframe from the markdown body', () => {
    const out = render('before\n\n<iframe src="https://example.com"></iframe>\n\nafter');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('example.com');
  });

  it('does not render a raw script from the markdown body', () => {
    const out = render('before\n\n<script>window.pwned = 1</script>\n\nafter');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('window.pwned');
  });
});
