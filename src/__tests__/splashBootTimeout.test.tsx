// @vitest-environment happy-dom
/** #806: a boot stuck on the splash gives way to a clear error with a Reload button. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { SplashScreen, BOOT_TIMEOUT_MS } from '@/components/layout/SplashScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SplashScreen boot timeout', () => {
  it('replaces the splash with an error and a working Reload button once boot passes 20 s', async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(SplashScreen)));

    expect(BOOT_TIMEOUT_MS).toBe(20_000);
    await act(async () => vi.advanceTimersByTime(BOOT_TIMEOUT_MS - 1));
    expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();

    await act(async () => vi.advanceTimersByTime(1));
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Journal is taking too long to open');
    const button = [...alert.querySelectorAll('button')].find((b) => b.textContent === 'Reload')!;
    await act(async () => button.click());
    expect(reload).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    host.remove();
  });
});
