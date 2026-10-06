// @vitest-environment happy-dom
/**
 * The storage bridge of a mounted html block (#410): the app answers only the
 * block's own frame, from that block's store, and keeps the state while the
 * frame reloads. On the share page a viewer starts from the owner's state and
 * changes only a copy in memory.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
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

async function render(element: React.ReactElement): Promise<HTMLIFrameElement[]> {
  note = document.body.appendChild(document.createElement('div'));
  root = createRoot(note);
  await act(async () => root.render(element));
  return [...note.querySelectorAll('iframe')];
}

afterEach(async () => {
  await act(async () => root.unmount());
  note.remove();
  document.documentElement.removeAttribute('class');
});

/** Posts `data` to the app as `source`, and returns what the app posted back into `frame`. */
function ask(frame: HTMLIFrameElement, data: unknown, source: unknown = frame.contentWindow) {
  const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
  const replies = postMessage.mock.calls.map((call) => call[0]);
  postMessage.mockRestore();
  return replies;
}

let requestNumber = 0;
const get = (key: string) => ({ journalLiveBlock: 1, storage: 'get', request: ++requestNumber, key });
const set = (key: string, value: unknown) => ({ journalLiveBlock: 1, storage: 'set', request: ++requestNumber, key, value });
const valueOf = (replies: unknown[]) => (replies[0] as { value?: unknown }).value;

describe('a mounted html block’s storage', () => {
  const twoBlocks = async (a: BlockStateStore, b: BlockStateStore) =>
    render(
      <>
        <LiveBlockPreview kind="html" source="<p>A</p>" store={a} />
        <LiveBlockPreview kind="html" source="<p>B</p>" store={b} />
      </>,
    );

  it("should answer each frame from its own block's state, into that frame only", async () => {
    const [frameA, frameB] = await twoBlocks(memoryBlockStateStore('{"secret":"A"}'), memoryBlockStateStore('{"secret":"B"}'));
    const postToB = vi.spyOn(frameB.contentWindow!, 'postMessage').mockImplementation(() => {});
    const replies = ask(frameA, get('secret'));
    expect(replies).toEqual([{ journalLiveBlock: 1, reply: requestNumber, value: 'A' }]);
    expect(postToB).not.toHaveBeenCalled();
    expect(valueOf(ask(frameB, get('secret')))).toBe('B');
  });

  it('should not reply to a message from a window that is not one of its frames', async () => {
    const [frameA, frameB] = await twoBlocks(memoryBlockStateStore('{"secret":"A"}'), memoryBlockStateStore('{"secret":"B"}'));
    const postToB = vi.spyOn(frameB.contentWindow!, 'postMessage').mockImplementation(() => {});
    expect(ask(frameA, get('secret'), window)).toEqual([]);
    expect(ask(frameA, get('secret'), null)).toEqual([]);
    expect(postToB).not.toHaveBeenCalled();
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
    expect(valueOf(ask(frame, get('count')))).toBe(3);

    ask(frame, set('count', 4));
    await act(async () => root.unmount());
    expect(write).toHaveBeenLastCalledWith('{"count":4}');
    root = createRoot(note);
  });
});

describe('a live block on the share page', () => {
  const MARKDOWN = '```html id=k3f9\n<p>counter</p>\n```\n\n```html\n<p>no id</p>\n```';

  const sharePage = (states: Record<string, string>) =>
    render(
      <LiveBlockStatesContext.Provider value={states}>
        {createElement(Markdown, { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins, components: { pre: LiveBlockAwarePre } }, MARKDOWN)}
      </LiveBlockStatesContext.Provider>,
    );

  it("should start from the owner's saved state, found by the id in the fence", async () => {
    const [withId, withoutId] = await sharePage({ k3f9: '{"count":3}' });
    expect(valueOf(ask(withId, get('count')))).toBe(3);
    expect(valueOf(ask(withoutId, get('count')))).toBeUndefined();
  });

  it("should keep a viewer's change in memory only: the owner's state is back on the next page load", async () => {
    vi.useFakeTimers();
    const states = { k3f9: '{"count":3}' };
    const [frame] = await sharePage(states);
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
    );
    expect(valueOf(ask(frame, get('count')))).toBe(3);
  });
});
