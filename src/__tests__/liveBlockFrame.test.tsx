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
  const render = (selected = false) =>
    renderToStaticMarkup(
      <LiveBlockFrame
        kind="svg"
        source="<svg xmlns='http://www.w3.org/2000/svg'/>"
        preview
        selected={selected}
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

  it('should outline the block when its node is selected, like an image', () => {
    expect(wrapperClasses(render()).filter((name) => name.startsWith('outline'))).toEqual([]);
    // `outline-2` draws the outline by itself: tailwind-merge drops the bare `outline` beside it.
    expect(wrapperClasses(render(true))).toEqual(expect.arrayContaining(['outline-2', 'outline-primary/60']));
  });
});

describe('LiveBlockPreview html, mounted', () => {
  const LIGHT = { '--background': '#FDFCF8', '--foreground': '#2C2B29', '--muted': '#F2F0E9', '--muted-foreground': '#8A8780', '--border': '#E6E4DD', '--accent': '#F7F5F0', '--secondary': '#F2F0E9', '--primary': '#2C2B29', '--radius': '0.5rem' };
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
    expect(srcdoc).toContain(`</style>${SOURCE}<script>`);
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
