// @vitest-environment happy-dom
/**
 * Live blocks on the public share page (#390): `mermaid`, `svg` and `html`
 * fences render as previews built from the code text, while raw iframes and
 * scripts in the markdown body stay stripped by the sanitizer.
 */
import { describe, it, expect } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';
import { LiveBlockAwarePre } from '@/components/share/LiveBlockAwarePre';

function markdownElement(markdown: string) {
  return createElement(
    Markdown,
    { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins, components: { pre: LiveBlockAwarePre } },
    markdown,
  );
}

function render(markdown: string): string {
  return renderToStaticMarkup(markdownElement(markdown));
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
  });

  it("builds an html block's frame from the code text, once the frame is mounted", async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const article = document.body.appendChild(document.createElement('article'));
    const root = createRoot(article);
    await act(async () => root.render(markdownElement('```html\n<h1>Hello live</h1>\n```')));
    expect(article.querySelector('iframe')?.getAttribute('srcdoc')).toContain('<h1>Hello live</h1>');
    await act(async () => root.unmount());
    article.remove();
  });

  it('renders a mermaid block into a preview container', () => {
    expect(html).toContain('data-live-block-preview="mermaid"');
  });

  it('shows a loading status for a mermaid block until its diagram is rendered', () => {
    expect(html).toMatch(/<div role="status"[^>]*>Rendering diagram…<\/div>/);
  });

  it('gives a mermaid and an svg block a View source toggle in a group named after its kind, and no header bar (#420)', () => {
    for (const label of ['Mermaid', 'SVG']) {
      expect(html).toMatch(
        new RegExp(`<div role="group" aria-label="${label} block"[^>]*><button type="button" aria-pressed="false"[^>]*><span[^>]*>View source</span></button>`),
      );
      expect(html).not.toMatch(new RegExp(`<span[^>]*>${label}</span>`));
    }
  });

  it('gives an html block no View source toggle: its controls group holds only Expand (#557)', () => {
    expect(html).toContain('data-live-block-preview="html"');
    expect(html).toMatch(/<div role="group" aria-label="HTML block"[^>]*><button type="button"[^>]*><span[^>]*>Expand<\/span><\/button><\/div>/);
    expect(render('```html\n<h1>x</h1>\n```')).not.toContain('View source');
  });

  it('marks an html block wide when its fence says so (#557)', () => {
    expect(render('```html wide id=k3f9\n<h1>x</h1>\n```')).toContain('data-live-block-wide');
    expect(render('```html id=k3f9\n<h1>x</h1>\n```')).not.toContain('data-live-block-wide');
  });

  it('renders a react block as a live block with no View source toggle, and a jsx block as plain code (#426)', () => {
    const react = render('```react\nfunction App() { return <p>hi</p>; }\n```');
    expect(react).not.toContain('View source');
    expect(react).toMatch(/<div role="group" aria-label="React block"[^>]*><button type="button"[^>]*><span[^>]*>Expand<\/span><\/button><\/div>/);
    expect(react).toContain('data-live-block-preview="react"');
    const jsx = render('```jsx\nfunction App() { return <p>hi</p>; }\n```');
    expect(jsx).not.toContain('data-live-block');
    expect(jsx).toContain('hljs-keyword');
  });

  it("highlights a react block's source as JSX (#426)", () => {
    const out = renderToStaticMarkup(
      createElement(Markdown, { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins }, '```react\nfunction App() { return <p>hi</p>; }\n```'),
    );
    expect(out).toContain('hljs-keyword');
    expect(out).toContain('hljs-tag');
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
