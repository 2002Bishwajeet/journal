import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveBlockPreview } from '@/components/liveBlocks/LiveBlockPreview';
import { buildSrcdoc, frameHeightFromMessage, liveBlockKind, svgDataUri, type FrameTheme } from '@/lib/liveBlocks';

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
  const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'">`;
  const HEIGHT_SCRIPT =
    "<script>new ResizeObserver(() => parent.postMessage({ journalLiveBlock: 1, height: Math.ceil(document.documentElement.getBoundingClientRect().height) }, '*')).observe(document.documentElement)</script>";

  // The dark theme's values in src/index.css.
  const THEME: FrameTheme = {
    colorScheme: 'dark',
    tokens: {
      '--background': '#1C1B1A',
      '--foreground': '#E6E4DD',
      '--muted': '#2C2B29',
      '--muted-foreground': '#8A8780',
      '--border': '#3E3D3A',
      '--accent': '#2C2B29',
      '--secondary': '#2C2B29',
      '--primary': '#E6E4DD',
      '--radius': '0.5rem',
    },
    fontFamily: '"Inter Variable", system-ui, sans-serif',
    lineHeight: '1.5',
  };
  /** Everything buildSrcdoc puts before the source. */
  const head = (source: string, theme = THEME) => {
    const srcdoc = buildSrcdoc(source, theme);
    return srcdoc.slice(0, srcdoc.length - source.length - HEIGHT_SCRIPT.length);
  };

  it('should put the CSP meta first, then one theme style, the source and the height script', () => {
    const source = '<style>body{color:red}</style><p>hi</p><script>document.body.append("ran")</script>';
    const srcdoc = buildSrcdoc(source, THEME);
    expect(srcdoc.startsWith(`<!doctype html>${CSP_META}<style>`)).toBe(true);
    expect(srcdoc.endsWith(`</style>${source}${HEIGHT_SCRIPT}`)).toBe(true);
    // The block's own CSS comes after the one injected style, so it wins.
    expect(head(source).match(/<style>/g)).toHaveLength(1);
    expect(head(source).endsWith('</style>')).toBe(true);
  });

  it('should give the frame the theme tokens with the values passed in', () => {
    const style = head('<p>hi</p>');
    for (const [name, value] of Object.entries(THEME.tokens)) expect(style).toContain(`${name}:${value};`);

    const changed = head('<p>hi</p>', { ...THEME, tokens: { ...THEME.tokens, '--foreground': '#2C2B29', '--radius': '0.25rem' } });
    expect(changed).toContain('--foreground:#2C2B29;');
    expect(changed).toContain('--radius:0.25rem;');
    expect(changed).not.toContain('--foreground:#E6E4DD;');
  });

  it("should declare the app's colour scheme, which is what lets the frame be transparent", () => {
    expect(head('')).toContain('color-scheme:dark}');
    expect(head('', { ...THEME, colorScheme: 'light' })).toContain('color-scheme:light}');
  });

  it("should make the page transparent, in the note's text colour, font and line height", () => {
    const style = head('<p>hi</p>');
    expect(style).toContain('html,body{background:transparent}');
    expect(style).toContain('body{margin:0;color:var(--foreground);font-family:"Inter Variable", system-ui, sans-serif;line-height:1.5}');
    expect(head('', { ...THEME, fontFamily: 'ui-serif, Georgia, serif', lineHeight: 'normal' })).toContain(
      'font-family:ui-serif, Georgia, serif;line-height:normal}',
    );
  });

  it('should add base rules for box sizing, links, form controls, table cells and images', () => {
    const style = head('<p>hi</p>');
    expect(style).toContain('*,*::before,*::after{box-sizing:border-box}');
    expect(style).toContain('a{color:inherit}');
    expect(style).toContain('button,input,select,textarea{font:inherit}');
    expect(style).toContain('th,td{border:1px solid var(--border);');
    expect(style).toContain('img{max-width:100%}');
  });

  it('should add a script that only reports: it never listens for a message', () => {
    expect(buildSrcdoc('', THEME)).not.toMatch(/addEventListener|onmessage/);
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

  // The frame's document needs the theme of the page around it, so it is built once the
  // frame is mounted: src/__tests__/liveBlockFrame.test.tsx.
  it('should never load the frame from a URL, and send no referrer', () => {
    const markup = render();
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).not.toContain(' src=');
  });

  it('should leave the frame element transparent', () => {
    expect(render()).not.toContain('bg-');
  });
});
