// @vitest-environment happy-dom
/**
 * Live blocks blend into the note (#420): the frame around a block has no card
 * and no header bar, and an `html` block's document carries the theme of the
 * page around it.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveBlockFrame, LiveBlockToggle } from '@/components/liveBlocks/LiveBlockFrame';
import { LiveBlockPreview } from '@/components/liveBlocks/LiveBlockPreview';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('LiveBlockFrame', () => {
  const render = (selected = false, labelled = false) =>
    renderToStaticMarkup(
      <LiveBlockFrame
        kind="svg"
        source="<svg xmlns='http://www.w3.org/2000/svg'/>"
        preview
        selected={selected}
        labelled={labelled}
        toggles={
          <LiveBlockToggle pressed={false} onClick={() => {}}>
            View source
          </LiveBlockToggle>
        }
      >
        {null}
      </LiveBlockFrame>,
    );
  const wrapperClasses = (markup: string) => markup.match(/<div data-live-block="svg" class="([^"]*)"/)?.[1].split(' ') ?? [];

  it('should draw no card: no background, border or rounded box on the block', () => {
    const classes = wrapperClasses(render());
    expect(classes).toContain('relative');
    expect(classes.filter((name) => /^(bg-|border|rounded|overflow-hidden)/.test(name))).toEqual([]);
  });

  it('should have no header bar: the kind is the name of the control group, not a visible label', () => {
    const markup = render();
    expect(markup).not.toMatch(/<span[^>]*>SVG<\/span>/);
    expect(markup).toMatch(/<div role="group" aria-label="SVG block"[^>]*>\s*<button type="button" aria-pressed="false"/);
  });

  it('should keep the controls out of sight until the block is hovered or has focus, except where there is no hover', () => {
    const classes = render().match(/<div role="group"[^>]* class="([^"]*)"/)?.[1].split(' ') ?? [];
    expect(classes).toEqual(
      expect.arrayContaining(['absolute', 'opacity-0', 'group-hover/block:opacity-100', 'group-focus-within/block:opacity-100', '[@media(hover:none)]:opacity-100']),
    );
    expect(wrapperClasses(render())).toContain('group/block');
  });

  it('should name the kind and keep the toggles in view while editing (labelled)', () => {
    const markup = render(false, true);
    expect(markup).toMatch(/<div role="group" aria-label="SVG block"[^>]*>\s*<span[^>]*>SVG<\/span>\s*<button type="button"/);
    const classes = markup.match(/<div role="group"[^>]* class="([^"]*)"/)?.[1].split(' ') ?? [];
    expect(classes.filter((name) => name === 'absolute' || name.includes('opacity'))).toEqual([]);
  });

  it('should give an html block no control besides the toggles it was handed and Expand (#424, #557)', () => {
    const markup = renderToStaticMarkup(
      <LiveBlockFrame
        kind="html"
        source="<p>hi</p>"
        preview
        toggles={
          <LiveBlockToggle pressed={false} onClick={() => {}}>
            View source
          </LiveBlockToggle>
        }
      >
        {null}
      </LiveBlockFrame>,
    );
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).toMatch(/<button[^>]*><span[^>]*>View source<\/span><\/button><button type="button"[^>]*><span[^>]*>Expand<\/span><\/button>/);
    // Expand is a button, not a toggle; the box it opens is a popover.
    expect(markup).not.toMatch(/aria-pressed="[^"]*"[^>]*><span[^>]*>Expand/);
    expect(markup).toMatch(/<div popover="auto"[^>]*data-live-block-preview="html"/);
  });

  it('should give Expand to html and react blocks only, even with no toggles (the share page, #557)', () => {
    const expandable = (kind: 'mermaid' | 'svg' | 'html' | 'react') =>
      /Expand/.test(
        renderToStaticMarkup(
          <LiveBlockFrame kind={kind} source="x" preview toggles={null}>
            {null}
          </LiveBlockFrame>,
        ),
      );
    expect([expandable('html'), expandable('react'), expandable('mermaid'), expandable('svg')]).toEqual([true, true, false, false]);
  });

  it('should mark a wide html or react block, and ignore wide on a mermaid or svg block (#557)', () => {
    const marked = (kind: 'svg' | 'html' | 'react', wide: boolean) =>
      renderToStaticMarkup(
        <LiveBlockFrame kind={kind} source="x" preview={false} wide={wide} toggles={null}>
          {null}
        </LiveBlockFrame>,
      ).includes('data-live-block-wide');
    expect([marked('html', true), marked('react', true), marked('svg', true), marked('html', false)]).toEqual([true, true, false, false]);
  });

  it('should outline the block when its node is selected, like an image', () => {
    expect(wrapperClasses(render()).filter((name) => name.startsWith('outline'))).toEqual([]);
    // `outline-2` draws the outline by itself: tailwind-merge drops the bare `outline` beside it.
    expect(wrapperClasses(render(true))).toEqual(expect.arrayContaining(['outline-2', 'outline-primary/60']));
  });
});

describe('LiveBlockPreview react, mounted (#426)', () => {
  const COUNTER = 'function App() { const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>Count: {count}</button>; }';

  let root: Root;
  let note: HTMLDivElement;

  /** Mounts the preview and waits for the compiler and the runtime, which are dynamic imports. */
  async function mount(source: string): Promise<void> {
    note = document.body.appendChild(document.createElement('div'));
    root = createRoot(note);
    await act(async () => root.render(<LiveBlockPreview kind="react" source={source} />));
    for (let i = 0; i < 200 && note.querySelector('[role="status"]'); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }

  afterEach(async () => {
    await act(async () => root.unmount());
    note.remove();
  });

  it('should run the compiled component on the runtime, in the frame an html block gets', async () => {
    await mount(COUNTER);
    const frame = note.querySelector('iframe')!;
    expect(frame.getAttribute('title')).toBe('React preview');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    const srcdoc = frame.getAttribute('srcdoc')!;
    expect(srcdoc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\';')).toBe(true);
    expect(srcdoc).not.toContain('unsafe-eval');
    // The stub stands in for the runtime vite.config.ts builds (src/__tests__/stubs/reactBlockRuntime.ts).
    expect(srcdoc).toContain('<script>/* react-block-runtime stub */</script>');
    expect(srcdoc).toContain("React.createElement('button'");
  });

  // The stubs stand in for what vite.config.ts builds (src/__tests__/stubs/).
  it('should give a block that imports only react the Tailwind sheet, and no Recharts or lucide-react code (#427)', async () => {
    await mount("import { useState } from 'react';\n" + COUNTER);
    const srcdoc = note.querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(srcdoc).toContain('<style>/* react-block-tailwind stub */</style>');
    expect(srcdoc).not.toContain('react-block-recharts stub');
    expect(srcdoc).not.toContain('react-block-lucide stub');
  });

  it('should give a block each library it imports, behind the same CSP, in a frame that only allows scripts (#427)', async () => {
    await mount("import { LineChart } from 'recharts';\nimport { Heart } from 'lucide-react';\nfunction App() { return <Heart />; }");
    const frame = note.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    const srcdoc = frame.getAttribute('srcdoc')!;
    // Written out: the CSP of an html block (liveBlocks.test.ts), unchanged.
    const CDN = 'https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com';
    const CSP = `default-src 'none'; script-src 'unsafe-inline' ${CDN}; style-src 'unsafe-inline' ${CDN}; img-src data: blob:; font-src data: ${CDN}; media-src data: blob:; form-action 'none'; base-uri 'none'`;
    expect(srcdoc.startsWith(`<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}">`)).toBe(true);
    expect(srcdoc).not.toContain('unsafe-eval');
    expect(srcdoc).toContain('<script>/* react-block-recharts stub */</script>');
    expect(srcdoc).toContain('<script>/* react-block-lucide stub */</script>');
    expect(srcdoc).toContain('<style>/* react-block-tailwind stub */</style>');
  });

  it('should give a block only the libraries it imports, and lodash once under either name (#558)', async () => {
    await mount("import * as d3 from 'd3';\nimport _ from 'lodash';\nimport { sum } from 'lodash-es';\nimport { Button } from 'journal-ui';\nfunction App() { return <Button />; }");
    const srcdoc = note.querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(srcdoc).toContain('<script>/* react-block-d3 stub */</script>');
    expect(srcdoc).toContain('<script>/* react-block-ui stub */</script>');
    expect(srcdoc.match(/react-block-lodash stub/g)).toHaveLength(1);
    for (const other of ['three', 'mathjs', 'papaparse', 'recharts', 'lucide']) expect(srcdoc).not.toContain(`react-block-${other} stub`);
  });

  it('should show a syntax error with its line, as text in place of the frame', async () => {
    await mount('function App() { return <div>; }');
    expect(note.querySelector('iframe')).toBeNull();
    const alert = note.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Couldn’t compile this component.');
    expect(alert.textContent).toContain('Line 1: Unterminated JSX contents');
  });
});

describe('LiveBlockPreview html, mounted', () => {
  const LIGHT = { '--background': '#FDFCF8', '--foreground': '#2C2B29', '--muted': '#F2F0E9', '--muted-foreground': '#8A8780', '--border': '#E6E4DD', '--accent': '#F7F5F0', '--secondary': '#F2F0E9', '--primary': '#2C2B29', '--radius': '0.5rem', '--chart-1': '#2C2B29', '--chart-5': '#E6E4DD' };
  const DARK = { ...LIGHT, '--background': '#1C1B1A', '--foreground': '#E6E4DD', '--muted': '#2C2B29', '--border': '#3E3D3A' };
  const SOURCE = '<p>hi</p>';

  let root: Root;
  let note: HTMLDivElement;

  const setTokens = (tokens: Record<string, string>) => {
    for (const [name, value] of Object.entries(tokens)) document.documentElement.style.setProperty(name, value);
  };

  /** Mounts the preview inside a stand-in for the note's content, which sets the font. */
  async function mount(): Promise<HTMLIFrameElement> {
    note = document.body.appendChild(document.createElement('div'));
    note.style.cssText = 'font-family: Georgia, serif; font-size: 20px; line-height: 30px';
    root = createRoot(note);
    await act(async () => root.render(<LiveBlockPreview kind="html" source={SOURCE} />));
    return note.querySelector('iframe')!;
  }

  afterEach(async () => {
    await act(async () => root.unmount());
    note.remove();
    document.documentElement.removeAttribute('class');
    document.documentElement.removeAttribute('style');
  });

  it('should build the document from the source, behind the CSP, once the frame is mounted', async () => {
    setTokens(LIGHT);
    const srcdoc = (await mount()).getAttribute('srcdoc')!;
    expect(srcdoc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\';')).toBe(true);
    expect(srcdoc).toContain(`</script>${SOURCE}<script>`);
  });

  it("should give the document the app's current tokens and the font of the content around the frame", async () => {
    setTokens(LIGHT);
    const srcdoc = (await mount()).getAttribute('srcdoc')!;
    for (const [name, value] of Object.entries(LIGHT)) expect(srcdoc).toContain(`${name}:${value};`);
    expect(srcdoc).toContain('color-scheme:light}');
    // 30px on a 20px font: the frame gets the ratio, for its own font sizes.
    expect(srcdoc).toContain('font-family:Georgia, serif;line-height:1.5}');
  });

  it('should rebuild the document when the theme changes', async () => {
    setTokens(LIGHT);
    const frame = await mount();
    await act(async () => {
      setTokens(DARK);
      document.documentElement.classList.add('dark');
      // The theme is observed through a MutationObserver, which reports asynchronously.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const srcdoc = frame.getAttribute('srcdoc')!;
    for (const [name, value] of Object.entries(DARK)) expect(srcdoc).toContain(`${name}:${value};`);
    expect(srcdoc).toContain('color-scheme:dark}');
  });
});
