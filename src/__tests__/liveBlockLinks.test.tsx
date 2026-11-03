// @vitest-environment happy-dom
/**
 * Live blocks run as soon as they are shown, whoever wrote them (#975). A link from a block the
 * reader may not have written shows where it goes before it opens; a link from the reader's own
 * block opens at once. Such a block's frame also has an edge.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LiveBlockFrame } from '@/components/liveBlocks/LiveBlockFrame';
import { ownerWroteNote, type LiveBlockKind } from '@/lib/liveBlocks';

const ME = 'me.homebase.test';

describe('ownerWroteNote', () => {
  it('should trust a note the identity owns and last edited, or that nobody is named as editing', () => {
    expect(ownerWroteNote({}, ME)).toBe(true);
    expect(ownerWroteNote({ authorOdinId: ME, lastEditedBy: ME }, ME)).toBe(true);
    expect(ownerWroteNote({ lastEditedBy: ME }, ME)).toBe(true);
  });

  it('should not trust a note shared with the identity, even one it edited last', () => {
    expect(ownerWroteNote({ authorOdinId: 'friend.homebase.test' }, ME)).toBe(false);
    expect(ownerWroteNote({ authorOdinId: 'friend.homebase.test', lastEditedBy: ME }, ME)).toBe(false);
  });

  it('should not trust an own note that an agent or a collaborator edited last', () => {
    expect(ownerWroteNote({ lastEditedBy: 'agent:claude-code' }, ME)).toBe(false);
    expect(ownerWroteNote({ authorOdinId: ME, lastEditedBy: 'friend.homebase.test' }, ME)).toBe(false);
  });

  it('should not trust a note with an editor when the identity is unknown', () => {
    expect(ownerWroteNote({ lastEditedBy: ME }, undefined)).toBe(false);
  });
});

describe('LiveBlockFrame', () => {
  let root: Root;
  let note: HTMLDivElement;
  let open: MockInstance<typeof window.open>;

  beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    note = document.body.appendChild(document.createElement('div'));
    root = createRoot(note);
    open = vi.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    note.remove();
    open.mockRestore();
  });

  const render = (trusted: boolean, kind: LiveBlockKind = 'html') =>
    act(async () =>
      root.render(
        <LiveBlockFrame kind={kind} source="<h1>Hi</h1>" preview trusted={trusted} toggles={null}>
          {null}
        </LiveBlockFrame>,
      ),
    );

  /** Does what the frame's bridge script does for a link the user clicked: sends it over the port. */
  async function clickLinkInFrame(url: string) {
    const frame = note.querySelector('iframe')!;
    const token = frame.getAttribute('srcdoc')!.match(/bridge: '([^']+)'/)![1];
    const port = Object.assign(new EventTarget(), { postMessage: vi.fn(), start: vi.fn() }) as unknown as MessagePort;
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { journalLiveBlock: 1, bridge: token }, source: frame.contentWindow, ports: [port] }));
    });
    await act(async () => {
      port.dispatchEvent(new MessageEvent('message', { data: { journalLiveBlock: 1, link: url } }));
    });
  }

  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
  const button = (name: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent === name);

  it('should run an html or react block the reader did not write without a click, and with no Run button', async () => {
    for (const kind of ['html', 'react'] as const) {
      await render(false, kind);
      expect(note.querySelector('button[aria-label^="Run "]')).toBeNull();
      if (kind === 'html') expect(note.querySelector('iframe')?.getAttribute('srcdoc')).toContain('<h1>Hi</h1>');
      expect(note.textContent).not.toContain('may not be yours');
    }
  });

  it("should give the frame of a block the reader did not write an edge, and the reader's own block none", async () => {
    await render(false);
    expect(note.querySelector('[data-live-block-untrusted]')).not.toBeNull();
    await render(true);
    expect(note.querySelector('[data-live-block-untrusted]')).toBeNull();
  });

  it("should open a link from the reader's own block at once", async () => {
    await render(true);
    await clickLinkInFrame('https://example.com/page?q=1');

    expect(open).toHaveBeenCalledWith('https://example.com/page?q=1', '_blank', 'noopener,noreferrer');
    expect(dialog()).toBeNull();
  });

  it('should show the host and the whole URL of a link from a block the reader did not write, and open it only on Open link', async () => {
    await render(false);
    await clickLinkInFrame('https://evil.example/collect?password=hunter2');

    expect(open).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Open this link?');
    expect(dialog()?.textContent).toContain('evil.example');
    expect(dialog()?.textContent).toContain('https://evil.example/collect?password=hunter2');

    await act(async () => button('Open link')!.click());
    expect(open).toHaveBeenCalledExactlyOnceWith('https://evil.example/collect?password=hunter2', '_blank', 'noopener,noreferrer');
  });

  it('should not open the link when the reader cancels', async () => {
    await render(false);
    await clickLinkInFrame('mailto:someone@example.com?body=secret');

    expect(dialog()?.textContent).toContain('someone@example.com');
    expect(dialog()?.textContent).toContain('body=secret');
    await act(async () => button('Cancel')!.click());
    expect(open).not.toHaveBeenCalled();
  });
});
