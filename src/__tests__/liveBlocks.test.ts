import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveBlockPreview } from '@/components/liveBlocks/LiveBlockPreview';
import {
  FRAME_TOKENS,
  HTML_BLOCK_CDN_HOSTS,
  buildSrcdoc,
  frameHeightFromMessage,
  isEscapeFromFrame,
  liveBlockKind,
  svgDataUri,
  type FrameTheme,
} from '@/lib/liveBlocks';

describe('liveBlockKind', () => {
  it('should recognise mermaid, svg, html and react languages', () => {
    expect(liveBlockKind('mermaid')).toBe('mermaid');
    expect(liveBlockKind('svg')).toBe('svg');
    expect(liveBlockKind('html')).toBe('html');
    expect(liveBlockKind('react')).toBe('react');
    expect(liveBlockKind('React')).toBe('react');
  });

  it('should leave jsx and tsx as ordinary code blocks, so a code sample never runs (#426)', () => {
    expect(liveBlockKind('jsx')).toBeNull();
    expect(liveBlockKind('tsx')).toBeNull();
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
  const ESCAPE_SCRIPT =
    "<script>addEventListener('keydown', function (event) { if (event.key === 'Escape') parent.postMessage({ journalLiveBlock: 1, escape: 1 }, '*'); })</script>";

  // The dark theme's values in src/index.css.
  const THEME: FrameTheme = {
    colorScheme: 'dark',
    tokens: {
      '--background': '#1C1B1A',
      '--foreground': '#E6E4DD',
      '--card': '#242321',
      '--card-foreground': '#E6E4DD',
      '--popover': '#242321',
      '--popover-foreground': '#E6E4DD',
      '--muted': '#2C2B29',
      '--muted-foreground': '#8A8780',
      '--border': '#3E3D3A',
      '--input': '#242321',
      '--accent': '#2C2B29',
      '--accent-foreground': '#E6E4DD',
      '--secondary': '#2C2B29',
      '--secondary-foreground': '#E6E4DD',
      '--primary': '#E6E4DD',
      '--primary-foreground': '#1C1B1A',
      '--destructive': '#7f1d1d',
      '--destructive-foreground': '#E6E4DD',
      '--ring': '#8A8780',
      '--radius': '0.5rem',
      '--chart-1': '#DBD9D2',
      '--chart-2': '#CCABA1',
      '--chart-3': '#86977D',
      '--chart-4': '#BF9F68',
      '--chart-5': '#7FA1B7',
    },
    fontFamily: '"Inter Variable", system-ui, sans-serif',
    lineHeight: '1.5',
  };
  /** Everything buildSrcdoc puts before the source. */
  const head = (source: string, theme = THEME) => {
    const srcdoc = buildSrcdoc(source, theme);
    return srcdoc.slice(0, srcdoc.length - source.length - HEIGHT_SCRIPT.length - ESCAPE_SCRIPT.length);
  };

  it('should put the CSP meta first, then one theme style, journal.storage, the source, the height script and the Esc relay', () => {
    const source = '<style>body{color:red}</style><p>hi</p><script>document.body.append("ran")</script>';
    const srcdoc = buildSrcdoc(source, THEME);
    expect(srcdoc.startsWith(`<!doctype html>${CSP_META}<style>`)).toBe(true);
    expect(srcdoc.endsWith(`</script>${source}${HEIGHT_SCRIPT}${ESCAPE_SCRIPT}`)).toBe(true);
    // The block's own CSS comes after the one injected style, so it wins.
    expect(head(source).match(/<style>/g)).toHaveLength(1);
    // Between the style and the source, one script: journal.storage (#410).
    expect(head(source).slice(head(source).indexOf('</style>'))).toMatch(/^<\/style><script>[^<]*window\.journal = [^<]*<\/script>$/);
  });

  it('should give the frame the theme tokens with the values passed in', () => {
    const style = head('<p>hi</p>');
    for (const [name, value] of Object.entries(THEME.tokens)) expect(style).toContain(`${name}:${value};`);

    const changed = head('<p>hi</p>', { ...THEME, tokens: { ...THEME.tokens, '--foreground': '#2C2B29', '--radius': '0.25rem' } });
    expect(changed).toContain('--foreground:#2C2B29;');
    expect(changed).toContain('--radius:0.25rem;');
    expect(changed).not.toContain('--foreground:#E6E4DD;');
  });

  it("should give the frame the note's font as --font-sans too, for a react block's font-sans (#427)", () => {
    expect(head('')).toContain('--font-sans:"Inter Variable", system-ui, sans-serif;');
  });

  it("should make a react block's shadows softer in the dark theme (#559)", () => {
    expect(head('')).toContain('--shadow-strength:0.6;');
    expect(head('', { ...THEME, colorScheme: 'light' })).toContain('--shadow-strength:1;');
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
    expect(style).toContain(':where(button,input,select,textarea){font:inherit}');
    expect(style).toContain('th,td{border:1px solid var(--border);');
    expect(style).toContain('img{max-width:100%}');
  });

  describe('form controls (#424)', () => {
    const style = head('<button>Go</button>');
    const BUTTONS = 'button,input:is([type=button],[type=submit],[type=reset])';
    const FIELDS = 'input:not([type=button],[type=submit],[type=reset],[type=checkbox],[type=radio],[type=range],[type=color],[type=file],[type=image]),select';

    it('should pass the chart palette with the other tokens', () => {
      for (const name of ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'] as const) expect(style).toContain(`${name}:${THEME.tokens[name]};`);
    });

    it("should draw buttons, fields and textareas with the theme's border and radius, on no fill, in the text colour", () => {
      expect(style).toContain(
        `:where(${BUTTONS},${FIELDS},textarea){border:1px solid var(--border);border-radius:var(--radius);background:transparent;color:var(--foreground)}`,
      );
    });

    it("should give a button the app's size, a pointer and the muted fill on hover", () => {
      expect(style).toContain(`:where(${BUTTONS}){height:2.25rem;padding:0 1rem;font-size:0.875rem;font-weight:500;cursor:pointer}`);
      expect(style).toContain(`:where(${BUTTONS}):where(:hover:not(:disabled)){background:var(--muted)}`);
    });

    it("should give a field the app's size and a muted placeholder", () => {
      expect(style).toContain(`:where(${FIELDS}){height:2.25rem;padding:0.25rem 0.75rem}`);
      expect(style).toContain(':where(input,textarea)::placeholder{color:var(--muted-foreground);opacity:1}');
    });

    it('should take the accent colour of checkbox, radio, range and progress from the theme', () => {
      expect(style).toContain(':where(input,progress){accent-color:var(--primary)}');
    });

    it('should fade a disabled control and ring a focused one', () => {
      expect(style).toContain(':where(button,input,select,textarea):where(:disabled){opacity:0.5;cursor:not-allowed}');
      expect(style).toContain(':where(button,input,select,textarea):where(:focus-visible){outline:2px solid var(--ring);outline-offset:2px}');
    });

    it('should keep every control rule at no specificity, so a rule of the block wins', () => {
      const rules = style.slice(style.indexOf(':where(button'), style.indexOf('table{'));
      const selectors = rules
        .split('}')
        .filter(Boolean)
        .map((rule) => rule.slice(0, rule.indexOf('{')));
      expect(selectors.length).toBeGreaterThan(5);
      // Everything is inside `:where()`; the one exception is a pseudo-element, which cannot be.
      for (const selector of selectors) expect(selector.replace(/:where\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, '')).toMatch(/^(::placeholder)?$/);
    });
  });

  it('should allow scripts, styles and fonts from jsDelivr, cdnjs and unpkg, and from no other host (#409)', () => {
    expect(HTML_BLOCK_CDN_HOSTS).toEqual(['https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://unpkg.com']);
    const csp = buildSrcdoc('', THEME).match(/content="([^"]*)"/)![1];
    expect(csp).toBe(CSP);
    // No connect-src (so default-src 'none' keeps fetch blocked), and no host outside the three directives.
    expect(csp).not.toContain('connect-src');
    expect(csp.match(/https:[^ ;]*/g)).toHaveLength(9);
  });

  it('should listen for one kind of message only: a reply from the app to journal.storage (#410)', () => {
    const srcdoc = buildSrcdoc('', THEME);
    expect(srcdoc.match(/addEventListener\('message'|onmessage/g)).toEqual(["addEventListener('message'"]);
    expect(srcdoc).toContain('event.source !== parent');
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

  it('should let a wide block be up to 2400px tall (#557)', () => {
    expect(frameHeightFromMessage({ source: frame, data: report(2000) }, frame, true)).toBe(2000);
    expect(frameHeightFromMessage({ source: frame, data: report(5000) }, frame, true)).toBe(2400);
    expect(frameHeightFromMessage({ source: frame, data: report(0) }, frame, true)).toBe(120);
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

describe('isEscapeFromFrame', () => {
  const frame = {} as Window;
  const escape = { journalLiveBlock: 1, escape: 1 };

  it('should be true for Esc from the block’s own frame only (#557)', () => {
    expect(isEscapeFromFrame({ source: frame, data: escape }, frame)).toBe(true);
    expect(isEscapeFromFrame({ source: {} as Window, data: escape }, frame)).toBe(false);
    expect(isEscapeFromFrame({ source: null, data: escape }, null)).toBe(false);
    for (const data of [{ escape: 1 }, { journalLiveBlock: 1, escape: true }, { journalLiveBlock: 1, height: 900 }, null]) {
      expect(isEscapeFromFrame({ source: frame, data }, frame)).toBe(false);
    }
  });

  it('should be what the frame posts when Esc is pressed in it', () => {
    const theme: FrameTheme = {
      colorScheme: 'light',
      tokens: Object.fromEntries(FRAME_TOKENS.map((name) => [name, '#000'])) as FrameTheme['tokens'],
      fontFamily: 'system-ui',
      lineHeight: '1.5',
    };
    const script = buildSrcdoc('', theme).match(/<script>(addEventListener\('keydown'[^]*?)<\/script>/)![1];
    const posted: unknown[] = [];
    let onKeyDown: (event: { key: string }) => void = () => {};
    const parent = { postMessage: (message: unknown) => posted.push(message) };
    new Function('parent', 'addEventListener', script)(parent, (_: string, listener: typeof onKeyDown) => {
      onKeyDown = listener;
    });
    onKeyDown({ key: 'a' });
    onKeyDown({ key: 'Escape' });
    expect(posted).toEqual([escape]);
    expect(isEscapeFromFrame({ source: frame, data: posted[0] }, frame)).toBe(true);
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
