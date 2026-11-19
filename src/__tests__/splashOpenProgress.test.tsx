// @vitest-environment happy-dom
/** #1365: a slow encrypted open on Android shows its progress on the splash, a fast one never flashes it. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let store: typeof import('@/lib/bootProgress');

beforeEach(async () => {
  vi.useFakeTimers();
  // The store holds module-level state: a fresh copy per test.
  vi.resetModules();
  store = await import('@/lib/bootProgress');
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountSplash() {
  const { SplashScreen } = await import('@/components/layout/SplashScreen');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(SplashScreen)));
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe('SplashScreen encrypted open progress', () => {
  it('shows the percent only once the open has taken longer than 300 ms', async () => {
    const { host, unmount } = await mountSplash();
    expect(store.OPEN_PROGRESS_DELAY_MS).toBe(300);

    await act(async () => store.startOpenProgress());
    await act(async () => store.reportOpenProgress(25, 100));
    await act(async () => vi.advanceTimersByTime(299));
    expect(host.textContent).not.toContain('Opening your notes');

    await act(async () => vi.advanceTimersByTime(1));
    expect(host.textContent).toContain('Opening your notes… 25%');

    await act(async () => store.reportOpenProgress(80, 100));
    expect(host.textContent).toContain('Opening your notes… 80%');
    await unmount();
  });

  it('never shows it for an open that finishes inside the delay, even while boot carries on', async () => {
    const { host, unmount } = await mountSplash();

    await act(async () => store.startOpenProgress());
    await act(async () => vi.advanceTimersByTime(100));
    await act(async () => store.reportOpenProgress(100, 100));
    await act(async () => store.finishOpenProgress());
    await act(async () => vi.advanceTimersByTime(1_000));

    expect(host.textContent).not.toContain('Opening your notes');
    await unmount();
  });

  it('drops the label when a slow open finishes', async () => {
    const { host, unmount } = await mountSplash();

    await act(async () => store.startOpenProgress());
    await act(async () => store.reportOpenProgress(60, 100));
    await act(async () => vi.advanceTimersByTime(300));
    expect(host.textContent).toContain('Opening your notes… 60%');

    await act(async () => store.finishOpenProgress());
    expect(host.textContent).not.toContain('Opening your notes');
    await unmount();
  });

  it('never shows it when no encrypted open reports progress (the web, desktop, a fast open)', async () => {
    const { host, unmount } = await mountSplash();

    await act(async () => vi.advanceTimersByTime(5_000));

    expect(host.textContent).not.toContain('Opening your notes');
    expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
    await unmount();
  });
});
