// @vitest-environment happy-dom
/**
 * The storage bridge of a mounted html block (#410): the app answers only the
 * port the block's own page handed it (#945), from that block's store, and keeps
 * the state while the frame reloads. On the share page a viewer starts from the owner's state and
 * changes only a copy in memory.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Markdown from 'react-markdown';
import { LiveBlockPreview } from '@/components/liveBlocks/LiveBlockPreview';
import { LiveBlockAwarePre } from '@/components/share/LiveBlockAwarePre';
import { LiveBlockStatesContext } from '@/components/share/liveBlockStatesContext';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';
import { memoryBlockStateStore, type BlockStateStore } from '@/lib/liveBlockState';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let note: HTMLDivElement;

const RUN = 'button[aria-label^="Run "]';

/** Renders `element`; `blocks` html blocks in it wait for Run until this device ran their code (#947). */
async function render(element: React.ReactElement, blocks = 0): Promise<HTMLIFrameElement[]> {
  note = document.body.appendChild(document.createElement('div'));
  root = createRoot(note);
  await act(async () => root.render(element));
  for (let i = 0; i < 50 && note.querySelectorAll(`${RUN}, iframe`).length < blocks; i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  for (const run of note.querySelectorAll<HTMLButtonElement>(RUN)) await act(async () => run.click());
  const frames = [...note.querySelectorAll('iframe')];
  for (const frame of frames) await connect(frame);
  return frames;
}

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  note.remove();
  document.documentElement.removeAttribute('class');
});

const ports = new WeakMap<HTMLIFrameElement, MessagePort>();

/** Posts `data` to the app on `window`, as `source` with `transfer`, as a frame's page does. */
const postOnWindow = (data: unknown, source: unknown, transfer: MessagePort[] = []) =>
  act(async () => {
    window.dispatchEvent(new MessageEvent('message', { data, source: source as Window, ports: transfer }));
  });

const newPort = () => Object.assign(new EventTarget(), { postMessage: vi.fn(), start: vi.fn() }) as unknown as MessagePort;
const tokenOf = (frame: HTMLIFrameElement) => frame.getAttribute('srcdoc')!.match(/bridge: '([^']+)'/)![1];

/** Does what the bridge script in `frame`'s page does as it starts: hands the app a port. */
async function connect(frame: HTMLIFrameElement) {
  const port = newPort();
  await postOnWindow({ journalLiveBlock: 1, bridge: tokenOf(frame) }, frame.contentWindow, [port]);
  ports.set(frame, port);
  return port;
}

/** Sends `data` to the app on `port`, and returns what it sent back there. */
function askOn(port: MessagePort, data: unknown) {
  const postMessage = vi.mocked(port.postMessage);
  postMessage.mockClear();
  port.dispatchEvent(new MessageEvent('message', { data }));
  return postMessage.mock.calls.map((call) => call[0]);
}

const ask = (frame: HTMLIFrameElement, data: unknown) => askOn(ports.get(frame)!, data);

let requestNumber = 0;
const get = (key: string) => ({ journalLiveBlock: 1, storage: 'get', request: ++requestNumber, key });
const set = (key: string, value: unknown) => ({ journalLiveBlock: 1, storage: 'set', request: ++requestNumber, key, value });
const valueOf = (replies: unknown[]) => (replies[0] as { value?: unknown }).value;

describe('a mounted mermaid block’s theme (#946)', () => {
  const mount = async () => {
    note = document.body.appendChild(document.createElement('div'));
    root = createRoot(note);
    await act(async () => root.render(<LiveBlockPreview kind="mermaid" source="graph TD; A-->B" />));
    for (let i = 0; i < 200 && !note.querySelector('iframe')?.hasAttribute('srcdoc'); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    return note.querySelector('iframe')!;
  };
  const lookOf = (port: MessagePort) => vi.mocked(port.postMessage).mock.lastCall![0].look as { style: string; themeVariables: string };

  it('should hand the page the look as it connects, and redraw it in a new theme without loading it again', async () => {
    const frame = await mount();
    const srcdoc = frame.getAttribute('srcdoc');
    const port = await connect(frame);
    expect(lookOf(port).style).toContain('color-scheme:light}');
    expect(JSON.parse(lookOf(port).themeVariables).darkMode).toBe(false);

    await act(async () => {
      document.documentElement.classList.add('dark');
      // The theme is observed through a MutationObserver, which reports asynchronously.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(frame.getAttribute('srcdoc')).toBe(srcdoc);
    expect(lookOf(port).style).toContain('color-scheme:dark}');
    expect(JSON.parse(lookOf(port).themeVariables).darkMode).toBe(true);
  });
});

describe('a mounted html block’s storage', () => {
  const twoBlocks = async (a: BlockStateStore, b: BlockStateStore) =>
    render(
      <>
        <LiveBlockPreview kind="html" source="<p>A</p>" store={a} />
        <LiveBlockPreview kind="html" source="<p>B</p>" store={b} />
      </>,
    );

  it("should answer each block from its own state, on that block's port only", async () => {
    const [frameA, frameB] = await twoBlocks(memoryBlockStateStore('{"secret":"A"}'), memoryBlockStateStore('{"secret":"B"}'));
    const replies = ask(frameA, get('secret'));
    expect(replies).toEqual([{ journalLiveBlock: 1, reply: requestNumber, value: 'A' }]);
    expect(ports.get(frameB)!.postMessage).not.toHaveBeenCalled();
    expect(valueOf(ask(frameB, get('secret')))).toBe('B');
  });

  it("should give each block's page a token of its own", async () => {
    const [frameA, frameB] = await twoBlocks(memoryBlockStateStore(undefined), memoryBlockStateStore(undefined));
    expect(tokenOf(frameA)).not.toBe(tokenOf(frameB));
  });

  it('should ignore a request that does not arrive on the handed port, even from the frame', async () => {
    const [frame] = await twoBlocks(memoryBlockStateStore('{"secret":"A"}'), memoryBlockStateStore('{"secret":"B"}'));
    const postToFrame = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
    await postOnWindow(get('secret'), frame.contentWindow);
    expect(postToFrame).not.toHaveBeenCalled();
    expect(ports.get(frame)!.postMessage).not.toHaveBeenCalled();
  });

  it('should give a page navigated to in the frame, which has the window but no token, no bridge', async () => {
    const [frame] = await render(<LiveBlockPreview kind="html" source="<p>A</p>" store={memoryBlockStateStore('{"secret":"A"}')} />);
    const intruder = newPort();
    await postOnWindow({ journalLiveBlock: 1, bridge: 'guess' }, frame.contentWindow, [intruder]);
    expect(intruder.start).not.toHaveBeenCalled();
    expect(askOn(intruder, get('secret'))).toEqual([]);
    // The block's own port is still the one that counts.
    expect(valueOf(ask(frame, get('secret')))).toBe('A');
  });

  it('should keep the state when the frame reloads with the theme, and save it when the block goes away', async () => {
    const store = memoryBlockStateStore(undefined);
    const write = vi.spyOn(store, 'write');
    const [frame] = await render(<LiveBlockPreview kind="html" source="<p>A</p>" store={store} />);
    expect(ask(frame, set('count', 3))).toEqual([{ journalLiveBlock: 1, reply: requestNumber }]);
    const before = frame.getAttribute('srcdoc');
    await act(async () => {
      document.documentElement.classList.add('dark');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(frame.getAttribute('srcdoc')).not.toBe(before);
    // The reloaded page has the same token, and hands over a port of its own.
    await connect(frame);
    expect(valueOf(ask(frame, get('count')))).toBe(3);

    ask(frame, set('count', 4));
    await act(async () => root.unmount());
    expect(write).toHaveBeenLastCalledWith('{"count":4}');
    root = createRoot(note);
  });
});

describe('a live block on the share page', () => {
  const MARKDOWN = '```html id=k3f9\n<p>counter</p>\n```\n\n```html\n<p>no id</p>\n```';

  beforeEach(() => localStorage.clear());

  const sharePage = (states: Record<string, string>) =>
    render(
      <LiveBlockStatesContext.Provider value={states}>
        {createElement(Markdown, { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins, components: { pre: LiveBlockAwarePre } }, MARKDOWN)}
      </LiveBlockStatesContext.Provider>,
      2,
    );

  it("should start from the owner's saved state, found by the id in the fence", async () => {
    const [withId, withoutId] = await sharePage({ k3f9: '{"count":3}' });
    expect(valueOf(ask(withId, get('count')))).toBe(3);
    expect(valueOf(ask(withoutId, get('count')))).toBeUndefined();
  });

  it("should keep a viewer's change in memory only: the owner's state is back on the next page load", async () => {
    const states = { k3f9: '{"count":3}' };
    const [frame] = await sharePage(states);
    // Only now: the Run gate's lookup of an earlier run settles on real timers.
    vi.useFakeTimers();
    ask(frame, set('count', 10));
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
    expect(valueOf(ask(frame, get('count')))).toBe(10);
    expect(states).toEqual({ k3f9: '{"count":3}' });

    await act(async () => root.unmount());
    note.remove();
    const [reloaded] = await sharePage(states);
    expect(valueOf(ask(reloaded, get('count')))).toBe(3);
  });

  it('should find the id behind raw HTML elsewhere in the note, which makes the pipeline rebuild the tree', async () => {
    await act(async () => root.unmount());
    note.remove();
    const [frame] = await render(
      <LiveBlockStatesContext.Provider value={{ k3f9: '{"count":3}' }}>
        {createElement(
          Markdown,
          { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins, components: { pre: LiveBlockAwarePre } },
          `Some <u>underlined</u> text.\n\n${MARKDOWN}`,
        )}
      </LiveBlockStatesContext.Provider>,
      2,
    );
    expect(valueOf(ask(frame, get('count')))).toBe(3);
  });
});
