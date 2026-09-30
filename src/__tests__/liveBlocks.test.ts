import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveBlockPreview } from '@/components/liveBlocks/LiveBlockPreview';
import { HTML_BLOCK_CDN_HOSTS, buildSrcdoc, frameHeightFromMessage, liveBlockKind, svgDataUri } from '@/lib/liveBlocks';

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
  // Written out, not built from HTML_BLOCK_CDN_HOSTS: a host added to that list must fail here.
  const CDN = 'https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com';
  const CSP = `default-src 'none'; script-src 'unsafe-inline' ${CDN}; style-src 'unsafe-inline' ${CDN}; img-src data: blob:; font-src data: ${CDN}; media-src data: blob:; form-action 'none'; base-uri 'none'`;
  const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  const HEIGHT_SCRIPT =
    "<script>new ResizeObserver(() => parent.postMessage({ journalLiveBlock: 1, height: Math.ceil(document.documentElement.getBoundingClientRect().height) }, '*')).observe(document.documentElement)</script>";

  it('should put the CSP meta first and the height script after the source', () => {
    const source = '<p>hi</p><script>document.body.append("ran")</script>';
    const srcdoc = buildSrcdoc(source);
    expect(srcdoc).toBe(`<!doctype html>${CSP_META}${source}${HEIGHT_SCRIPT}`);
    expect(srcdoc.indexOf('Content-Security-Policy')).toBeLessThan(srcdoc.indexOf(source));
    expect(srcdoc.indexOf(HEIGHT_SCRIPT)).toBe(srcdoc.indexOf(source) + source.length);
  });

  it('should allow scripts, styles and fonts from jsDelivr, cdnjs and unpkg, and from no other host (#409)', () => {
    expect(HTML_BLOCK_CDN_HOSTS).toEqual(['https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://unpkg.com']);
    const csp = buildSrcdoc('').match(/content="([^"]*)"/)![1];
    expect(csp).toBe(CSP);
    // No connect-src (so default-src 'none' keeps fetch blocked), and no host outside the three directives.
    expect(csp).not.toContain('connect-src');
    expect(csp.match(/https:[^ ;]*/g)).toHaveLength(9);
  });

  it('should add a script that only reports: it never listens for a message', () => {
    expect(buildSrcdoc('')).not.toMatch(/addEventListener|onmessage/);
  });
});

describe('frameHeightFromMessage', () => {
  // Stand-ins for two windows: only their identity matters.
  const frame = {} as Window;
  const otherWindow = {} as Window;
  const report = (height: unknown) => ({ journalLiveBlock: 1, height });

  it('should return the height its own frame reported', () => {
    expect(frameHeightFromMessage({ source: frame, data: report(900) }, frame)).toBe(900);
  });

  it('should clamp the height to 120–1600px', () => {
    expect(frameHeightFromMessage({ source: frame, data: report(0) }, frame)).toBe(120);
    expect(frameHeightFromMessage({ source: frame, data: report(5000) }, frame)).toBe(1600);
  });

  it('should ignore a message from another window', () => {
    expect(frameHeightFromMessage({ source: otherWindow, data: report(900) }, frame)).toBeNull();
    expect(frameHeightFromMessage({ source: null, data: report(900) }, frame)).toBeNull();
  });

  it('should ignore every message while the frame has no window', () => {
    expect(frameHeightFromMessage({ source: null, data: report(900) }, null)).toBeNull();
  });

  it('should ignore a height that is not a finite number', () => {
    for (const height of ['900', NaN, Infinity, null, undefined, { valueOf: () => 900 }]) {
      expect(frameHeightFromMessage({ source: frame, data: report(height) }, frame)).toBeNull();
    }
  });

  it('should ignore a message without the marker', () => {
    for (const data of [{ height: 900 }, { journalLiveBlock: '1', height: 900 }, { journalLiveBlock: true, height: 900 }, 'height: 900', 900, null, undefined]) {
      expect(frameHeightFromMessage({ source: frame, data }, frame)).toBeNull();
    }
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
