import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveBlockPreview } from '@/components/liveBlocks/LiveBlockPreview';
import { buildSrcdoc, liveBlockKind, svgDataUri } from '@/lib/liveBlocks';

describe('liveBlockKind', () => {
  it('should recognise mermaid, svg and html languages', () => {
    expect(liveBlockKind('mermaid')).toBe('mermaid');
    expect(liveBlockKind('svg')).toBe('svg');
    expect(liveBlockKind('html')).toBe('html');
  });

  it('should ignore case and surrounding whitespace', () => {
    expect(liveBlockKind('Mermaid')).toBe('mermaid');
    expect(liveBlockKind(' SVG ')).toBe('svg');
  });

  it('should return null for other or missing languages', () => {
    expect(liveBlockKind('js')).toBeNull();
    expect(liveBlockKind('')).toBeNull();
    expect(liveBlockKind(null)).toBeNull();
  });
});

describe('svgDataUri', () => {
  it('should prefix the encoded source with the svg data URI header', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
    expect(svgDataUri(source)).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`);
  });

  it('should not leave raw markup characters in the URI', () => {
    const uri = svgDataUri('<svg onload="alert(1)"></svg>');
    expect(uri).not.toMatch(/[<>"]/);
  });
});

describe('buildSrcdoc', () => {
  it('should put the CSP meta before the source', () => {
    const source = '<p>hi</p><script>document.body.append("ran")</script>';
    const srcdoc = buildSrcdoc(source);
    expect(srcdoc).toBe(
      `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'">${source}`
    );
    expect(srcdoc.indexOf('Content-Security-Policy')).toBeLessThan(srcdoc.indexOf(source));
  });
});

describe('LiveBlockPreview html', () => {
  const render = () => renderToStaticMarkup(createElement(LiveBlockPreview, { kind: 'html', source: '<p>hi</p>' }));

  it('should render an iframe whose sandbox is exactly allow-scripts', () => {
    expect(render().match(/<iframe[^>]* sandbox="([^"]*)"/)?.[1]).toBe('allow-scripts');
  });

  it('should load the source through srcdoc only, with no referrer', () => {
    const markup = render();
    expect(markup).toContain('srcDoc="&lt;!doctype html&gt;&lt;meta http-equiv=&quot;Content-Security-Policy&quot;');
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).not.toContain(' src=');
  });
});
