// @vitest-environment happy-dom
/**
 * LiveBlock (#1075): a block in a host that is not Journal, from the package alone. No app
 * state: its saved state starts from `initialState` and stays in memory, and with no theme
 * variables on the host it is drawn in Journal's look.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LiveBlock, type LiveBlockKind } from '../src/index';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLDivElement;

async function render(element: React.ReactElement): Promise<void> {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(element));
  // The react compiler and the mermaid runtime are dynamic imports.
  for (let i = 0; i < 200 && host.querySelector('[role="status"]'); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const SOURCES: Record<LiveBlockKind, string> = {
  html: '<p>Hello</p>',
  react: 'function App() { return <p>Hello</p>; }',
  mermaid: 'graph TD; A-->B',
  svg: "<svg xmlns='http://www.w3.org/2000/svg'/>",
};

const srcdoc = () => host.querySelector('iframe')!.getAttribute('srcdoc')!;

/** Hands the preview a port as the frame's bridge script does, and returns it. */
async function connect() {
  const frame = host.querySelector('iframe')!;
  const port = Object.assign(new EventTarget(), { postMessage: vi.fn(), start: vi.fn() }) as unknown as MessagePort;
  const token = srcdoc().match(/bridge: '([^']+)'/)![1];
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', { data: { journalLiveBlock: 1, bridge: token }, source: frame.contentWindow, ports: [port] }));
  });
  return port;
}

/** Sends `data` to the host on `port`, and returns what it sent back. */
async function ask(port: MessagePort, data: unknown) {
  const postMessage = vi.mocked(port.postMessage);
  postMessage.mockClear();
  await act(async () => {
    port.dispatchEvent(new MessageEvent('message', { data }));
  });
  return postMessage.mock.calls.map((call) => call[0]);
}

describe('LiveBlock', () => {
  it.each(['html', 'react', 'mermaid'] as const)('should run a %s block in a frame with only allow-scripts', async (kind) => {
    await render(<LiveBlock kind={kind} source={SOURCES[kind]} />);
    const frame = host.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(srcdoc().startsWith('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\';')).toBe(true);
    expect(host.querySelector('[data-live-block]')!.getAttribute('data-live-block')).toBe(kind);
  });

  it('should show an svg block as an image, never in the DOM', async () => {
    await render(<LiveBlock kind="svg" source={SOURCES.svg} />);
    expect(host.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(host.querySelector('iframe, svg')).toBeNull();
  });

  it.each(['html', 'react'] as const)('should give a %s block the edge of a block the reader may not have written (#975)', async (kind) => {
    await render(<LiveBlock kind={kind} source={SOURCES[kind]} />);
    expect(host.querySelector('[data-live-block-untrusted]')).not.toBeNull();
    expect(host.querySelector('span[aria-hidden].border-dashed')).not.toBeNull();
  });

  it('should fit the box to the height the block reports', async () => {
    await render(<LiveBlock kind="html" source={SOURCES.html} />);
    const port = await connect();
    await ask(port, { journalLiveBlock: 1, height: 300 });
    expect((host.querySelector('[data-live-block-preview]') as HTMLElement).style.height).toBe('300px');
  });

  it('should start from the saved state it is given, and keep a reader\'s changes in memory', async () => {
    await render(<LiveBlock kind="html" source={SOURCES.html} initialState='{"count":3}' />);
    const port = await connect();
    expect(await ask(port, { journalLiveBlock: 1, storage: 'get', request: 1, key: 'count' })).toEqual([{ journalLiveBlock: 1, reply: 1, value: 3 }]);
    await ask(port, { journalLiveBlock: 1, storage: 'set', request: 2, key: 'count', value: 4 });
    expect(await ask(port, { journalLiveBlock: 1, storage: 'get', request: 3, key: 'count' })).toEqual([{ journalLiveBlock: 1, reply: 3, value: 4 }]);
  });

  it('should ask before it opens a link, showing the whole URL', async () => {
    // happy-dom has no window.confirm.
    const confirm = vi.fn<(message: string) => boolean>(() => false);
    const open = vi.fn<typeof window.open>(() => null);
    Object.assign(window, { confirm, open });
    await render(<LiveBlock kind="html" source={SOURCES.html} />);
    const port = await connect();
    await ask(port, { journalLiveBlock: 1, link: 'https://example.com/?typed=secret' });
    expect(confirm.mock.calls[0][0]).toContain('https://example.com/?typed=secret');
    expect(open).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await ask(port, { journalLiveBlock: 1, link: 'https://example.com/' });
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
  });

  it('should hand a link to the host\'s own onLink instead', async () => {
    const onLink = vi.fn();
    await render(<LiveBlock kind="html" source={SOURCES.html} onLink={onLink} />);
    const port = await connect();
    await ask(port, { journalLiveBlock: 1, link: 'mailto:a@example.com' });
    expect(onLink).toHaveBeenCalledWith('mailto:a@example.com');
  });
});

describe('LiveBlock theme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('class');
    document.documentElement.removeAttribute('style');
  });

  it('should draw the block in Journal\'s light look on a host with no theme variables', async () => {
    await render(<LiveBlock kind="html" source={SOURCES.html} />);
    expect(srcdoc()).toContain('--background:#FDFCF8;');
    expect(srcdoc()).toContain('color-scheme:light');
  });

  it('should follow the `dark` class on <html>', async () => {
    document.documentElement.classList.add('dark');
    await render(<LiveBlock kind="html" source={SOURCES.html} />);
    expect(srcdoc()).toContain('--background:#1C1B1A;');
    expect(srcdoc()).toContain('color-scheme:dark');
  });

  it('should take the theme it is given over the class on <html>', async () => {
    await render(<LiveBlock kind="html" source={SOURCES.html} theme="dark" />);
    expect(srcdoc()).toContain('--background:#1C1B1A;');
    expect(srcdoc()).toContain('color-scheme:dark');
  });

  it('should take a variable the host sets over the default', async () => {
    document.documentElement.style.setProperty('--background', '#123456');
    await render(<LiveBlock kind="html" source={SOURCES.html} />);
    expect(srcdoc()).toContain('--background:#123456;');
    expect(srcdoc()).toContain('--foreground:#2C2B29;');
  });
});
