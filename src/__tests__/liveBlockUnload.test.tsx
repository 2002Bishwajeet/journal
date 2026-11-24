// @vitest-environment happy-dom
/**
 * Live-block frames are pages with their own scripts (#1487): a block keeps one frame however
 * often its code changes, unloads it while out of view or in a hidden tab, and loads it again
 * when it is back, or when the note is printed.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LiveBlockPreview } from '@2002bishwajeet/live-blocks';
import { LiveBlockFrame } from '@/components/liveBlocks/LiveBlockFrame';
import { revealIntersections } from '@/hooks/useIntersection';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLDivElement;

async function render(element: React.ReactElement) {
  await act(async () => root.render(element));
}

const frames = () => host.querySelectorAll('iframe').length;

/** Intersection reports for each observed element, sent by the test. */
const observers = new Map<Element, IntersectionObserverCallback>();
class FakeIntersectionObserver {
  private callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    observers.set(target, this.callback);
  }
  unobserve(target: Element) {
    observers.delete(target);
  }
  disconnect() {
    for (const [target, callback] of observers) if (callback === this.callback) observers.delete(target);
  }
  takeRecords() {
    return [];
  }
}

const report = (isIntersecting: boolean) =>
  act(async () => {
    for (const [target, callback] of observers) {
      callback([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });

beforeAll(() => {
  host = document.body.appendChild(document.createElement('div'));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.replaceChildren();
  vi.unstubAllGlobals();
  observers.clear();
});

describe('live-block frames', () => {
  it('keeps one frame per block however often its code changes', async () => {
    root = createRoot(host);
    for (let i = 0; i < 30; i++) {
      await render(<LiveBlockPreview kind="html" source={`<p>edit ${i}</p>`} />);
      expect(frames()).toBe(1);
    }
    expect(host.querySelector('iframe')!.getAttribute('srcdoc')).toContain('edit 29');
  });

  it('has no frame while offscreen, and loads it again when back', async () => {
    root = createRoot(host);
    await render(<LiveBlockPreview kind="html" source="<p>hi</p>" />);
    expect(frames()).toBe(1);
    await render(<LiveBlockPreview kind="html" source="<p>hi</p>" offscreen />);
    expect(frames()).toBe(0);
    await render(<LiveBlockPreview kind="html" source="<p>hi</p>" />);
    expect(frames()).toBe(1);
  });

  it('unloads a block out of view or in a hidden tab, and keeps its box height', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    root = createRoot(host);
    await render(
      <LiveBlockFrame kind="html" source="<p>hi</p>" preview trusted toggles={null}>
        {null}
      </LiveBlockFrame>,
    );
    expect(frames()).toBe(1);
    const box = host.querySelector<HTMLElement>('[data-live-block-preview]')!;
    box.style.height = '640px';

    await report(false);
    expect(frames()).toBe(0);
    expect(box.style.height).toBe('640px');

    await report(true);
    expect(frames()).toBe(1);
  });

  it('loads an unloaded block at once for a print', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    root = createRoot(host);
    await render(
      <LiveBlockFrame kind="html" source="<p>hi</p>" preview trusted toggles={null}>
        {null}
      </LiveBlockFrame>,
    );
    await report(false);
    expect(frames()).toBe(0);

    // printElement looks for the frames right after, without waiting for a render.
    revealIntersections(host);
    expect(frames()).toBe(1);
  });
});
