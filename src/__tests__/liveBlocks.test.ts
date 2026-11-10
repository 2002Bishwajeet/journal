import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveBlockPreview } from '@/components/liveBlocks/LiveBlockPreview';
import {
  HTML_BLOCK_CDN_HOSTS,
  bridgePortFromMessage,
  buildSrcdoc as buildPage,
  frameHeightFromMessage,
  linkFromMessage,
  liveBlockKind,
  mermaidBlockDocument,
  svgDataUri,
  type FrameTheme,
} from '@/lib/liveBlocks';

describe('mermaidBlockDocument (#946)', () => {
  const page = (source: string) => mermaidBlockDocument('window.mermaid = {};', source);

  it('should keep mermaid in strict mode, in the theme the app sends', () => {
    const built = page('graph TD; A-->B');
    expect(built).toContain(
      `mermaid.initialize(Object.assign(${JSON.stringify({ startOnLoad: false, securityLevel: 'strict', look: 'classic', theme: 'base' })}, { themeVariables: themeVariables }))`,
    );
    expect(built).toContain("addEventListener('journal-look', draw)");
  });

  it('should hand the source over as a string, which cannot end the script it is in', () => {
    const source = 'graph TD; A["</script><script>alert(1)</script><!--"]-->B';
    const built = page(source);
    expect(built).not.toContain('</script><script>alert(1)');
    expect(built).not.toContain('<!--');
    expect(built).toContain(JSON.stringify(source).replace(/<(\/script|!--)/gi, '\\x3C$1'));
  });

  it('should show a failed diagram on the page: nothing but the height and links crosses to the app', () => {
    const built = page('nonsense');
    expect(built).toContain('role="alert"');
    expect(built).not.toContain('postMessage');
  });
});

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
  const buildSrcdoc = (source: string, theme: FrameTheme) => buildPage(source, theme, 'the-token');
  const BRIDGE_REPORTS =
    // The height report, once the source is parsed and on every resize of the frame (#1045), and
    // then the link bridge: a clicked web or mail link the user clicked is passed to the app to
    // open (#947). Both over the port.
    'function report() { port.postMessage({ journalLiveBlock: 1, height: Math.ceil(document.documentElement.getBoundingClientRect().height) - 24 }); }' +
    "addEventListener('DOMContentLoaded', function () { new ResizeObserver(report).observe(document.documentElement); });" +
    "addEventListener('resize', report);" +
    "addEventListener('click', function (event) {var link = event.target.closest && event.target.closest('a');var href = link && (link.href.baseVal || link.href);if (!href || !/^(https?|mailto):/i.test(href)) return;event.preventDefault();if (event.isTrusted) port.postMessage({ journalLiveBlock: 1, link: href });});";

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
      '--destructive': '#f87171',
      '--destructive-foreground': '#1C1B1A',
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
    return srcdoc.slice(0, srcdoc.length - source.length);
  };

  it('should put the CSP meta first, then one theme style, the bridge to the app and the source', () => {
    const source = '<style>body{color:red}</style><p>hi</p><script>document.body.append("ran")</script>';
    const srcdoc = buildSrcdoc(source, THEME);
    expect(srcdoc.startsWith(`<!doctype html>${CSP_META}<style>`)).toBe(true);
    expect(srcdoc.endsWith(`${BRIDGE_REPORTS}})();</script>${source}`)).toBe(true);
    // The block's own CSS comes after the one injected style, so it wins.
    expect(head(source).match(/<style>/g)).toHaveLength(1);
    // Between the style and the source, one script: the bridge, with journal.storage (#410).
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

  it('should keep the page from scrolling by itself, until the app says the frame is clamped (#1045)', () => {
    const srcdoc = buildSrcdoc('<p>hi</p>', THEME);
    expect(head('<p>hi</p>')).toContain('html{overflow:hidden}html[data-journal-scroll]{overflow:auto;overscroll-behavior:contain}');
    expect(srcdoc).toContain("document.documentElement.toggleAttribute('data-journal-scroll', data.clamped === true)");
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

  it('should listen on its port alone, for a reply from the app to journal.storage (#410, #945)', () => {
    const srcdoc = buildSrcdoc('', THEME);
    expect(srcdoc.match(/addEventListener\('message'|onmessage/g)).toEqual(['onmessage']);
    expect(srcdoc).toContain('port.onmessage = ');
  });

  it('should hand the app its port with the token, and post nothing else on the window (#945)', () => {
    const srcdoc = buildSrcdoc('', THEME);
    expect(srcdoc.match(/parent\.postMessage\([^;]*;/g)).toEqual(["parent.postMessage({ journalLiveBlock: 1, bridge: 'the-token' }, '*', [channel.port2]);"]);
  });

  it('should take the script holding the token out of the document before the source runs (#945)', () => {
    const srcdoc = buildSrcdoc('<p>block</p>', THEME);
    expect(srcdoc.indexOf('document.currentScript.remove();')).toBeLessThan(srcdoc.indexOf('the-token'));
  });
});

describe('bridgePortFromMessage', () => {
  // Stand-ins: only their identity matters.
  const frame = {} as Window;
  const port = {} as MessagePort;
  const hello = (bridge: unknown) => ({ journalLiveBlock: 1, bridge });

  it("should take the port of the frame's own page, which knows the token", () => {
    expect(bridgePortFromMessage({ source: frame, data: hello('token'), ports: [port] }, frame, 'token')).toBe(port);
  });

  it('should ignore a page in the same frame that does not know the token', () => {
    for (const bridge of ['guess', '', undefined, null]) {
      expect(bridgePortFromMessage({ source: frame, data: hello(bridge), ports: [port] }, frame, 'token')).toBeNull();
    }
  });

  it('should ignore the right token from another window, or while the frame has no window', () => {
    expect(bridgePortFromMessage({ source: {} as Window, data: hello('token'), ports: [port] }, frame, 'token')).toBeNull();
    expect(bridgePortFromMessage({ source: null, data: hello('token'), ports: [port] }, frame, 'token')).toBeNull();
    expect(bridgePortFromMessage({ source: frame, data: hello('token'), ports: [port] }, null, 'token')).toBeNull();
  });

  it('should ignore a message without a port, or that is not a hello', () => {
    expect(bridgePortFromMessage({ source: frame, data: hello('token'), ports: [] }, frame, 'token')).toBeNull();
    expect(bridgePortFromMessage({ source: frame, data: { bridge: 'token' }, ports: [port] }, frame, 'token')).toBeNull();
    expect(bridgePortFromMessage({ source: frame, data: null, ports: [port] }, frame, 'token')).toBeNull();
  });
});

describe('frameHeightFromMessage', () => {
  const report = (height: unknown) => ({ journalLiveBlock: 1, height });

  it('should return the height its own frame reported, not clamped', () => {
    expect(frameHeightFromMessage(report(900))).toEqual({ height: 900, clamped: false });
  });

  it('should clamp the height to 120–1600px, and say so only when the content is over the cap (#1045)', () => {
    expect(frameHeightFromMessage(report(0))).toEqual({ height: 120, clamped: false });
    expect(frameHeightFromMessage(report(1600))).toEqual({ height: 1600, clamped: false });
    expect(frameHeightFromMessage(report(1601))).toEqual({ height: 1600, clamped: true });
    expect(frameHeightFromMessage(report(5000))).toEqual({ height: 1600, clamped: true });
  });

  it('should round a fractional height up, so the frame is never a pixel short (#1045)', () => {
    expect(frameHeightFromMessage(report(300.2))).toEqual({ height: 301, clamped: false });
    expect(frameHeightFromMessage(report(1599.5))).toEqual({ height: 1600, clamped: false });
    expect(frameHeightFromMessage(report(1600.1))).toEqual({ height: 1600, clamped: true });
  });

  it('should let a wide block be up to 2400px tall (#557)', () => {
    expect(frameHeightFromMessage(report(2000), true)).toEqual({ height: 2000, clamped: false });
    expect(frameHeightFromMessage(report(5000), true)).toEqual({ height: 2400, clamped: true });
    expect(frameHeightFromMessage(report(0), true)).toEqual({ height: 120, clamped: false });
  });

  it('should ignore a height that is not a finite number', () => {
    for (const height of ['900', NaN, Infinity, null, undefined, { valueOf: () => 900 }]) {
      expect(frameHeightFromMessage(report(height))).toBeNull();
    }
  });

  it('should ignore a message without the marker', () => {
    for (const data of [{ height: 900 }, { journalLiveBlock: '1', height: 900 }, { journalLiveBlock: true, height: 900 }, 'height: 900', 900, null, undefined]) {
      expect(frameHeightFromMessage(data)).toBeNull();
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

describe('linkFromMessage', () => {
  const link = (href: unknown) => ({ journalLiveBlock: 1, link: href });

  it('should return a web or mail link the block asked to open', () => {
    expect(linkFromMessage(link('https://example.com/a'))).toBe('https://example.com/a');
    expect(linkFromMessage(link('http://example.com/'))).toBe('http://example.com/');
    expect(linkFromMessage(link('mailto:a@b.c'))).toBe('mailto:a@b.c');
  });

  it('should refuse any other scheme, so a block can never run script in the app', () => {
    expect(linkFromMessage(link('javascript:alert(1)'))).toBeNull();
    expect(linkFromMessage(link('data:text/html,hi'))).toBeNull();
    expect(linkFromMessage(link('not a url'))).toBeNull();
    expect(linkFromMessage(link(42))).toBeNull();
  });
});

